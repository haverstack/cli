/**
 * The editing loop: `hstack new | edit | status | commit | discard`.
 *
 * `new`/`edit` materialise a working directory and return where it is —
 * launching the editor is the CLI layer's job (src/cli.ts), so this stays
 * testable without spawning a process. `commit` parses the file, writes it
 * back under `ifVersion`, reconciles tags, and releases the lock.
 * See docs/design.md § The editing model.
 */

import type { Stack, StackType } from '@haverstack/core';
import { generateId } from '@haverstack/core';
import { loadConfig, type Config } from '../config.js';
import {
  bodyFieldOf,
  readonlyBlock,
  RESERVED_FRONT_MATTER_KEYS,
  renderRecord,
} from '../record/format.js';
import { scaffoldRecord } from '../record/scaffold.js';
import { parseRecord, RecordParseError } from '../record/parse.js';
import { downloadEmbeds } from '../edit/attachments.js';
import { iso } from '../util.js';
import {
  acquireEdit,
  listEdits,
  readEditFile,
  releaseEdit,
  resolveEdit,
  writeEditFile,
  type LockData,
} from '../edit/lock.js';

// ---------------------------------------------------------------- new / edit

export type StartResult = { recordId: string; dir: string; file: string; warnings: string[] };

export type NewOptions = {
  id?: string;
  parent?: string;
  body?: string;
  minimal?: boolean;
};

export async function newRecord(
  stack: Stack,
  stackLabel: string,
  typeId: string,
  opts: NewOptions,
): Promise<StartResult> {
  const type = await stack.getType(typeId);
  if (!type) throw new Error(`No type "${typeId}". Register it with \`hstack types define\`.`);

  const bodyField = await resolveBodyField(type, opts.body, await loadConfig(), stackLabel);
  const recordId = opts.id ?? generateId();
  const text = scaffoldRecord(type, {
    id: recordId,
    parentId: opts.parent,
    bodyField,
    minimal: opts.minimal,
  });
  const dir = await acquireEdit(
    stackLabel,
    lock(recordId, typeId, 'new', bodyField, stackLabel),
    text,
  );
  return { recordId, dir, file: `${dir}/record.md`, warnings: [] };
}

export async function editRecord(
  stack: Stack,
  stackLabel: string,
  recordId: string,
): Promise<StartResult> {
  const record = await stack.get(recordId);
  if (!record) throw new Error(`No record "${recordId}".`);
  if (record.deletedAt) {
    throw new Error(`Record "${recordId}" is deleted. Run \`hstack restore ${recordId}\` first.`);
  }
  const type = await stack.getType(record.typeId);
  const bodyField = bodyFieldOf(type);
  const text = renderRecord(record, type);
  const data = lock(recordId, record.typeId, 'edit', bodyField, stackLabel);
  data.baseVersion = record.version;
  data.readonly = readonlyBlock(record);

  const dir = await acquireEdit(stackLabel, data, text);
  const warnings = await downloadEmbeds(stack, recordId, dir);
  return { recordId, dir, file: `${dir}/record.md`, warnings };
}

// ---------------------------------------------------------------- status

export async function editStatus(stackLabel: string): Promise<string> {
  const edits = await listEdits(stackLabel);
  if (edits.length === 0) return 'No edits in progress.';

  const idW = Math.max(6, ...edits.map((e) => e.recordId.length));
  const typeW = Math.max(4, ...edits.map((e) => e.data.typeId.length));
  const rows = edits.map((e) => {
    const state = e.stale ? `stale — ${e.staleReason}` : 'open';
    return `${e.recordId.padEnd(idW)}  ${e.data.typeId.padEnd(typeW)}  ${e.data.mode.padEnd(4)}  ${age(e.data.startedAt)}  ${state}`;
  });
  return [`${'RECORD'.padEnd(idW)}  ${'TYPE'.padEnd(typeW)}  MODE  AGE   STATE`, ...rows].join(
    '\n',
  );
}

// ---------------------------------------------------------------- commit

export type CommitOptions = { force?: boolean };
export type CommitOutcome = {
  ok: boolean;
  message: string;
  /** Set when the file was rejected and rewritten with notes — reopen the editor here. */
  reopen?: string;
};

export async function commitEdit(
  stack: Stack,
  stackLabel: string,
  recordId: string | undefined,
  opts: CommitOptions,
): Promise<CommitOutcome> {
  const edit = await resolveEdit(stackLabel, recordId);
  const { data, dir } = edit;
  const type = await stack.getType(data.typeId);
  const raw = await readEditFile(dir);
  const text = stripNotes(raw);

  let parsed;
  try {
    parsed = parseRecord(text, type, {
      bodyField: data.bodyField ?? undefined,
      expectId: data.mode === 'edit' ? data.recordId : undefined,
      expectType: data.typeId,
      readonlyBaseline: data.mode === 'edit' ? data.readonly : undefined,
    });
  } catch (err) {
    if (!(err instanceof RecordParseError)) throw err;
    await writeEditFile(dir, notesBanner(err) + text);
    return {
      ok: false,
      reopen: dir,
      message: `${err.message}\n\nFix ${dir}/record.md and run \`hstack commit\` again.`,
    };
  }

  try {
    if (data.mode === 'new') {
      let record = await stack.create(data.typeId, parsed.content, {
        id: parsed.id ?? data.recordId,
        parentId: parsed.parentId ?? undefined,
      });
      // Each tag associate bumps the version, so the final count comes from
      // the last write, not from create().
      for (const label of parsed.tags)
        record = await stack.associate(record.id, { kind: 'tag', label });
      await releaseEdit(dir);
      return { ok: true, message: `Created ${record.id} (${data.typeId}), v${record.version}.` };
    }

    const record = await stack.get(data.recordId);
    if (!record) return { ok: false, message: `Record "${data.recordId}" no longer exists.` };

    const patch = buildPatch(record.content, parsed.content);
    // mutate() carries content and parentId in one fenced, one-version
    // write; core checks the destination exists and refuses a cycle. Tag
    // reconcile runs after (associations are set-merged, not fenced), so
    // re-read for the version the record actually ended on.
    await stack.mutate(
      data.recordId,
      { contentPatch: patch, parentId: parsed.parentId },
      { ifVersion: opts.force ? undefined : data.baseVersion },
    );
    await reconcileTags(stack, record, parsed.tags);
    await releaseEdit(dir);
    const final = await stack.get(data.recordId);
    return { ok: true, message: `Committed ${data.recordId}, v${final?.version ?? '?'}.` };
  } catch (err) {
    // Match on the stable `code` rather than `instanceof`: a linked dev
    // setup can load two copies of @haverstack/core, and the stack's errors
    // then fail an identity check against this package's classes.
    const code = stackErrorCode(err);
    if (code === 'version_conflict') {
      const v = err as { actualVersion?: number; expectedVersion?: number };
      return {
        ok: false,
        message:
          `Conflict: "${data.recordId}" moved to v${v.actualVersion} while you were editing ` +
          `(you started from v${v.expectedVersion}).\nReview with \`hstack show ${data.recordId} --history\`, ` +
          `then re-\`hstack edit\` or \`hstack commit --force\`. Your working copy is kept.`,
      };
    }
    // Any other recognized Stack error (bad/missing parentId, an
    // undeclared or malformed content field, …) — the message already
    // names what's wrong; the working copy survives so the fix costs
    // nothing.
    if (code) {
      return {
        ok: false,
        message: `${(err as Error).message}\nYour working copy is kept at ${dir}.`,
      };
    }
    throw err;
  }
}

function stackErrorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

// ---------------------------------------------------------------- discard

export async function discardEdit(
  stackLabel: string,
  recordId: string | undefined,
  opts: { stale?: boolean },
): Promise<string> {
  if (opts.stale) {
    const stale = (await listEdits(stackLabel)).filter((e) => e.stale);
    for (const e of stale) await releaseEdit(e.dir);
    return stale.length ? `Discarded ${stale.length} stale edit(s).` : 'No stale edits.';
  }
  const edit = await resolveEdit(stackLabel, recordId);
  await releaseEdit(edit.dir);
  return `Discarded the edit for ${edit.recordId}.`;
}

// ---------------------------------------------------------------- helpers

function lock(
  recordId: string,
  typeId: string,
  mode: LockData['mode'],
  bodyField: string | null,
  stackLabel: string,
): LockData {
  return { recordId, typeId, mode, bodyField, startedAt: iso(new Date()), stack: stackLabel };
}

async function resolveBodyField(
  type: StackType,
  flag: string | undefined,
  config: Config,
  stackLabel: string,
): Promise<string | null> {
  if (flag) return flag;
  const perType =
    config.profiles[stackLabel]?.body?.[type.id] ??
    config.profiles[stackLabel]?.body?.[type.baseId];
  if (perType) return perType;

  const textFields = Object.entries(type.schema).filter(([, d]) => d.kind === 'text');
  if (textFields.length > 1 && !bodyFieldOf(type)) {
    throw new Error(
      `Type ${type.id} has ${textFields.length} text fields — pass --body <field> ` +
        `(or set one under [profiles.<name>.body] in config.toml).`,
    );
  }
  return bodyFieldOf(type);
}

function buildPatch(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown | null> {
  const patch: Record<string, unknown | null> = { ...after };
  for (const key of Object.keys(before)) {
    if (RESERVED_FRONT_MATTER_KEYS.includes(key)) continue;
    if (!(key in after)) patch[key] = null;
  }
  return patch;
}

async function reconcileTags(
  stack: Stack,
  record: { id: string; associations?: { kind: string; label: string }[] },
  desired: string[],
): Promise<void> {
  const current = new Set(
    (record.associations ?? []).filter((a) => a.kind === 'tag').map((a) => a.label),
  );
  const want = new Set(desired);
  for (const label of want)
    if (!current.has(label)) await stack.associate(record.id, { kind: 'tag', label });
  for (const label of current)
    if (!want.has(label)) await stack.dissociate(record.id, { kind: 'tag', label });
}

const NOTES_RE = /^(?:[ \t]*(?:#[^\n]*)?\n)*(?=---\n)/;

function stripNotes(text: string): string {
  return text.replace(NOTES_RE, '');
}

function notesBanner(err: RecordParseError): string {
  return [
    '# ✗ commit rejected — fix these, then run `hstack commit` again:',
    ...err.issues.map((i) => `#   ${i.path ? `${i.path}: ` : ''}${i.message}`),
    '',
    '',
  ].join('\n');
}

function age(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr}h` : `${Math.floor(hr / 24)}d`;
}
