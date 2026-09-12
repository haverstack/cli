/**
 * Attachments as files in the working directory — the whole media workflow
 * for an editing session: drop a file next to `record.md`, it becomes an
 * `embed` attachment on `commit`; delete one, it's dissociated. `hstack
 * edit` downloads the record's existing embeds first, so the directory is
 * a faithful starting point. Both directions are best-effort — a failure
 * is a warning, never a blocked edit or a blocked commit.
 * See docs/design.md § Associations — attachments both ways.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Association, Stack } from '@haverstack/core';
import { inferContentTypeFromFilename } from '@haverstack/core/wire';
import { RESERVED_WORKING_FILES } from './lock.js';

const EMBED_LABEL = 'embed';

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function filesIn(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((n) => !RESERVED_WORKING_FILES.includes(n));
  } catch {
    return [];
  }
}

function embedAssociations(associations: Association[] | undefined) {
  return (associations ?? []).filter(
    (a): a is Extract<Association, { kind: 'attachment' }> =>
      a.kind === 'attachment' && a.label === EMBED_LABEL,
  );
}

/** Copy every `embed` attachment into `dir`. Returns warnings, never throws. */
export async function downloadEmbeds(
  stack: Stack,
  recordId: string,
  dir: string,
): Promise<string[]> {
  const record = await stack.get(recordId);
  const embeds = embedAssociations(record?.associations);
  if (embeds.length === 0) return [];

  const warnings: string[] = [];
  const used = new Set<string>();
  for (const assoc of embeds) {
    try {
      const bytes = await stack.getAttachment(assoc.fileId);
      const name = uniqueName(await filenameFor(stack, assoc.fileId), used);
      await writeFile(join(dir, name), bytes);
    } catch (err) {
      warnings.push(
        `could not download attachment ${assoc.fileId.slice(0, 12)}…: ${(err as Error).message}`,
      );
    }
  }
  return warnings;
}

/**
 * Reconcile `embed` attachments against the working directory: a file
 * whose content isn't already an embed is uploaded and associated; an
 * embed whose content no file in the directory still holds is dissociated
 * (never deletes the bytes — that's `collectAttachmentGarbage()`'s job, on
 * its own grace period). Identity is content, not filename — sha256 is
 * the fileId itself, so re-committing an unchanged file is a no-op.
 */
export async function reconcileAttachments(
  stack: Stack,
  recordId: string,
  dir: string,
): Promise<string[]> {
  const warnings: string[] = [];
  const names = await filesIn(dir);

  const record = await stack.get(recordId);
  const current = new Map(embedAssociations(record?.associations).map((a) => [a.fileId, a]));

  const desired = new Map<string, { name: string; bytes: Uint8Array }>();
  for (const name of names) {
    try {
      const bytes = await readFile(join(dir, name));
      desired.set(sha256Hex(bytes), { name, bytes });
    } catch (err) {
      warnings.push(`could not read "${name}": ${(err as Error).message}`);
    }
  }

  for (const [fileId, { name, bytes }] of desired) {
    if (current.has(fileId)) continue; // unchanged — content-addressed skip
    try {
      const mimeType = inferContentTypeFromFilename(name) ?? 'application/octet-stream';
      await stack.putAttachment(bytes, mimeType, name);
      await stack.associate(recordId, { kind: 'attachment', label: EMBED_LABEL, fileId });
    } catch (err) {
      warnings.push(`could not attach "${name}": ${(err as Error).message}`);
    }
  }

  for (const fileId of current.keys()) {
    if (desired.has(fileId)) continue;
    try {
      await stack.dissociate(recordId, { kind: 'attachment', label: EMBED_LABEL, fileId });
    } catch (err) {
      warnings.push(`could not detach ${fileId.slice(0, 12)}…: ${(err as Error).message}`);
    }
  }

  return warnings;
}

async function filenameFor(stack: Stack, fileId: string): Promise<string> {
  const [earliest] = await stack.getAttachmentRecords(fileId);
  const named = earliest?.content.filename;
  return typeof named === 'string' && named.trim() ? named : `${fileId.slice(0, 12)}.bin`;
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}
