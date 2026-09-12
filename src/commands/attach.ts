/**
 * `hstack attach` — attach a file outside an edit session, or under a
 * label other than `embed`. The common case (files dropped in the working
 * directory during `hstack edit`) is handled by commit's own reconcile;
 * see src/edit/attachments.ts and docs/design.md § Attachments — both ways.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Stack } from '@haverstack/core';
import { inferContentTypeFromFilename } from '@haverstack/core/wire';

async function requireRecord(stack: Stack, id: string) {
  const record = await stack.get(id);
  if (!record) throw new Error(`No record "${id}".`);
  return record;
}

export async function attachAdd(
  stack: Stack,
  id: string,
  label: string,
  filePath: string,
): Promise<string> {
  await requireRecord(stack, id);

  let bytes: Uint8Array;
  try {
    bytes = await readFile(filePath);
  } catch (err) {
    throw new Error(`Could not read "${filePath}": ${(err as Error).message}`, { cause: err });
  }

  const name = basename(filePath);
  const mimeType = inferContentTypeFromFilename(name) ?? 'application/octet-stream';
  const attachment = await stack.putAttachment(bytes, mimeType, name);
  const updated = await stack.associate(id, {
    kind: 'attachment',
    label,
    fileId: attachment.content.fileId,
  });
  return `${id}: attached "${name}" (${attachment.content.fileId.slice(0, 12)}…) as "${label}" (v${updated.version}).`;
}

export async function attachRemove(
  stack: Stack,
  id: string,
  label: string,
  fileId: string,
): Promise<string> {
  await requireRecord(stack, id);
  const updated = await stack.dissociate(id, { kind: 'attachment', label, fileId });
  return `${id}: detached "${label}" (${fileId.slice(0, 12)}…) (v${updated.version}).`;
}
