/**
 * `hstack perm | grant` — who may read or write a record, and who may
 * create/read/update/delete a whole type family. `mutate()` replaced
 * `setPermissions()`; a permission entry has no per-field verb of its own,
 * so `perm` reads the record's current `Permission[]`, edits the one entry
 * it names, and writes the whole array back. `grant`/`revoke`/`listGrants`
 * already operate at that granularity. See docs/design.md § Associations.
 */

import type { EntityId, GrantAction, Permission, RecordId, Stack } from '@haverstack/core';
import { shortDid } from '../config.js';

// Core's own shape for stack.grant()/revoke()/listGrants(), not exported
// from its root: an entity, a group, or null for a default (public) grant.
type GrantTarget = EntityId | { groupId: RecordId } | null;

// ---------------------------------------------------------------- perm

export type PermTargetOptions = {
  public?: boolean;
  entity?: string;
  group?: string;
  role?: 'admin';
};

type PermKey = string;

function keyOf(p: Permission): PermKey {
  if (p.access === 'public') return 'public';
  if (p.access === 'entity') return `entity:${p.entityId}`;
  return `group:${p.groupId}:${p.role ?? 'member'}`;
}

function targetKey(opts: PermTargetOptions): PermKey {
  const picked = ['public', 'entity', 'group'].filter((k) => opts[k as keyof PermTargetOptions]);
  if (picked.length !== 1) throw new Error('Pass exactly one of --public, --entity, or --group.');
  if (opts.public) return 'public';
  if (opts.entity) return `entity:${opts.entity}`;
  return `group:${opts.group}:${opts.role ?? 'member'}`;
}

function describePerm(p: Permission): string {
  if (p.access === 'public') return 'public';
  if (p.access === 'entity') return shortDid(p.entityId);
  return `group:${p.groupId}${p.role ? `:${p.role}` : ''}`;
}

async function requireRecord(stack: Stack, id: string) {
  const record = await stack.get(id);
  if (!record) throw new Error(`No record "${id}".`);
  return record;
}

export async function permAdd(
  stack: Stack,
  id: string,
  target: PermTargetOptions,
  read: boolean,
  write: boolean,
): Promise<string> {
  if (!target.public && !read && !write) {
    throw new Error('Nothing to grant — pass --read and/or --write.');
  }
  const record = await requireRecord(stack, id);
  const key = targetKey(target);
  const perms = [...(record.permissions ?? [])];
  const i = perms.findIndex((p) => keyOf(p) === key);

  if (target.public) {
    if (i === -1) perms.push({ access: 'public' });
  } else if (target.entity) {
    const prior = i === -1 ? undefined : (perms[i] as Extract<Permission, { access: 'entity' }>);
    const entry: Permission = {
      access: 'entity',
      entityId: target.entity,
      read: read || Boolean(prior?.read),
      write: write || Boolean(prior?.write),
    };
    if (i === -1) perms.push(entry);
    else perms[i] = entry;
  } else {
    const prior = i === -1 ? undefined : (perms[i] as Extract<Permission, { access: 'group' }>);
    const entry: Permission = {
      access: 'group',
      groupId: target.group!,
      ...(target.role && { role: target.role }),
      read: read || Boolean(prior?.read),
      write: write || Boolean(prior?.write),
    };
    if (i === -1) perms.push(entry);
    else perms[i] = entry;
  }

  const updated = await stack.mutate(id, { permissions: perms });
  const entry = updated.permissions!.find((p) => keyOf(p) === key)!;
  return `${id}: ${describePerm(entry)} can ${accessSummary(entry)} (v${updated.version}).`;
}

export async function permRemove(
  stack: Stack,
  id: string,
  target: PermTargetOptions,
  read: boolean,
  write: boolean,
): Promise<string> {
  const record = await requireRecord(stack, id);
  const key = targetKey(target);
  const perms = [...(record.permissions ?? [])];
  const i = perms.findIndex((p) => keyOf(p) === key);
  if (i === -1)
    return `${id}: no permission entry for ${describeTargetOpts(target)} — nothing to remove.`;

  // Public and an entry with neither bit surviving are dropped outright;
  // --read/--write on their own narrow the entry instead of deleting it.
  if (target.public || !(read || write)) {
    perms.splice(i, 1);
  } else {
    const cur = perms[i] as Extract<Permission, { access: 'entity' | 'group' }>;
    const nextRead = read ? false : cur.read;
    const nextWrite = write ? false : cur.write;
    if (!nextRead && !nextWrite) perms.splice(i, 1);
    else perms[i] = { ...cur, read: nextRead, write: nextWrite };
  }

  const updated = await stack.mutate(id, { permissions: perms });
  const remaining = updated.permissions?.find((p) => keyOf(p) === key);
  return remaining
    ? `${id}: ${describePerm(remaining)} can now only ${accessSummary(remaining)} (v${updated.version}).`
    : `${id}: removed the ${describeTargetOpts(target)} entry (v${updated.version}).`;
}

function accessSummary(p: Permission): string {
  if (p.access === 'public') return 'read';
  const bits = [p.read && 'read', p.write && 'write'].filter(Boolean);
  return bits.length ? bits.join('+') : 'nothing (consider removing it)';
}

function describeTargetOpts(target: PermTargetOptions): string {
  if (target.public) return 'public';
  if (target.entity) return shortDid(target.entity);
  return `group:${target.group}${target.role ? `:${target.role}` : ''}`;
}

// ---------------------------------------------------------------- grant

export type GrantTargetOptions = { entity?: string; group?: string; isDefault?: boolean };

function resolveGrantTarget(opts: GrantTargetOptions): GrantTarget {
  const picked = ['entity', 'group', 'isDefault'].filter(
    (k) => opts[k as keyof GrantTargetOptions],
  );
  if (picked.length !== 1) throw new Error('Pass exactly one of --entity, --group, or --default.');
  if (opts.entity) return opts.entity;
  if (opts.group) return { groupId: opts.group };
  return null;
}

function describeGrantTarget(target: GrantTarget): string {
  if (target === null) return '(default — any authenticated entity)';
  if (typeof target === 'string') return shortDid(target);
  return `group:${target.groupId}`;
}

export async function grantAdd(
  stack: Stack,
  typeId: string,
  targetOpts: GrantTargetOptions,
  actions: GrantAction[],
): Promise<string> {
  const target = resolveGrantTarget(targetOpts);
  await stack.grant(target, [{ typeId, actions }]);
  return `Granted ${describeGrantTarget(target)} [${actions.join(', ')}] on ${typeId}.`;
}

export async function grantRemove(
  stack: Stack,
  typeId: string,
  targetOpts: GrantTargetOptions,
  actions: GrantAction[],
): Promise<string> {
  const target = resolveGrantTarget(targetOpts);
  await stack.revoke(target, [{ typeId, actions }]);
  return `Revoked ${describeGrantTarget(target)} [${actions.join(', ')}] on ${typeId}.`;
}

export async function grantList(stack: Stack, typeId?: string): Promise<string> {
  const all = await stack.listGrants();
  const rows = (
    typeId ? all.filter((r) => (r.content as { typeId: string }).typeId === typeId) : all
  ).map(
    (r) =>
      r.content as {
        typeId: string;
        actions: GrantAction[];
        granteeEntityId?: string;
        granteeGroupId?: string;
      },
  );

  if (rows.length === 0) return 'No grants.';

  const target = (g: (typeof rows)[number]): GrantTarget =>
    g.granteeEntityId ?? (g.granteeGroupId ? { groupId: g.granteeGroupId } : null);

  const typeW = Math.max(4, ...rows.map((g) => g.typeId.length));
  const granteeW = Math.max(
    'GRANTEE'.length,
    ...rows.map((g) => describeGrantTarget(target(g)).length),
  );
  const lines = rows.map(
    (g) =>
      `${g.typeId.padEnd(typeW)}  ${describeGrantTarget(target(g)).padEnd(granteeW)}  ${g.actions.join(', ')}`,
  );
  return [`${'TYPE'.padEnd(typeW)}  ${'GRANTEE'.padEnd(granteeW)}  ACTIONS`, ...lines].join('\n');
}
