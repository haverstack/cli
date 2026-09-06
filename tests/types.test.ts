import { describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { collectTypes, formatTypes } from '../src/commands/types.js';

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
