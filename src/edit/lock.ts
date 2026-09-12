/**
 * An edit in progress is a lock plus a working directory:
 *
 *   $XDG_STATE_HOME/haverstack/edits/<stack-hash>/<recordId>/
 *     record.md          what the editor opens
 *     .hstack-lock.json  { recordId, typeId, mode, baseVersion, bodyField, … }
 *     <dropped files>    attachments-to-be
 *
 * Per record, not global — editing one must never block editing another —
 * and namespaced by a hash of the stack target so the same record id on two
 * stacks does not collide. Nothing here lives in the working directory or a
 * repository. See docs/design.md § The editing model.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { editsDir } from '../paths.js';

export type EditMode = 'new' | 'edit';

export type LockData = {
  recordId: string;
  typeId: string;
  mode: EditMode;
  /** Which content field holds the body, or null. */
  bodyField: string | null;
  /** Record version at edit time — backs `ifVersion` on commit (edit only). */
  baseVersion?: number;
  /** The `_readonly` block as rendered, for the diff-guard (edit only). */
  readonly?: unknown;
  /** ISO timestamp the edit began. */
  startedAt: string;
  /** Human label of the stack the edit belongs to. */
  stack: string;
};

export type OpenEdit = {
  recordId: string;
  dir: string;
  data: LockData;
  stale: boolean;
  staleReason?: string;
};

export class EditInProgressError extends Error {
  constructor(readonly recordId: string) {
    super(`Already editing "${recordId}". Run \`hstack commit\` or \`hstack discard\` first.`);
    this.name = 'EditInProgressError';
  }
}

const LOCK_FILE = '.hstack-lock.json';
const RECORD_FILE = 'record.md';

/** Filenames reserved by the working directory itself — never an attachment. */
export const RESERVED_WORKING_FILES: readonly string[] = [LOCK_FILE, RECORD_FILE];

function stackKey(stackLabel: string): string {
  return createHash('sha256').update(stackLabel).digest('hex').slice(0, 12);
}

export function editRoot(stackLabel: string): string {
  return join(editsDir(), stackKey(stackLabel));
}

export function editDir(stackLabel: string, recordId: string): string {
  return join(editRoot(stackLabel), recordId);
}

export function recordMdPath(dir: string): string {
  return join(dir, RECORD_FILE);
}

async function readLock(dir: string): Promise<LockData | null> {
  try {
    return JSON.parse(await readFile(join(dir, LOCK_FILE), 'utf8')) as LockData;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function assess(dir: string, data: LockData): Promise<OpenEdit> {
  const hasFile = await exists(recordMdPath(dir));
  return {
    recordId: data.recordId,
    dir,
    data,
    stale: !hasFile,
    staleReason: hasFile ? undefined : 'working file is gone',
  };
}

/** Every edit open for a stack, newest first. */
export async function listEdits(stackLabel: string): Promise<OpenEdit[]> {
  let names: string[];
  try {
    names = await readdir(editRoot(stackLabel));
  } catch {
    return [];
  }
  const edits: OpenEdit[] = [];
  for (const name of names) {
    const dir = join(editRoot(stackLabel), name);
    const data = await readLock(dir);
    if (data) edits.push(await assess(dir, data));
  }
  return edits.sort((a, b) => b.data.startedAt.localeCompare(a.data.startedAt));
}

/** Start an edit: write the working file and the lock. Refuses a live one. */
export async function acquireEdit(
  stackLabel: string,
  data: LockData,
  recordMd: string,
): Promise<string> {
  const dir = editDir(stackLabel, data.recordId);
  const existing = await readLock(dir);
  if (existing && (await exists(recordMdPath(dir)))) {
    throw new EditInProgressError(data.recordId);
  }
  if (existing) await rm(dir, { recursive: true, force: true });

  await mkdir(dir, { recursive: true });
  await writeFile(recordMdPath(dir), recordMd);
  await writeFile(join(dir, LOCK_FILE), `${JSON.stringify(data, null, 2)}\n`);
  return dir;
}

export async function readEditFile(dir: string): Promise<string> {
  return readFile(recordMdPath(dir), 'utf8');
}

export async function writeEditFile(dir: string, text: string): Promise<void> {
  await writeFile(recordMdPath(dir), text);
}

export async function releaseEdit(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Which edit a bare `hstack commit` / `discard` acts on: the named one, else
 * the only one open, else an error listing the choices.
 */
export async function resolveEdit(stackLabel: string, recordId?: string): Promise<OpenEdit> {
  const edits = await listEdits(stackLabel);
  if (recordId) {
    const found = edits.find((e) => e.recordId === recordId);
    if (!found) throw new Error(`No edit in progress for "${recordId}".`);
    return found;
  }
  if (edits.length === 0) throw new Error('No edit in progress.');
  if (edits.length === 1) return edits[0];
  throw new Error(
    `Several edits are open — name one:\n${edits.map((e) => `  ${e.recordId} (${e.data.typeId})`).join('\n')}`,
  );
}
