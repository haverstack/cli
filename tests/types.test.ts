import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { LocalAdapter } from '@haverstack/adapter-local';
import { openStack } from '../src/openStack.js';
import { collectTypes, formatTypes } from '../src/commands/types.js';

describe('collectTypes', () => {
  it('returns the pre-seeded system types, id-sorted', async () => {
    const stack = await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));
    const types = await collectTypes(stack);

    expect(types.length).toBeGreaterThan(0);
    expect(types.map((t) => t.id)).toContain('_entity@1');
    expect(types.map((t) => t.id)).toEqual([...types.map((t) => t.id)].sort());
    await stack.close();
  });

  it('includes a user-defined type', async () => {
    const stack = await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));
    await stack.defineType('com.example/note@1', 'Note', { text: { kind: 'text' } });

    const ids = (await collectTypes(stack)).map((t) => t.id);
    expect(ids).toContain('com.example/note@1');
    await stack.close();
  });
});

describe('formatTypes', () => {
  it('emits parseable JSON under --json', async () => {
    const stack = await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));
    const types = await collectTypes(stack);

    const parsed = JSON.parse(formatTypes(types, true));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(types.length);
    await stack.close();
  });

  it('renders a header row and one line per type as a table', async () => {
    const stack = await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));
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

describe('openStack against a local file', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hstack-test-'));
    dbPath = join(dir, 'stack.db');
    const adapter = await LocalAdapter.initialize({ path: dbPath, entityId: 'did:key:zOwner' });
    const stack = await Stack.create(adapter);
    await stack.defineType('com.example/task@1', 'Task', { title: { kind: 'string' } });
    await stack.close();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('opens the file by path and reads its types back', async () => {
    const opened = await openStack(dbPath);
    try {
      expect(opened.mode).toBe('unscoped');
      expect(opened.target).toBe(dbPath);
      const ids = (await collectTypes(opened.stack)).map((t) => t.id);
      expect(ids).toContain('com.example/task@1');
    } finally {
      await opened.close();
    }
  });

  it('rejects a bare word that is neither a path nor a URL', async () => {
    await expect(openStack('personal')).rejects.toThrow(/not resolvable yet/);
  });

  it('rejects an http(s) target for now', async () => {
    await expect(openStack('https://stack.example.com')).rejects.toThrow(/not wired up yet/);
  });
});
