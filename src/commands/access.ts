/**
 * `hstack perm | grant` — who may read or write one record, and who may
 * create/read/update/delete a whole type family.
 *
 * Record permissions are associations: one element per bit per grantee,
 * added and withdrawn one at a time by `grantAccess()`/`revokeAccess()`.
 * Both verbs are no-bump, and neither restates the rest of the ACL, so two
 * people sharing one record cannot overwrite each other.
 * See docs/design.md § Associations.
 */

import type {
  AuthorityAssociation,
  GrantAction,
  PermissionGrantee,
  RecordId,
  Stack,
  StackRecord,
} from '@haverstack/core';
import { shortDid } from '../config.js';

// ---------------------------------------------------------------- perm

export type PermTargetOptions = {
  anyone?: boolean;
  entity?: string;
  group?: string;
  role?: 'member' | 'admin';
};

/** `anyone` has no grantee at all, which is what makes it its own arm. */
type PermTarget = { scope: 'anyone' } | PermissionGrantee;

type Bits = { read: boolean; write: boolean };

function resolvePermTarget(opts: PermTargetOptions): PermTarget {
  const picked = ['anyone', 'entity', 'group'].filter((k) => opts[k as keyof PermTargetOptions]);
  if (picked.length !== 1) throw new Error('Pass exactly one of --anyone, --entity, or --group.');
  if (opts.anyone) return { scope: 'anyone' };
  if (opts.entity) return { scope: 'entity', entityId: opts.entity };
  if (!opts.role) {
    throw new Error('--group needs --role member or --role admin — a permission names one role.');
  }
  return { scope: 'group', groupId: opts.group!, role: opts.role };
}

/** The element a target + bit names, or null where the pair names none. */
function elementFor(target: PermTarget, label: 'read' | 'write'): AuthorityAssociation | null {
  if (target.scope === 'anyone') return label === 'read' ? { kind: 'anyone', label: 'read' } : null;
  return { kind: 'permission', label, grantee: target };
}

function granteeMatches(a: PermissionGrantee, b: PermissionGrantee): boolean {
  if (a.scope !== b.scope) return false;
  if (a.scope === 'entity' && b.scope === 'entity') return a.entityId === b.entityId;
  if (a.scope === 'group' && b.scope === 'group') {
    return a.groupId === b.groupId && a.role === b.role;
  }
  return false;
}

function bitsOf(permissions: AuthorityAssociation[] | undefined, target: PermTarget): Bits {
  const held = (label: 'read' | 'write') =>
    (permissions ?? []).some((p) =>
      target.scope === 'anyone'
        ? p.kind === 'anyone' && label === 'read'
        : p.kind === 'permission' && p.label === label && granteeMatches(p.grantee, target),
    );
  return { read: held('read'), write: held('write') };
}

function describePermTarget(target: PermTarget): string {
  if (target.scope === 'anyone') return 'anyone';
  if (target.scope === 'entity') return shortDid(target.entityId);
  return `group:${target.groupId}:${target.role}`;
}

function describeBits(bits: Bits): string {
  const named = [bits.read && 'read', bits.write && 'write'].filter(Boolean);
  return named.length > 0 ? named.join('+') : 'nothing';
}

async function requireRecord(stack: Stack, id: string): Promise<StackRecord> {
  const record = await stack.get(id);
  if (!record) throw new Error(`No record "${id}".`);
  return record;
}

export async function permAdd(
  stack: Stack,
  id: string,
  targetOpts: PermTargetOptions,
  read: boolean,
  write: boolean,
): Promise<string> {
  const target = resolvePermTarget(targetOpts);
  if (target.scope === 'anyone' && write) {
    throw new Error('--anyone carries read only. Name a --entity or --group to grant write.');
  }
  // `anyone` has exactly one bit, so naming it is naming the whole element.
  if (target.scope === 'anyone') read = true;
  if (!read && !write) throw new Error('Nothing to grant — pass --read and/or --write.');

  const before = bitsOf((await requireRecord(stack, id)).permissions, target);

  // Read first: core refuses a set in which a writer cannot read, so the
  // two halves of `--read --write` only go in one order.
  let record: StackRecord | undefined;
  if (read) record = await stack.grantAccess(id, elementFor(target, 'read')!);
  if (write) record = await stack.grantAccess(id, elementFor(target, 'write')!);

  const after = bitsOf(record!.permissions, target);
  const who = describePermTarget(target);
  return before.read === after.read && before.write === after.write
    ? `${id}: ${who} could already ${describeBits(after)} — nothing to do.`
    : `${id}: ${who} can now ${describeBits(after)}.`;
}

export async function permRemove(
  stack: Stack,
  id: string,
  targetOpts: PermTargetOptions,
  read: boolean,
  write: boolean,
): Promise<string> {
  const target = resolvePermTarget(targetOpts);
  // Naming no bit withdraws the target's access entirely.
  if (!read && !write) {
    read = true;
    write = target.scope !== 'anyone';
  }
  if (target.scope === 'anyone' && write) {
    throw new Error('--anyone carries read only — there is no write bit to remove.');
  }

  const before = bitsOf((await requireRecord(stack, id)).permissions, target);

  // Write first, the inverse of grant's order, for the same invariant.
  let record: StackRecord | undefined;
  if (write) record = await stack.revokeAccess(id, elementFor(target, 'write')!);
  if (read) record = await stack.revokeAccess(id, elementFor(target, 'read')!);

  const after = bitsOf(record!.permissions, target);
  const who = describePermTarget(target);
  if (before.read === after.read && before.write === after.write) {
    return `${id}: ${who} had no ${describeBits({ read, write })} to remove — nothing to do.`;
  }
  return after.read || after.write
    ? `${id}: ${who} can now only ${describeBits(after)}.`
    : `${id}: ${who} no longer reaches it.`;
}

/**
 * Who reaches a record. The stored form is one element per bit, which is
 * what `--json` and `_readonly` show; this collapses the two bits a
 * grantee may hold onto one line, since "who reaches this" is the question
 * being asked.
 */
export async function permList(stack: Stack, id: string, json: boolean): Promise<string> {
  const record = await requireRecord(stack, id);
  const permissions = record.permissions ?? [];
  if (json) return JSON.stringify(permissions, null, 2);
  if (permissions.length === 0) return `${id} is private — only the stack owner reaches it.`;

  const byGrantee = new Map<string, Bits>();
  for (const p of permissions) {
    const who = p.kind === 'anyone' ? 'anyone' : describePermTarget(p.grantee);
    const bits = byGrantee.get(who) ?? { read: false, write: false };
    bits[p.label] = true;
    byGrantee.set(who, bits);
  }

  const whoW = Math.max('GRANTEE'.length, ...[...byGrantee.keys()].map((w) => w.length));
  return [
    `${'GRANTEE'.padEnd(whoW)}  ACCESS`,
    ...[...byGrantee].map(([who, bits]) => `${who.padEnd(whoW)}  ${describeBits(bits)}`),
  ].join('\n');
}

// ---------------------------------------------------------------- grant

/**
 * Core's `GrantGrantee` union as flags. `role: 'any'` is listing-only —
 * `grant`/`revoke` name one role, since a grant to a group's admins is not
 * the grant to its members.
 */
export type GrantTargetOptions = {
  entity?: string;
  group?: string;
  role?: 'member' | 'admin' | 'any';
  authenticated?: boolean;
};

type GrantGrantee =
  | { kind: 'entity'; entityId: string }
  | { kind: 'group'; groupId: RecordId; role: 'member' | 'admin' }
  | { kind: 'authenticated' };

type GrantQuery =
  | { kind: 'entity'; entityId: string }
  | { kind: 'group'; groupId: RecordId; role: 'member' | 'admin' | 'any' }
  | { kind: 'authenticated' };

function resolveGrantTarget(opts: GrantTargetOptions): GrantGrantee {
  const query = resolveGrantQuery(opts, false);
  if (!query) throw new Error('Pass exactly one of --entity, --group, or --authenticated.');
  return query as GrantGrantee;
}

/** The same union, widened for a listing: `--group` alone means any role. */
function resolveGrantQuery(opts: GrantTargetOptions, allowAny: boolean): GrantQuery | undefined {
  const picked = ['entity', 'group', 'authenticated'].filter(
    (k) => opts[k as keyof GrantTargetOptions],
  );
  if (picked.length === 0) return undefined;
  if (picked.length > 1) throw new Error('Pass at most one of --entity, --group, --authenticated.');
  if (opts.entity) return { kind: 'entity', entityId: opts.entity };
  if (opts.authenticated) return { kind: 'authenticated' };
  if (opts.role === 'any' && !allowAny) {
    throw new Error('--role any is for `grant ls` — a grant names member or admin.');
  }
  const role = opts.role ?? (allowAny ? 'any' : undefined);
  if (!role) {
    throw new Error('--group needs --role member or --role admin — a grant names one role.');
  }
  return { kind: 'group', groupId: opts.group!, role };
}

function describeGrantee(grantee: GrantQuery | undefined): string {
  if (!grantee) return '—';
  if (grantee.kind === 'entity') return shortDid(grantee.entityId);
  if (grantee.kind === 'group') return `group:${grantee.groupId}:${grantee.role}`;
  return 'authenticated';
}

export async function grantAdd(
  stack: Stack,
  typeId: string,
  targetOpts: GrantTargetOptions,
  actions: GrantAction[],
): Promise<string> {
  const target = resolveGrantTarget(targetOpts);
  await stack.grant(target, [{ typeId, actions }]);
  return `Granted ${describeGrantee(target)} [${actions.join(', ')}] on ${typeId}.`;
}

export async function grantRemove(
  stack: Stack,
  typeId: string,
  targetOpts: GrantTargetOptions,
  actions: GrantAction[],
): Promise<string> {
  const target = resolveGrantTarget(targetOpts);
  const withdrawn = await stack.revoke(target, [{ typeId, actions }]);
  return withdrawn.length === 0
    ? `No grant matched ${describeGrantee(target)} [${actions.join(', ')}] on ${typeId} — nothing to revoke.`
    : `Revoked ${withdrawn.length} grant(s): ${describeGrantee(target)} [${actions.join(', ')}] on ${typeId}.`;
}

export async function grantList(
  stack: Stack,
  typeId?: string,
  targetOpts: GrantTargetOptions = {},
): Promise<string> {
  const query = resolveGrantQuery(targetOpts, true);
  const all = await stack.listGrants(query);
  const rows = (
    typeId ? all.filter((r) => (r.content as { typeId: string }).typeId === typeId) : all
  ).map((r) => r.content as { typeId: string; actions: GrantAction[]; grantee?: GrantQuery });

  if (rows.length === 0) return 'No grants.';

  const typeW = Math.max(4, ...rows.map((g) => g.typeId.length));
  const granteeW = Math.max(
    'GRANTEE'.length,
    ...rows.map((g) => describeGrantee(g.grantee).length),
  );
  const lines = rows.map(
    (g) =>
      `${g.typeId.padEnd(typeW)}  ${describeGrantee(g.grantee).padEnd(granteeW)}  ${g.actions.join(', ')}`,
  );
  return [`${'TYPE'.padEnd(typeW)}  ${'GRANTEE'.padEnd(granteeW)}  ACTIONS`, ...lines].join('\n');
}
