import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { attachAdd, attachRemove } from '../src/commands/attach.js';

let stack: Stack;
let id: string;
let dir: string;
let filePath: string;

beforeEach(async () => {
  stack = await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));
  await stack.defineType('com.example/contact@1', 'Contact', { name: { kind: 'string' } });
  id = (await stack.create('com.example/contact@1', { name: 'Ada' })).id;
  dir = await mkdtemp(join(tmpdir(), 'hstack-attach-cmd-'));
  filePath = join(dir, 'avatar.png');
  await writeFile(filePath, 'fake-png-bytes');
});

afterEach(() => rm(dir, { recursive: true, force: true }));

describe('attachAdd', () => {
  it('uploads the file and associates it under the given label', async () => {
    const msg = await attachAdd(stack, id, 'avatar', filePath);
    expect(msg).toMatch(/attached "avatar\.png".*as "avatar"/);

    const record = await stack.get(id);
    const assoc = (record?.associations ?? []).find((a) => a.kind === 'attachment');
    expect(assoc).toBeDefined();
    if (assoc?.kind !== 'attachment') throw new Error('unreachable');
    expect(Buffer.from(await stack.getAttachment(assoc.fileId)).toString()).toBe('fake-png-bytes');

    const [meta] = await stack.getAttachmentRecords(assoc.fileId);
    expect(meta.content).toMatchObject({ mimeType: 'image/png', filename: 'avatar.png' });
  });

  it('errors on a missing record', async () => {
    await expect(attachAdd(stack, 'ghost', 'avatar', filePath)).rejects.toThrow(/No record/);
  });

  it('errors clearly on a missing file', async () => {
    await expect(attachAdd(stack, id, 'avatar', join(dir, 'nope.png'))).rejects.toThrow(
      /Could not read/,
    );
  });
});

describe('attachRemove', () => {
  it('dissociates the named label + fileId', async () => {
    await attachAdd(stack, id, 'avatar', filePath);
    const assoc = (await stack.get(id))!.associations!.find((a) => a.kind === 'attachment');
    if (assoc?.kind !== 'attachment') throw new Error('unreachable');

    const msg = await attachRemove(stack, id, 'avatar', assoc.fileId);
    expect(msg).toMatch(/detached "avatar"/);
    expect((await stack.get(id))?.associations ?? []).toEqual([]);
  });
});
