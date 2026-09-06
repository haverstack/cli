import { describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { queryAll } from '../src/paginate.js';

async function seeded(count: number) {
  const stack = await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));
  await stack.defineType('com.example/note@1', 'Note', { title: { kind: 'string' } });
  for (let i = 0; i < count; i++) {
    await stack.create('com.example/note@1', { title: `n${i}` });
  }
  return stack;
}

describe('queryAll', () => {
  it('follows the cursor across page boundaries to return every record', async () => {
    const stack = await seeded(60); // MemoryAdapter pages at 50
    const all = await queryAll(stack, { filter: { typeId: 'com.example/note@1' } });
    expect(all).toHaveLength(60);
    await stack.close();
  });

  it('stops at an explicit limit without over-fetching the caller', async () => {
    const stack = await seeded(60);
    const capped = await queryAll(stack, { filter: { typeId: 'com.example/note@1' } }, 25);
    expect(capped).toHaveLength(25);
    await stack.close();
  });

  it('returns an empty array when nothing matches', async () => {
    const stack = await seeded(1);
    expect(await queryAll(stack, { filter: { typeId: 'com.example/missing@1' } })).toEqual([]);
    await stack.close();
  });
});
