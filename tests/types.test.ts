import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { collectTypes, formatTypes, typesDefine } from '../src/commands/types.js';

const freshStack = () => Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));

describe('collectTypes', () => {
  it('returns the pre-seeded system types, id-sorted', async () => {
    const stack = await freshStack();
    const types = await collectTypes(stack);

    expect(types.length).toBeGreaterThan(0);
    expect(types.map((t) => t.id)).toContain('_entity@1');
    expect(types.map((t) => t.id)).toEqual([...types.map((t) => t.id)].sort());
    await stack.close();
  });

  it('includes a user-defined type', async () => {
    const stack = await freshStack();
    await stack.defineType('com.example/note@1', 'Note', { text: { kind: 'text' } });

    const ids = (await collectTypes(stack)).map((t) => t.id);
    expect(ids).toContain('com.example/note@1');
    await stack.close();
  });
});

describe('formatTypes', () => {
  it('emits parseable JSON under --json', async () => {
    const stack = await freshStack();
    const types = await collectTypes(stack);

    const parsed = JSON.parse(formatTypes(types, true));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(types.length);
    await stack.close();
  });

  it('renders a header row and one line per type as a table', async () => {
    const stack = await freshStack();
    const types = await collectTypes(stack);

    const lines = formatTypes(types, false).split('\n');
    expect(lines[0]).toMatch(/^TYPE\s+NAME\s+SCHEMA$/);
    expect(lines).toHaveLength(types.length + 1);
    await stack.close();
  });

  it('reports an empty stack plainly', () => {
    expect(formatTypes([], false)).toBe('No types registered.');
  });
});

describe('typesDefine', () => {
  let stack: Stack;
  let dir: string;

  beforeEach(async () => {
    stack = await freshStack();
    dir = await mkdtemp(join(tmpdir(), 'hstack-types-'));
  });
  afterEach(async () => {
    await stack.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function spec(obj: unknown, name = 'schema.json'): Promise<string> {
    const file = join(dir, name);
    await writeFile(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
    return file;
  }

  it('registers a brand-new type', async () => {
    const file = await spec({
      id: 'com.example/task@1',
      name: 'Task',
      schema: { title: { kind: 'string', required: true } },
    });
    const msg = await typesDefine(stack, file);
    expect(msg).toMatch(/^Registered com\.example\/task@1 \(Task\), schema [0-9a-f]{12}…\.$/);
    expect((await stack.getType('com.example/task@1'))?.name).toBe('Task');
  });

  it('carries migratesFrom through', async () => {
    await spec(
      { id: 'com.example/task@1', name: 'Task', schema: { title: { kind: 'string' } } },
      'v1.json',
    ).then((f) => typesDefine(stack, f));
    const file = await spec({
      id: 'com.example/task@2',
      name: 'Task',
      schema: { title: { kind: 'string', required: true } },
      migratesFrom: 'com.example/task@1',
    });
    await typesDefine(stack, file);
    expect((await stack.getType('com.example/task@2'))?.migratesFrom).toBe('com.example/task@1');
  });

  it('is idempotent on an identical schema and name', async () => {
    const type = { id: 'com.example/task@1', name: 'Task', schema: { title: { kind: 'string' } } };
    const file = await spec(type);
    await typesDefine(stack, file);
    const msg = await typesDefine(stack, file);
    expect(msg).toMatch(/already registered.*no change/);
  });

  it('reports a name-only change', async () => {
    const file1 = await spec({
      id: 'com.example/task@1',
      name: 'Task',
      schema: { title: { kind: 'string' } },
    });
    await typesDefine(stack, file1);
    const file2 = await spec(
      { id: 'com.example/task@1', name: 'Todo', schema: { title: { kind: 'string' } } },
      'renamed.json',
    );
    const msg = await typesDefine(stack, file2);
    expect(msg).toMatch(/renamed to "Todo"/);
    expect((await stack.getType('com.example/task@1'))?.name).toBe('Todo');
  });

  it('reports additive-in-place evolution', async () => {
    const file1 = await spec({
      id: 'com.example/task@1',
      name: 'Task',
      schema: { title: { kind: 'string' } },
    });
    await typesDefine(stack, file1);
    const file2 = await spec(
      {
        id: 'com.example/task@1',
        name: 'Task',
        schema: { title: { kind: 'string' }, notes: { kind: 'text' } },
      },
      'extended.json',
    );
    const msg = await typesDefine(stack, file2);
    expect(msg).toMatch(/extended additively/);
  });

  it('surfaces StackSchemaDriftError verbatim, remedy included', async () => {
    const file1 = await spec({
      id: 'com.example/task@1',
      name: 'Task',
      schema: { title: { kind: 'string', required: true } },
    });
    await typesDefine(stack, file1);
    const file2 = await spec(
      { id: 'com.example/task@1', name: 'Task', schema: { title: { kind: 'number' } } },
      'drifted.json',
    );
    await expect(typesDefine(stack, file2)).rejects.toThrow(
      /Bump the version.*defineType\(`com\.example\/task@2`/s,
    );
  });

  it('rejects a missing file, invalid JSON, and each malformed field', async () => {
    await expect(typesDefine(stack, join(dir, 'nope.json'))).rejects.toThrow(/Could not read/);
    await expect(typesDefine(stack, await spec('not json', 'bad.json'))).rejects.toThrow(
      /not valid JSON/,
    );
    await expect(typesDefine(stack, await spec([1, 2], 'array.json'))).rejects.toThrow(
      /must be a JSON object/,
    );
    await expect(
      typesDefine(stack, await spec({ name: 'x', schema: {} }, 'no-id.json')),
    ).rejects.toThrow(/"id" must be/);
    await expect(
      typesDefine(stack, await spec({ id: 'x/y@1', schema: {} }, 'no-name.json')),
    ).rejects.toThrow(/"name" must be/);
    await expect(
      typesDefine(stack, await spec({ id: 'x/y@1', name: 'X', schema: 'nope' }, 'bad-schema.json')),
    ).rejects.toThrow(/"schema" must be/);
    await expect(
      typesDefine(
        stack,
        await spec({ id: 'x/y@1', name: 'X', schema: {}, migratesFrom: 5 }, 'bad-migrates.json'),
      ),
    ).rejects.toThrow(/"migratesFrom" must be/);
  });
});
