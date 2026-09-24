/**
 * `--to` — the one way this CLI names the other end of an association.
 *
 * Core keeps three unions apart on purpose: a `RelationshipTarget` names
 * no role, a `PermissionGrantee` has no record scope, and `anyone` is a
 * kind of its own rather than a grantee. This grammar is deliberately
 * wider than any one of them, so a person naming Alice writes the same
 * thing wherever they are — and every entry point below hands back one
 * command's own narrow type, so the wide form never reaches a write.
 *
 * Mixing the tiers is the mistake with real consequences, so a target
 * from the wrong union is refused by name and told what to say instead.
 * Nothing is ever converted: `anyone` reaches anonymous requesters and
 * `authenticated` does not, and no message trades one for the other
 * without saying which way it moves.
 * See docs/design.md § Naming a target.
 */

import type {
  EntityId,
  GrantGrantee,
  GrantQuery,
  PermissionGrantee,
  RecordId,
  RelationshipTarget,
} from '@haverstack/core';

/** `any` is listing-only — `grant ls` widens on it; nothing writes it. */
export type TargetRole = 'member' | 'admin' | 'any';

/** The whole vocabulary. Internal: every export below narrows it first. */
type Target =
  | { kind: 'anyone' }
  | { kind: 'authenticated' }
  | { kind: 'entity'; entityId: EntityId }
  | { kind: 'group'; groupId: RecordId; role: TargetRole }
  | { kind: 'record'; recordId: RecordId; stackUrl?: string }
  | { kind: 'external'; ns: string; id: string };

/** What `perm` names: `anyone` carries no grantee, so it is its own arm. */
export type PermissionTarget = { scope: 'anyone' } | PermissionGrantee;

const GRAMMAR =
  'anyone | authenticated | <did> | entity:<did> | group:<id>/<member|admin> | ' +
  'record:<id>[@<stackUrl>] | external:<ns>/<id>';

function reject(problem: string): never {
  throw new Error(`${problem}\n  --to takes one of: ${GRAMMAR}`);
}

/**
 * A `--to` value as its tagged form. Exactly one shape is inferred rather
 * than spelled — a leading `did:` is an entity — because a DID is the one
 * identifier every command takes and cannot be confused with a Record ID,
 * which is twelve lowercase Crockford base-32 characters and holds no
 * colon. Everything else names its scheme, so an unknown one is an error
 * rather than a guess.
 */
function parseTarget(value: string): Target {
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
function formatTarget(target: Target): string {
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

// ------------------------------------------------------------- refusals

/** What to say instead, per arm a command cannot take. */
type Hints = Partial<Record<Target['kind'], string>>;

function refuse(target: Target, verb: string, accepts: string, hints: Hints): never {
  const hint = hints[target.kind];
  throw new Error(
    `${formatTarget(target)} is not something \`${verb}\` can name.` +
      (hint ? `\n  ${hint}` : '') +
      `\n  ${verb} accepts: ${accepts}`,
  );
}

const PERM_ACCEPTS = 'anyone | <did> | group:<id>/<member|admin>';
const GRANT_ACCEPTS = 'authenticated | <did> | group:<id>/<member|admin>';
const LINK_ACCEPTS = '<did> | record:<id>[@<stackUrl>] | external:<ns>/<id>';

// ------------------------------------------------- one narrow type each

export function parsePermissionTarget(value: string): PermissionTarget {
  const target = parseTarget(value);
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
      refuse(target, 'perm', PERM_ACCEPTS, {
        // Deliberately not a substitution: `anyone` is the wider tier, and
        // offering it as a synonym would be a quiet escalation.
        authenticated:
          'A record permission has no authenticated tier. `anyone` is the nearest, and it is ' +
          'wider — it reaches anonymous requesters too, not only DID holders.',
        record: `To share with a group, name it as a group: group:${target.kind === 'record' ? target.recordId : '<id>'}/<member|admin>.`,
        external:
          'A permission names who reaches the record, and something outside the stack holds no DID.',
      });
  }
}

export function parseGrantTarget(value: string): GrantGrantee {
  const query = parseGrantQuery(value);
  if (query.kind === 'group' && query.role === 'any') {
    throw new Error('`any` is for `grant ls` — a grant names member or admin.');
  }
  return query as GrantGrantee;
}

/** The listing form, which admits the role `grant`/`revoke` refuse. */
export function parseGrantQuery(value: string): GrantQuery {
  const target = parseTarget(value);
  switch (target.kind) {
    case 'authenticated':
      return { kind: 'authenticated' };
    case 'entity':
      return { kind: 'entity', entityId: target.entityId };
    case 'group':
      return { kind: 'group', groupId: target.groupId, role: target.role };
    default:
      refuse(target, 'grant', GRANT_ACCEPTS, {
        anyone:
          'A grant cannot reach anonymous requesters — did you mean `authenticated`, which ' +
          'reaches any entity holding a DID?',
        record: `To grant a group, name it as a group: group:${target.kind === 'record' ? target.recordId : '<id>'}/<member|admin>.`,
        external: 'A grant names who may act, and something outside the stack holds no DID.',
      });
  }
}

export function parseLinkTarget(value: string): RelationshipTarget {
  const target = parseTarget(value);
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
      refuse(target, 'link', LINK_ACCEPTS, {
        // A Group *is* a Record, so the redirect is exact rather than advisory.
        group: `To link to the group's record, use record:${target.kind === 'group' ? target.groupId : '<id>'}.`,
        anyone: '`anyone` names who may read a record, not something a record can point at.',
        authenticated:
          '`authenticated` names who may act on a type, not something a record can point at.',
      });
  }
}

// --------------------------------------------- rendering a narrow target

export function showPermissionTarget(target: PermissionTarget): string {
  if (target.scope === 'anyone') return formatTarget({ kind: 'anyone' });
  if (target.scope === 'entity') {
    return formatTarget({ kind: 'entity', entityId: target.entityId });
  }
  return formatTarget({ kind: 'group', groupId: target.groupId, role: target.role });
}

export function showGrantTarget(target: GrantQuery): string {
  if (target.kind === 'group') {
    return formatTarget({ kind: 'group', groupId: target.groupId, role: target.role });
  }
  return formatTarget(target.kind === 'entity' ? target : { kind: 'authenticated' });
}

export function showLinkTarget(target: RelationshipTarget): string {
  if (target.scope === 'record') {
    return formatTarget({
      kind: 'record',
      recordId: target.recordId,
      ...(target.stackUrl && { stackUrl: target.stackUrl }),
    });
  }
  if (target.scope === 'entity') {
    return formatTarget({ kind: 'entity', entityId: target.entityId });
  }
  return formatTarget({ kind: 'external', ns: target.ns, id: target.id });
}
