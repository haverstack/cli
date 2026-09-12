/**
 * `hstack tag | link` — add and remove associations directly, outside an
 * edit session. Typing a Crockford-32 record id, a DID, or a relationship
 * target union into a text file is exactly what a text editor is bad at;
 * this is the porcelain half of docs/design.md § Associations — a hybrid
 * split (`tags:` in front matter covers the common case day to day).
 */

import type { RelationshipTarget, Stack } from '@haverstack/core';

async function requireRecord(stack: Stack, id: string) {
  const record = await stack.get(id);
  if (!record) throw new Error(`No record "${id}".`);
  return record;
}

export async function tagAdd(stack: Stack, id: string, label: string): Promise<string> {
  await requireRecord(stack, id);
  const updated = await stack.associate(id, { kind: 'tag', label });
  return `${id} is tagged "${label}" (v${updated.version}).`;
}

export async function tagRemove(stack: Stack, id: string, label: string): Promise<string> {
  await requireRecord(stack, id);
  const updated = await stack.dissociate(id, { kind: 'tag', label });
  return `${id} is no longer tagged "${label}" (v${updated.version}).`;
}

export type LinkTargetOptions = {
  toRecord?: string;
  stackUrl?: string;
  toEntity?: string;
  toExternalNs?: string;
  externalId?: string;
};

/** Core's `RelationshipTarget` union, built from exactly one target flag group. */
export function buildRelationshipTarget(opts: LinkTargetOptions): RelationshipTarget {
  const picked = ['toRecord', 'toEntity', 'toExternalNs'].filter(
    (k) => opts[k as keyof LinkTargetOptions] !== undefined,
  );
  if (picked.length !== 1) {
    throw new Error('Pass exactly one of --to-record, --to-entity, or --to-external <ns>.');
  }

  if (opts.toRecord !== undefined) {
    return {
      scope: 'record',
      recordId: opts.toRecord,
      ...(opts.stackUrl && { stackUrl: opts.stackUrl }),
    };
  }
  if (opts.toEntity !== undefined) {
    return { scope: 'entity', entityId: opts.toEntity };
  }
  if (!opts.externalId) {
    throw new Error('--to-external needs --external-id <id> alongside it.');
  }
  return { scope: 'external', ns: opts.toExternalNs!, id: opts.externalId };
}

function describeTarget(target: RelationshipTarget): string {
  if (target.scope === 'record') {
    return target.stackUrl ? `${target.recordId} @ ${target.stackUrl}` : target.recordId;
  }
  if (target.scope === 'entity') return target.entityId;
  return `${target.ns}:${target.id}`;
}

export async function linkAdd(
  stack: Stack,
  id: string,
  label: string,
  targetOpts: LinkTargetOptions,
): Promise<string> {
  await requireRecord(stack, id);
  const target = buildRelationshipTarget(targetOpts);
  const updated = await stack.associate(id, { kind: 'relationship', label, target });
  return `${id} --${label}--> ${describeTarget(target)} (v${updated.version}).`;
}

export async function linkRemove(
  stack: Stack,
  id: string,
  label: string,
  targetOpts: LinkTargetOptions,
): Promise<string> {
  await requireRecord(stack, id);
  const target = buildRelationshipTarget(targetOpts);
  const updated = await stack.dissociate(id, { kind: 'relationship', label, target });
  return `Removed ${id} --${label}--> ${describeTarget(target)} (v${updated.version}).`;
}
