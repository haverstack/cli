/**
 * `hstack ls | show | versions` — read records.
 *
 * Every listing loops the cursor to exhaustion (see paginate.ts); `--json`
 * emits the raw records for piping. `show` renders the `record.md` view
 * (record/format.ts). See docs/design.md § Command surface.
 */

import type { RecordFilter, Stack, StackRecord, RecordVersion } from '@haverstack/core';
import { queryAll } from '../paginate.js';
import { renderRecord, summarize } from '../record/format.js';
import { shortDid } from '../config.js';
import { iso } from '../util.js';

export type ListOptions = {
  typeId?: string;
  base?: string;
  parent?: string;
  root?: boolean;
  tags?: string[];
  limit?: number;
  json?: boolean;
};

export async function listRecords(stack: Stack, opts: ListOptions): Promise<string> {
  if (opts.root && opts.parent) {
    throw new Error('Pass either --root or --parent <id>, not both.');
  }

  const filter: RecordFilter = {};
  if (opts.typeId) filter.typeId = opts.typeId;
  if (opts.base) filter.baseId = opts.base;
  if (opts.root) filter.parentId = null;
  else if (opts.parent) filter.parentId = opts.parent;
  if (opts.tags && opts.tags.length > 0) filter.tags = opts.tags;

  const records = await queryAll(stack, { filter }, opts.limit);
  if (opts.json) return JSON.stringify(records, null, 2);
  if (records.length === 0) return 'No matching records.';

  // The type column is redundant when the query already pins one exact type.
  const showType = !(opts.typeId && !opts.base);
  const idWidth = Math.max(2, ...records.map((r) => r.id.length));
  const typeWidth = showType ? Math.max(4, ...records.map((r) => r.typeId.length)) : 0;

  const row = (id: string, type: string, summary: string) =>
    (showType
      ? `${id.padEnd(idWidth)}  ${type.padEnd(typeWidth)}  ${summary}`
      : `${id.padEnd(idWidth)}  ${summary}`
    ).trimEnd();

  return [
    row('ID', 'TYPE', 'SUMMARY'),
    ...records.map((r) => row(r.id, r.typeId, r.deletedAt ? '(deleted)' : summarize(r))),
  ].join('\n');
}

export type ShowOptions = { json?: boolean; history?: boolean };

export async function showRecord(stack: Stack, id: string, opts: ShowOptions): Promise<string> {
  const record = await stack.get(id);
  if (!record) throw new Error(`No record "${id}".`);
  const type = await stack.getType(record.typeId);

  if (opts.json) {
    const payload = opts.history ? { record, versions: await stack.getVersions(id) } : record;
    return JSON.stringify(payload, null, 2);
  }

  let text = renderRecord(record, type);
  if (opts.history) {
    text += `\nVersions\n${formatVersions(record, await stack.getVersions(id))}`;
  }
  return text;
}

export async function recordVersions(stack: Stack, id: string, json: boolean): Promise<string> {
  const record = await stack.get(id);
  const versions = await stack.getVersions(id);
  if (!record && versions.length === 0) throw new Error(`No record "${id}".`);
  if (json) return JSON.stringify(versions, null, 2);
  return formatVersions(record, versions);
}

function formatVersions(record: StackRecord | null, versions: RecordVersion[]): string {
  const current = record ? `current: v${record.version}` : '';
  if (versions.length === 0) {
    return record ? `Record is at v${record.version} with no prior versions.` : 'No versions.';
  }

  const actor = (v: RecordVersion) => {
    const who = v.updatedBy ?? v.entityId;
    return who ? shortDid(who) : '—';
  };
  const actorWidth = Math.max(2, ...versions.map((v) => actor(v).length));

  const lines = [
    `VER  UPDATED                   ${'BY'.padEnd(actorWidth)}  TYPE`,
    ...versions.map(
      (v) =>
        `${String(v.version).padEnd(3)}  ${iso(v.updatedAt).padEnd(24)}  ` +
        `${actor(v).padEnd(actorWidth)}  ${v.typeId}`,
    ),
  ];
  if (current) lines.push(current);
  return lines.join('\n');
}
