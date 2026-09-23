import { beforeEach, describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { linkAdd, linkRemove, tagAdd, tagRemove } from '../src/commands/associations.js';

let stack: Stack;
let id: string;
let otherId: string;

beforeEach(async () => {
  stack = await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));
  await stack.defineType('com.example/note@1', 'Note', { title: { kind: 'string' } });
  const rec = await stack.create('com.example/note@1', { title: 'A' });
  id = rec.id;
  otherId = (await stack.create('com.example/note@1', { title: 'B' })).id;
});

describe('tagAdd / tagRemove', () => {
  it('adds and removes a tag without moving the version', async () => {
    const before = (await stack.get(id))!;
    const added = await tagAdd(stack, id, 'starred');
    expect(added).toBe(`${id} is tagged "starred".`);
    const record = await stack.get(id);
    expect(record?.associations).toEqual([{ kind: 'tag', label: 'starred' }]);
    // Associating is a no-bump write: version and updatedAt stay put.
    expect(record?.version).toBe(before.version);
    expect(record?.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    const removed = await tagRemove(stack, id, 'starred');
    expect(removed).toBe(`${id} is no longer tagged "starred".`);
    expect((await stack.get(id))?.associations ?? []).toEqual([]);
  });

  it('reports a repeat as the no-op it is', async () => {
    await tagAdd(stack, id, 'starred');
    expect(await tagAdd(stack, id, 'starred')).toMatch(/already tagged/);
    await tagRemove(stack, id, 'starred');
    expect(await tagRemove(stack, id, 'starred')).toMatch(/nothing to remove/);
  });

  it('errors on a missing record', async () => {
    await expect(tagAdd(stack, 'ghost', 'x')).rejects.toThrow(/No record "ghost"/);
  });
});

describe('linkAdd / linkRemove', () => {
  it('associates and dissociates a relationship to another record', async () => {
    const msg = await linkAdd(stack, id, 'see-also', `record:${otherId}`);
    expect(msg).toBe(`${id} --see-also--> record:${otherId}.`);
    expect((await stack.get(id))?.associations).toEqual([
      { kind: 'relationship', label: 'see-also', target: { scope: 'record', recordId: otherId } },
    ]);

    await linkRemove(stack, id, 'see-also', `record:${otherId}`);
    expect((await stack.get(id))?.associations ?? []).toEqual([]);
    expect(await linkRemove(stack, id, 'see-also', `record:${otherId}`)).toMatch(
      /nothing to remove/,
    );
  });

  it('dissociate only removes the exact target named', async () => {
    await linkAdd(stack, id, 'ref', 'did:key:zA');
    await linkAdd(stack, id, 'ref', 'did:key:zB');
    await linkRemove(stack, id, 'ref', 'did:key:zA');
    const remaining = (await stack.get(id))?.associations ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ target: { entityId: 'did:key:zB' } });
  });
});

describe('link target arms', () => {
  it('links each scope the relationship union carries, through one --to', async () => {
    await linkAdd(stack, id, 'see-also', `record:${otherId}@https://other.example`);
    await linkAdd(stack, id, 'author', 'did:key:zAlice');
    await linkAdd(stack, id, 'mirrors', 'external:atproto/at://did:plc:x/post/3k');
    expect((await stack.get(id))?.associations).toEqual([
      {
        kind: 'relationship',
        label: 'see-also',
        target: { scope: 'record', recordId: otherId, stackUrl: 'https://other.example' },
      },
      {
        kind: 'relationship',
        label: 'author',
        target: { scope: 'entity', entityId: 'did:key:zAlice' },
      },
      {
        kind: 'relationship',
        label: 'mirrors',
        target: { scope: 'external', ns: 'atproto', id: 'at://did:plc:x/post/3k' },
      },
    ]);
  });

  it('refuses a target `link` cannot name', async () => {
    await expect(linkAdd(stack, id, 'x', 'anyone')).rejects.toThrow(
      /not something `link` can name/,
    );
  });

  it('matches a foreign-stack link exactly — the same --to removes it', async () => {
    await linkAdd(stack, id, 'see-also', `record:${otherId}@https://other.example`);
    // A bare record target is a different element, not a looser match.
    await linkRemove(stack, id, 'see-also', `record:${otherId}`);
    expect((await stack.get(id))?.associations).toHaveLength(1);
    await linkRemove(stack, id, 'see-also', `record:${otherId}@https://other.example`);
    expect((await stack.get(id))?.associations ?? []).toEqual([]);
  });
});
