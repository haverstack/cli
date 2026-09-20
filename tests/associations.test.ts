import { beforeEach, describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import {
  buildRelationshipTarget,
  linkAdd,
  linkRemove,
  tagAdd,
  tagRemove,
} from '../src/commands/associations.js';

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

describe('buildRelationshipTarget', () => {
  it('builds each scope from its own flags', () => {
    expect(buildRelationshipTarget({ toRecord: 'rid' })).toEqual({
      scope: 'record',
      recordId: 'rid',
    });
    expect(buildRelationshipTarget({ toRecord: 'rid', stackUrl: 'https://x' })).toEqual({
      scope: 'record',
      recordId: 'rid',
      stackUrl: 'https://x',
    });
    expect(buildRelationshipTarget({ toEntity: 'did:key:z1' })).toEqual({
      scope: 'entity',
      entityId: 'did:key:z1',
    });
    expect(buildRelationshipTarget({ toExternalNs: 'atproto', externalId: 'at://x' })).toEqual({
      scope: 'external',
      ns: 'atproto',
      id: 'at://x',
    });
  });

  it('requires exactly one target group', () => {
    expect(() => buildRelationshipTarget({})).toThrow(/exactly one/);
    expect(() => buildRelationshipTarget({ toRecord: 'a', toEntity: 'b' })).toThrow(/exactly one/);
  });

  it('requires --external-id alongside --to-external', () => {
    expect(() => buildRelationshipTarget({ toExternalNs: 'atproto' })).toThrow(/--external-id/);
  });
});

describe('linkAdd / linkRemove', () => {
  it('associates and dissociates a relationship to another record', async () => {
    const msg = await linkAdd(stack, id, 'see-also', { toRecord: otherId });
    expect(msg).toBe(`${id} --see-also--> ${otherId}.`);
    expect((await stack.get(id))?.associations).toEqual([
      { kind: 'relationship', label: 'see-also', target: { scope: 'record', recordId: otherId } },
    ]);

    await linkRemove(stack, id, 'see-also', { toRecord: otherId });
    expect((await stack.get(id))?.associations ?? []).toEqual([]);
    expect(await linkRemove(stack, id, 'see-also', { toRecord: otherId })).toMatch(
      /nothing to remove/,
    );
  });

  it('dissociate only removes the exact target named', async () => {
    await linkAdd(stack, id, 'ref', { toEntity: 'did:key:zA' });
    await linkAdd(stack, id, 'ref', { toEntity: 'did:key:zB' });
    await linkRemove(stack, id, 'ref', { toEntity: 'did:key:zA' });
    const remaining = (await stack.get(id))?.associations ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ target: { entityId: 'did:key:zB' } });
  });
});
