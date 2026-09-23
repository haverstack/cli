/**
 * `--to` — the one way this CLI names the other end of an association.
 *
 * Core keeps three unions apart on purpose: a `RelationshipTarget` names
 * no role, a `PermissionGrantee` has no record scope, and `anyone` is a
 * kind of its own rather than a grantee. This vocabulary is deliberately
 * wider than any one of them and is narrowed per command, so a person
 * naming Alice writes the same thing wherever they are and `--pick` has
 * one seam to substitute into.
 * See docs/design.md § Naming a target.
 */

import type { EntityId, RecordId, RelationshipTarget } from '@haverstack/core';

/** `any` is listing-only — `grant ls` widens on it; nothing writes it. */
export type TargetRole = 'member' | 'admin' | 'any';

export type Target =
  | { kind: 'anyone' }
  | { kind: 'authenticated' }
  | { kind: 'entity'; entityId: EntityId }
  | { kind: 'group'; groupId: RecordId; role: TargetRole }
  | { kind: 'record'; recordId: RecordId; stackUrl?: string }
  | { kind: 'external'; ns: string; id: string };

/** What a permission names: `anyone` carries no grantee, the rest do. */
export type PermissionTarget =
  | { scope: 'anyone' }
  | { scope: 'entity'; entityId: EntityId }
  | { scope: 'group'; groupId: RecordId; role: 'member' | 'admin' };

/** What `grant()`/`revoke()` write — one role, never the listing widening. */
export type GrantTarget =
  | { kind: 'entity'; entityId: EntityId }
  | { kind: 'group'; groupId: RecordId; role: 'member' | 'admin' }
  | { kind: 'authenticated' };

/** What `listGrants()` accepts — the same union, widened by `role: 'any'`. */
export type GrantQuery =
  | { kind: 'entity'; entityId: EntityId }
  | { kind: 'group'; groupId: RecordId; role: TargetRole }
  | { kind: 'authenticated' };

const GRAMMAR =
  'anyone | authenticated | <did> | entity:<did> | group:<id>/<member|admin> | ' +
  'record:<id>[@<stackUrl>] | external:<ns>/<id>';

function reject(problem: string): never {
  throw new Error(`${problem}\n  --to takes one of: ${GRAMMAR}`);
}

/**
 * A `--to` value as its tagged form. Exactly one shape is inferred rather
 * than spelled — a leading `did:` is an entity — because a DID is the one
 * identifier common to every command and `entity:did:key:…` reads badly on
 * the most frequent call. Everything else names its scheme, so an unknown
 * one is an error rather than a guess.
 */
export function parseTarget(value: string): Target {
  const raw = value.trim();
  if (!raw) reject('A target cannot be empty.');
  if (raw === 'anyone') return { kind: 'anyone' };
  if (raw === 'authenticated') return { kind: 'authenticated' };
  if (raw.startsWith('did:')) return entityTarget(raw);

  const colon = raw.indexOf(':');
  if (colon === -1) reject(`"${raw}" names no scheme.`);
  const rest = raw.slice(colon + 1);

  switch (raw.slice(0, colon)) {
    case 'entity':
      return entityTarget(rest);
    case 'group':
      return groupTarget(rest);
    case 'record':
      return recordTarget(rest);
    case 'external':
      return externalTarget(rest);
    default:
      reject(`"${raw.slice(0, colon)}" is not a target scheme.`);
  }
}

function entityTarget(did: string): Target {
  if (!did) reject('An entity target needs a DID.');
  return { kind: 'entity', entityId: did };
}

function groupTarget(rest: string): Target {
  const slash = rest.indexOf('/');
  if (slash === -1) {
    reject(`"group:${rest}" names no role — member and admin are two different sets of people.`);
  }
  const groupId = rest.slice(0, slash);
  const role = rest.slice(slash + 1);
  if (!groupId) reject('A group target needs a record id.');
  if (role !== 'member' && role !== 'admin' && role !== 'any') {
    reject(`"${role}" is not a role. Use member, admin, or (when listing) any.`);
  }
  return { kind: 'group', groupId, role };
}

function recordTarget(rest: string): Target {
  // A record id is Crockford-32, so the first `@` is the separator and a
  // userinfo `@` inside the URL that follows cannot be mistaken for it.
  const at = rest.indexOf('@');
  const recordId = at === -1 ? rest : rest.slice(0, at);
  const stackUrl = at === -1 ? undefined : rest.slice(at + 1);
  if (!recordId) reject('A record target needs a record id.');
  if (at !== -1 && !stackUrl) reject('A record target naming another stack needs its URL.');
  return { kind: 'record', recordId, ...(stackUrl && { stackUrl }) };
}

function externalTarget(rest: string): Target {
  const slash = rest.indexOf('/');
  if (slash === -1) reject(`"external:${rest}" names a namespace but no identifier within it.`);
  const ns = rest.slice(0, slash);
  const id = rest.slice(slash + 1);
  if (!ns) reject('An external target needs a namespace.');
  if (!id) reject(`An external target needs an identifier within "${ns}".`);
  return { kind: 'external', ns, id };
}

/** The inverse of parseTarget — so a listing's output is a command's input. */
export function formatTarget(target: Target): string {
  switch (target.kind) {
    case 'anyone':
      return 'anyone';
    case 'authenticated':
      return 'authenticated';
    case 'entity':
      return target.entityId;
    case 'group':
      return `group:${target.groupId}/${target.role}`;
    case 'record':
      return target.stackUrl
        ? `record:${target.recordId}@${target.stackUrl}`
        : `record:${target.recordId}`;
    case 'external':
      return `external:${target.ns}/${target.id}`;
  }
}

// ------------------------------------------------- narrowing, per command

function wrongArm(target: Target, verb: string, accepts: string): never {
  throw new Error(
    `${formatTarget(target)} is not something \`${verb}\` can name.\n  ${verb} accepts: ${accepts}`,
  );
}

export function permissionTargetOf(target: Target): PermissionTarget {
  switch (target.kind) {
    case 'anyone':
      return { scope: 'anyone' };
    case 'entity':
      return { scope: 'entity', entityId: target.entityId };
    case 'group':
      if (target.role === 'any') {
        throw new Error('`any` is a listing role — a permission names member or admin.');
      }
      return { scope: 'group', groupId: target.groupId, role: target.role };
    default:
      wrongArm(target, 'perm', 'anyone | <did> | group:<id>/<member|admin>');
  }
}

export function grantTargetOf(target: Target): GrantTarget {
  const query = grantQueryOf(target);
  if (query.kind === 'group' && query.role === 'any') {
    throw new Error('`any` is for `grant ls` — a grant names member or admin.');
  }
  return query as GrantTarget;
}

/** The listing form, which admits the role `grant`/`revoke` refuse. */
export function grantQueryOf(target: Target): GrantQuery {
  switch (target.kind) {
    case 'authenticated':
      return { kind: 'authenticated' };
    case 'entity':
      return { kind: 'entity', entityId: target.entityId };
    case 'group':
      return { kind: 'group', groupId: target.groupId, role: target.role };
    default:
      wrongArm(target, 'grant', 'authenticated | <did> | group:<id>/<member|admin>');
  }
}

export function relationshipTargetOf(target: Target): RelationshipTarget {
  switch (target.kind) {
    case 'record':
      return {
        scope: 'record',
        recordId: target.recordId,
        ...(target.stackUrl && { stackUrl: target.stackUrl }),
      };
    case 'entity':
      return { scope: 'entity', entityId: target.entityId };
    case 'external':
      return { scope: 'external', ns: target.ns, id: target.id };
    default:
      wrongArm(target, 'link', '<did> | record:<id>[@<stackUrl>] | external:<ns>/<id>');
  }
}

// ------------------------------------------------- back from core's shapes

export function targetOfRelationship(target: RelationshipTarget): Target {
  if (target.scope === 'record') {
    return {
      kind: 'record',
      recordId: target.recordId,
      ...(target.stackUrl && { stackUrl: target.stackUrl }),
    };
  }
  if (target.scope === 'entity') return { kind: 'entity', entityId: target.entityId };
  return { kind: 'external', ns: target.ns, id: target.id };
}

export function targetOfPermission(grantee: PermissionTarget): Target {
  if (grantee.scope === 'anyone') return { kind: 'anyone' };
  if (grantee.scope === 'entity') return { kind: 'entity', entityId: grantee.entityId };
  return { kind: 'group', groupId: grantee.groupId, role: grantee.role };
}
