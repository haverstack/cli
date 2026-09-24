/**
 * `hstack attach` — attach a file outside an edit session, or under a
 * label other than `embed`. The common case (files dropped in the working
 * directory during `hstack edit`) is handled by commit's own reconcile;
 * see src/edit/attachments.ts and docs/design.md § Attachments — both ways.
 * Associating is a no-bump write, so neither verb reports a version.
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
  // `attachmentRecordId` names the upload this particular reference came
  // from, so a filename lookup resolves to it rather than to whichever
  // other record happened to upload the same bytes.
  await stack.associate(id, {
    kind: 'attachment',
    label,
    fileId: attachment.content.fileId,
    attachmentRecordId: attachment.id,
  });
  return `${id}: attached "${name}" (${attachment.content.fileId.slice(0, 12)}…) as "${label}".`;
}

export async function attachRemove(
  stack: Stack,
  id: string,
  label: string,
  fileId: string,
): Promise<string> {
  const before = await requireRecord(stack, id);
  const after = await stack.dissociate(id, { kind: 'attachment', label, fileId });
  if ((after.associations ?? []).length === (before.associations ?? []).length) {
    return `${id}: no "${label}" attachment for ${fileId.slice(0, 12)}… — nothing to detach.`;
  }
  return `${id}: detached "${label}" (${fileId.slice(0, 12)}…).`;
}
