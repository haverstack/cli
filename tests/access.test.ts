import { beforeEach, describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import {
  grantAdd,
  grantList,
  grantRemove,
  permAdd,
  permList,
  permRemove,
} from '../src/commands/access.js';

let stack: Stack;
let id: string;

const perms = async () => (await stack.get(id))?.permissions ?? [];

beforeEach(async () => {
  stack = await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));
  await stack.defineType('com.example/note@1', 'Note', { title: { kind: 'string' } });
  id = (await stack.create('com.example/note@1', { title: 'A' })).id;
});

describe('permAdd', () => {
  it('adds an `anyone` element, idempotently', async () => {
    await permAdd(stack, id, { anyone: true }, false, false);
    const second = await permAdd(stack, id, { anyone: true }, false, false);
    expect(await perms()).toEqual([{ kind: 'anyone', label: 'read' }]);
    expect(second).toMatch(/nothing to do/);
  });

  it('refuses a write bit on --anyone, which carries read alone', async () => {
    await expect(permAdd(stack, id, { anyone: true }, false, true)).rejects.toThrow(
      /--anyone carries read only/,
    );
  });

  it('requires --read or --write for a grantee target', async () => {
    await expect(permAdd(stack, id, { entity: 'did:key:z1' }, false, false)).rejects.toThrow(
      /Nothing to grant/,
    );
  });

  it('adds one element per bit, and adding the second keeps the first', async () => {
    await permAdd(stack, id, { entity: 'did:key:z1' }, true, false);
    await permAdd(stack, id, { entity: 'did:key:z1' }, false, true);
    expect(await perms()).toEqual([
      { kind: 'permission', label: 'read', grantee: { scope: 'entity', entityId: 'did:key:z1' } },
      { kind: 'permission', label: 'write', grantee: { scope: 'entity', entityId: 'did:key:z1' } },
    ]);
  });

  it('keys a group grantee on groupId + role, so member and admin are distinct', async () => {
    await permAdd(stack, id, { group: 'g1', role: 'member' }, true, false);
    await permAdd(stack, id, { group: 'g1', role: 'admin' }, true, true);
    expect(await perms()).toEqual([
      {
        kind: 'permission',
        label: 'read',
        grantee: { scope: 'group', groupId: 'g1', role: 'member' },
      },
      {
        kind: 'permission',
        label: 'read',
        grantee: { scope: 'group', groupId: 'g1', role: 'admin' },
      },
      {
        kind: 'permission',
        label: 'write',
        grantee: { scope: 'group', groupId: 'g1', role: 'admin' },
      },
    ]);
  });

  it('requires --role alongside --group — a permission names one role', async () => {
    await expect(permAdd(stack, id, { group: 'g1' }, true, false)).rejects.toThrow(
      /--group needs --role/,
    );
  });

  it('grants read before write, so --read --write together is accepted', async () => {
    await permAdd(stack, id, { entity: 'did:key:z1' }, true, true);
    expect((await perms()).map((p) => p.label)).toEqual(['read', 'write']);
  });

  it('surfaces core’s own write-requires-read rule for a bare write', async () => {
    await expect(permAdd(stack, id, { entity: 'did:key:z1' }, false, true)).rejects.toThrow(
      /write requires read|cannot read/i,
    );
  });

  it('is a no-bump write — version and updatedAt stay put', async () => {
    const before = (await stack.get(id))!;
    await permAdd(stack, id, { anyone: true }, false, false);
    const after = (await stack.get(id))!;
    expect(after.version).toBe(before.version);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('requires exactly one of --anyone / --entity / --group', async () => {
    await expect(permAdd(stack, id, {}, true, false)).rejects.toThrow(/exactly one/);
  });
});

describe('permRemove', () => {
  it('drops the `anyone` element', async () => {
    await permAdd(stack, id, { anyone: true }, false, false);
    const msg = await permRemove(stack, id, { anyone: true }, false, false);
    expect(msg).toMatch(/no longer reaches it/);
    expect(await perms()).toEqual([]);
  });

  it('withdraws one named bit, leaving the other standing', async () => {
    await permAdd(stack, id, { entity: 'did:key:z1' }, true, true);
    await permRemove(stack, id, { entity: 'did:key:z1' }, false, true);
    expect(await perms()).toEqual([
      { kind: 'permission', label: 'read', grantee: { scope: 'entity', entityId: 'did:key:z1' } },
    ]);
  });

  it('withdraws every bit when neither is named, write first', async () => {
    await permAdd(stack, id, { entity: 'did:key:z1' }, true, true);
    await permRemove(stack, id, { entity: 'did:key:z1' }, false, false);
    expect(await perms()).toEqual([]);
  });

  it('surfaces core’s refusal to leave a writer unable to read', async () => {
    await permAdd(stack, id, { entity: 'did:key:z1' }, true, true);
    await expect(permRemove(stack, id, { entity: 'did:key:z1' }, true, false)).rejects.toThrow(
      /read|write/i,
    );
  });

  it('is a no-op message when there is nothing to remove', async () => {
    const msg = await permRemove(stack, id, { entity: 'did:key:zNobody' }, false, false);
    expect(msg).toMatch(/nothing to do/);
  });
});

describe('permList', () => {
  it('says so when a record is private', async () => {
    expect(await permList(stack, id, false)).toMatch(/private/);
  });

  it('lists a grantee per line, and round-trips as JSON', async () => {
    await permAdd(stack, id, { entity: 'did:key:z1' }, true, true);
    await permAdd(stack, id, { anyone: true }, false, false);
    const listing = await permList(stack, id, false);
    expect(listing).toMatch(/GRANTEE\s+ACCESS/);
    expect(listing).toMatch(/anyone\s+read/);
    expect(JSON.parse(await permList(stack, id, true))).toHaveLength(3);
  });
});

describe('grantAdd / grantRemove / grantList', () => {
  it('grants and lists a create+read-own bundle for an entity', async () => {
    await grantAdd(stack, 'com.example/note@1', { entity: 'did:key:zApp' }, ['create', 'read-own']);
    const listing = await grantList(stack);
    expect(listing).toMatch(/com\.example\/note@1/);
    expect(listing).toMatch(/create, read-own/);
  });

  it('supports an authenticated (default) grant', async () => {
    await grantAdd(stack, 'com.example/note@1', { authenticated: true }, ['create']);
    expect(await grantList(stack)).toMatch(/authenticated/);
  });

  it('names one role on a group grant, and keeps member and admin apart', async () => {
    await grantAdd(stack, 'com.example/note@1', { group: 'g1', role: 'member' }, ['create']);
    await grantAdd(stack, 'com.example/note@1', { group: 'g1', role: 'admin' }, ['read-any']);
    expect(await grantList(stack, undefined, { group: 'g1', role: 'admin' })).toMatch(
      /group:g1:admin\s+read-any/,
    );
    // `--role any` is the listing-only widening.
    expect(
      (await grantList(stack, undefined, { group: 'g1', role: 'any' })).split('\n'),
    ).toHaveLength(3);
  });

  it('requires --role alongside --group when granting', async () => {
    await expect(
      grantAdd(stack, 'com.example/note@1', { group: 'g1' }, ['create']),
    ).rejects.toThrow(/--group needs --role/);
  });

  it('refuses the listing-only --role any on a grant', async () => {
    await expect(
      grantAdd(stack, 'com.example/note@1', { group: 'g1', role: 'any' }, ['create']),
    ).rejects.toThrow(/--role any is for/);
  });

  it('filters listGrants by typeId', async () => {
    await grantAdd(stack, 'com.example/note@1', { entity: 'did:key:zApp' }, ['create']);
    await stack.defineType('com.example/task@1', 'Task', { title: { kind: 'string' } });
    await grantAdd(stack, 'com.example/task@1', { entity: 'did:key:zApp' }, ['create']);
    const listing = await grantList(stack, 'com.example/task@1');
    expect(listing).toContain('com.example/task@1');
    expect(listing).not.toContain('com.example/note@1');
  });

  it('revokes what it granted, and reports how many it withdrew', async () => {
    await grantAdd(stack, 'com.example/note@1', { entity: 'did:key:zApp' }, ['create']);
    const msg = await grantRemove(stack, 'com.example/note@1', { entity: 'did:key:zApp' }, [
      'create',
    ]);
    expect(msg).toMatch(/Revoked 1 grant/);
    expect(await grantList(stack)).toBe('No grants.');
  });

  it('says so when a revoke matches nothing', async () => {
    const msg = await grantRemove(stack, 'com.example/note@1', { entity: 'did:key:zNobody' }, [
      'create',
    ]);
    expect(msg).toMatch(/nothing to revoke/);
  });

  it('surfaces core’s own dependency error for a mutate action with no read companion', async () => {
    await expect(
      grantAdd(stack, 'com.example/note@1', { entity: 'did:key:zApp' }, ['update-any']),
    ).rejects.toThrow(/requires "read-any"/);
  });

  it('requires exactly one of --entity / --group / --authenticated', async () => {
    await expect(grantAdd(stack, 'com.example/note@1', {}, ['create'])).rejects.toThrow(
      /exactly one/,
    );
  });
});
