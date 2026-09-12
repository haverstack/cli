import { beforeEach, describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { grantAdd, grantList, grantRemove, permAdd, permRemove } from '../src/commands/access.js';

let stack: Stack;
let id: string;

beforeEach(async () => {
  stack = await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));
  await stack.defineType('com.example/note@1', 'Note', { title: { kind: 'string' } });
  id = (await stack.create('com.example/note@1', { title: 'A' })).id;
});

describe('permAdd', () => {
  it('adds a public entry, idempotently', async () => {
    await permAdd(stack, id, { public: true }, false, false);
    await permAdd(stack, id, { public: true }, false, false);
    expect((await stack.get(id))?.permissions).toEqual([{ access: 'public' }]);
  });

  it('requires --read or --write for a non-public target', async () => {
    await expect(permAdd(stack, id, { entity: 'did:key:z1' }, false, false)).rejects.toThrow(
      /Nothing to grant/,
    );
  });

  it('merges access bits into an existing entity entry rather than resetting it', async () => {
    await permAdd(stack, id, { entity: 'did:key:z1' }, true, false);
    await permAdd(stack, id, { entity: 'did:key:z1' }, false, true);
    expect((await stack.get(id))?.permissions).toEqual([
      { access: 'entity', entityId: 'did:key:z1', read: true, write: true },
    ]);
  });

  it('keys a group entry on groupId + role, so admin and member are distinct entries', async () => {
    // `write` requires `read` in the same entry (core: write reaches the
    // record and its history, so write-without-read withholds nothing).
    await permAdd(stack, id, { group: 'g1' }, true, false);
    await permAdd(stack, id, { group: 'g1', role: 'admin' }, true, true);
    expect((await stack.get(id))?.permissions).toEqual([
      { access: 'group', groupId: 'g1', read: true, write: false },
      { access: 'group', groupId: 'g1', role: 'admin', read: true, write: true },
    ]);
  });

  it('surfaces core’s own write-requires-read rule for a fresh entry', async () => {
    await expect(permAdd(stack, id, { entity: 'did:key:z1' }, false, true)).rejects.toThrow(
      /write requires read/,
    );
  });

  it('requires exactly one of --public / --entity / --group', async () => {
    await expect(permAdd(stack, id, {}, true, false)).rejects.toThrow(/exactly one/);
  });
});

describe('permRemove', () => {
  it('drops the public entry outright', async () => {
    await permAdd(stack, id, { public: true }, false, false);
    const msg = await permRemove(stack, id, { public: true }, false, false);
    expect(msg).toMatch(/removed the public entry/);
    expect((await stack.get(id))?.permissions ?? []).toEqual([]);
  });

  it('narrows an entity entry when only one bit is named, dropping it once both are gone', async () => {
    await permAdd(stack, id, { entity: 'did:key:z1' }, true, true);
    await permRemove(stack, id, { entity: 'did:key:z1' }, false, true);
    expect((await stack.get(id))?.permissions).toEqual([
      { access: 'entity', entityId: 'did:key:z1', read: true, write: false },
    ]);
    await permRemove(stack, id, { entity: 'did:key:z1' }, true, false);
    expect((await stack.get(id))?.permissions ?? []).toEqual([]);
  });

  it('is a no-op message when there is nothing to remove', async () => {
    const msg = await permRemove(stack, id, { entity: 'did:key:zNobody' }, false, false);
    expect(msg).toMatch(/nothing to remove/);
  });
});

describe('grantAdd / grantRemove / grantList', () => {
  it('grants and lists a create+read-own bundle for an entity', async () => {
    await grantAdd(stack, 'com.example/note@1', { entity: 'did:key:zApp' }, ['create', 'read-own']);
    const listing = await grantList(stack);
    expect(listing).toMatch(/com\.example\/note@1/);
    expect(listing).toMatch(/create, read-own/);
  });

  it('supports a default (public) grant', async () => {
    await grantAdd(stack, 'com.example/note@1', { isDefault: true }, ['create']);
    const listing = await grantList(stack);
    expect(listing).toMatch(/default/);
  });

  it('filters listGrants by typeId', async () => {
    await grantAdd(stack, 'com.example/note@1', { entity: 'did:key:zApp' }, ['create']);
    await stack.defineType('com.example/task@1', 'Task', { title: { kind: 'string' } });
    await grantAdd(stack, 'com.example/task@1', { entity: 'did:key:zApp' }, ['create']);
    const listing = await grantList(stack, 'com.example/task@1');
    expect(listing).toContain('com.example/task@1');
    expect(listing).not.toContain('com.example/note@1');
  });

  it('revokes what it granted', async () => {
    await grantAdd(stack, 'com.example/note@1', { entity: 'did:key:zApp' }, ['create']);
    await grantRemove(stack, 'com.example/note@1', { entity: 'did:key:zApp' }, ['create']);
    expect(await grantList(stack)).toBe('No grants.');
  });

  it('surfaces core’s own dependency error for a mutate action with no read companion', async () => {
    await expect(
      grantAdd(stack, 'com.example/note@1', { entity: 'did:key:zApp' }, ['update-any']),
    ).rejects.toThrow(/requires "read-any"/);
  });

  it('requires exactly one of --entity / --group / --default', async () => {
    await expect(grantAdd(stack, 'com.example/note@1', {}, ['create'])).rejects.toThrow(
      /exactly one/,
    );
  });
});
