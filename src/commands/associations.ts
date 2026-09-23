/**
 * `hstack tag | link` — add and remove associations directly, outside an
 * edit session. Typing a Crockford-32 record id, a DID, or a relationship
 * target union into a text file is exactly what a text editor is bad at;
 * this is the porcelain half of docs/design.md § Associations — a hybrid
 * split (`tags:` in front matter covers the common case day to day).
 * `link` names its target with `--to` (src/target.ts).
 *
 * These are **no-bump** writes (core 0.33): they leave `version` and
 * `updatedAt` where they stand, so there is no version to report back and
 * a repeat is a silent no-op — hence the before/after comparison that
 * distinguishes "done" from "already so".
 */

import type { Association, Stack, StackRecord } from '@haverstack/core';
import { parseLinkTarget, showLinkTarget } from '../target.js';

async function requireRecord(stack: Stack, id: string): Promise<StackRecord> {
  const record = await stack.get(id);
  if (!record) throw new Error(`No record "${id}".`);
  return record;
}

/** How many associations the record carries — enough to tell a no-op apart. */
function count(record: StackRecord): number {
  return (record.associations ?? []).length;
}

function has(associations: Association[] | undefined, label: string): boolean {
  return (associations ?? []).some((a) => a.kind === 'tag' && a.label === label);
}

export async function tagAdd(stack: Stack, id: string, label: string): Promise<string> {
  const before = await requireRecord(stack, id);
  if (has(before.associations, label)) return `${id} is already tagged "${label}".`;
  await stack.associate(id, { kind: 'tag', label });
  return `${id} is tagged "${label}".`;
}

export async function tagRemove(stack: Stack, id: string, label: string): Promise<string> {
  const before = await requireRecord(stack, id);
  if (!has(before.associations, label))
    return `${id} is not tagged "${label}" — nothing to remove.`;
  await stack.dissociate(id, { kind: 'tag', label });
  return `${id} is no longer tagged "${label}".`;
}

export async function linkAdd(
  stack: Stack,
  id: string,
  label: string,
  to: string,
): Promise<string> {
  const target = parseLinkTarget(to);
  const before = await requireRecord(stack, id);
  const after = await stack.associate(id, { kind: 'relationship', label, target });
  const arrow = `${id} --${label}--> ${showLinkTarget(target)}`;
  return count(after) === count(before) ? `${arrow} — already linked.` : `${arrow}.`;
}

export async function linkRemove(
  stack: Stack,
  id: string,
  label: string,
  to: string,
): Promise<string> {
  const target = parseLinkTarget(to);
  const before = await requireRecord(stack, id);
  const after = await stack.dissociate(id, { kind: 'relationship', label, target });
  const arrow = `${id} --${label}--> ${showLinkTarget(target)}`;
  return count(after) === count(before)
    ? `No such link: ${arrow} — nothing to remove.`
    : `Removed ${arrow}.`;
}
