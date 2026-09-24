/**
 * `hstack perm | grant` — who may read or write one record, and who may
 * create/read/update/delete a whole type family.
 *
 * Record permissions are associations: one element per bit per grantee,
 * added and withdrawn one at a time by `grantAccess()`/`revokeAccess()`.
 * Both verbs are no-bump, and neither restates the rest of the ACL, so two
 * people sharing one record cannot overwrite each other. Both commands
 * name their target with `--to` (src/target.ts).
 * See docs/design.md § Associations.
 */

import type { AuthorityAssociation, GrantAction, Stack, StackRecord } from '@haverstack/core';
import type { GrantQuery } from '@haverstack/core';
import {
  parseGrantQuery,
  parseGrantTarget,
  parsePermissionTarget,
  showGrantTarget,
  showPermissionTarget,
  type PermissionTarget,
} from '../target.js';

// ---------------------------------------------------------------- perm

type Bits = { read: boolean; write: boolean };

/** The element a target + bit names, or null where the pair names none. */
function elementFor(
  target: PermissionTarget,
  label: 'read' | 'write',
): AuthorityAssociation | null {
  if (target.scope === 'anyone') return label === 'read' ? { kind: 'anyone', label: 'read' } : null;
  return { kind: 'permission', label, grantee: target };
}

function sameGrantee(a: PermissionTarget, b: PermissionTarget): boolean {
  if (a.scope !== b.scope) return false;
  if (a.scope === 'entity' && b.scope === 'entity') return a.entityId === b.entityId;
  if (a.scope === 'group' && b.scope === 'group') {
    return a.groupId === b.groupId && a.role === b.role;
  }
  return a.scope === 'anyone';
}

/** An ACL element as the target it names, so both halves compare as one. */
function granteeOf(p: AuthorityAssociation): PermissionTarget {
  return p.kind === 'anyone' ? { scope: 'anyone' } : p.grantee;
}

function bitsOf(permissions: AuthorityAssociation[] | undefined, target: PermissionTarget): Bits {
  const held = (label: 'read' | 'write') =>
    (permissions ?? []).some((p) => p.label === label && sameGrantee(granteeOf(p), target));
  return { read: held('read'), write: held('write') };
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
  to: string,
  read: boolean,
  write: boolean,
): Promise<string> {
  const target = parsePermissionTarget(to);
  if (target.scope === 'anyone' && write) {
    throw new Error('`anyone` carries read only. Name a DID or a group to grant write.');
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
  const who = showPermissionTarget(target);
  return before.read === after.read && before.write === after.write
    ? `${id}: ${who} could already ${describeBits(after)} — nothing to do.`
    : `${id}: ${who} can now ${describeBits(after)}.`;
}

export async function permRemove(
  stack: Stack,
  id: string,
  to: string,
  read: boolean,
  write: boolean,
): Promise<string> {
  const target = parsePermissionTarget(to);
  // Naming no bit withdraws the target's access entirely.
  if (!read && !write) {
    read = true;
    write = target.scope !== 'anyone';
  }
  if (target.scope === 'anyone' && write) {
    throw new Error('`anyone` carries read only — there is no write bit to remove.');
  }

  const before = bitsOf((await requireRecord(stack, id)).permissions, target);

  // Write first, the inverse of grant's order, for the same invariant.
  let record: StackRecord | undefined;
  if (write) record = await stack.revokeAccess(id, elementFor(target, 'write')!);
  if (read) record = await stack.revokeAccess(id, elementFor(target, 'read')!);

  const after = bitsOf(record!.permissions, target);
  const who = showPermissionTarget(target);
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
 * grantee may hold onto one line. Targets print in `--to`'s own grammar,
 * unelided, so a row can be pasted straight back into a command.
 */
export async function permList(stack: Stack, id: string, json: boolean): Promise<string> {
  const record = await requireRecord(stack, id);
  const permissions = record.permissions ?? [];
  if (json) return JSON.stringify(permissions, null, 2);
  if (permissions.length === 0) return `${id} is private — only the stack owner reaches it.`;

  const byTarget = new Map<string, Bits>();
  for (const p of permissions) {
    const who = showPermissionTarget(granteeOf(p));
    const bits = byTarget.get(who) ?? { read: false, write: false };
    bits[p.label] = true;
    byTarget.set(who, bits);
  }

  const whoW = Math.max('TARGET'.length, ...[...byTarget.keys()].map((w) => w.length));
  return [
    `${'TARGET'.padEnd(whoW)}  ACCESS`,
    ...[...byTarget].map(([who, bits]) => `${who.padEnd(whoW)}  ${describeBits(bits)}`),
  ].join('\n');
}

// ---------------------------------------------------------------- grant

/** A stored grant's grantee as a `--to` string, for a listing's output. */
const describeGrantee = (grantee: GrantQuery | undefined): string =>
  grantee ? showGrantTarget(grantee) : '—';

export async function grantAdd(
  stack: Stack,
  typeId: string,
  to: string,
  actions: GrantAction[],
): Promise<string> {
  const target = parseGrantTarget(to);
  await stack.grant(target, [{ typeId, actions }]);
  return `Granted ${describeGrantee(target)} [${actions.join(', ')}] on ${typeId}.`;
}

export async function grantRemove(
  stack: Stack,
  typeId: string,
  to: string,
  actions: GrantAction[],
): Promise<string> {
  const target = parseGrantTarget(to);
  const withdrawn = await stack.revoke(target, [{ typeId, actions }]);
  const what = `${describeGrantee(target)} [${actions.join(', ')}] on ${typeId}`;
  return withdrawn.length === 0
    ? `No grant matched ${what} — nothing to revoke.`
    : `Revoked ${withdrawn.length} grant(s): ${what}.`;
}

export async function grantList(stack: Stack, typeId?: string, to?: string): Promise<string> {
  const query = to === undefined ? undefined : parseGrantQuery(to);
  const all = await stack.listGrants(query);
  const rows = (
    typeId ? all.filter((r) => (r.content as { typeId: string }).typeId === typeId) : all
  ).map((r) => r.content as { typeId: string; actions: GrantAction[]; grantee?: GrantQuery });

  if (rows.length === 0) return 'No grants.';

  const typeW = Math.max(4, ...rows.map((g) => g.typeId.length));
  const targetW = Math.max('TARGET'.length, ...rows.map((g) => describeGrantee(g.grantee).length));
  const lines = rows.map(
    (g) =>
      `${g.typeId.padEnd(typeW)}  ${describeGrantee(g.grantee).padEnd(targetW)}  ${g.actions.join(', ')}`,
  );
  return [`${'TYPE'.padEnd(typeW)}  ${'TARGET'.padEnd(targetW)}  ACTIONS`, ...lines].join('\n');
}
