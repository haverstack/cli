/**
 * On `hstack edit`, the record's `embed` attachments are copied into the
 * working directory so they are alongside the editor. Best-effort: a
 * download that fails is a warning, not a blocked edit. Re-uploading files
 * dropped into the directory on commit is Phase 6.
 * See docs/design.md § Associations — attachments both ways.
 */

import { writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Stack } from '@haverstack/core';
import { queryAll } from '../paginate.js';

const EMBED_LABEL = 'embed';

/** Copy every `embed` attachment into `dir`. Returns warnings, never throws. */
export async function downloadEmbeds(
  stack: Stack,
  recordId: string,
  dir: string,
): Promise<string[]> {
  const record = await stack.get(recordId);
  const embeds = (record?.associations ?? []).filter(
    (a) => a.kind === 'attachment' && a.label === EMBED_LABEL,
  );
  if (embeds.length === 0) return [];

  const warnings: string[] = [];
  const used = new Set<string>();
  for (const assoc of embeds) {
    if (assoc.kind !== 'attachment') continue;
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

async function filenameFor(stack: Stack, fileId: string): Promise<string> {
  const records = await queryAll(stack, {
    filter: { typeId: '_attachment@1', attachmentFileId: fileId },
  });
  const earliest = records.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )[0];
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
