import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { downloadEmbeds, reconcileAttachments } from '../src/edit/attachments.js';

let stack: Stack;
let id: string;
let dir: string;

beforeEach(async () => {
  stack = await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));
  await stack.defineType('com.example/note@1', 'Note', { title: { kind: 'string' } });
  id = (await stack.create('com.example/note@1', { title: 'A' })).id;
  dir = await mkdtemp(join(tmpdir(), 'hstack-attach-'));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

async function embed(bytes: string, filename?: string) {
  const attachment = await stack.putAttachment(
    new TextEncoder().encode(bytes),
    'text/plain',
    filename,
  );
  await stack.associate(id, {
    kind: 'attachment',
    label: 'embed',
    fileId: attachment.content.fileId,
  });
  return attachment.content.fileId;
}

describe('downloadEmbeds', () => {
  it('is a no-op with no embed attachments', async () => {
    expect(await downloadEmbeds(stack, id, dir)).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('writes each embed under its recorded filename', async () => {
    await embed('hello', 'notes.txt');
    const warnings = await downloadEmbeds(stack, id, dir);
    expect(warnings).toEqual([]);
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('hello');
  });

  it('falls back to a fileId-derived name with no recorded filename', async () => {
    const fileId = await embed('hi');
    await downloadEmbeds(stack, id, dir);
    expect(await readdir(dir)).toEqual([`${fileId.slice(0, 12)}.bin`]);
  });

  it('disambiguates two embeds sharing a filename', async () => {
    await embed('one', 'a.txt');
    await embed('two', 'a.txt');
    await downloadEmbeds(stack, id, dir);
    expect((await readdir(dir)).sort()).toEqual(['a (2).txt', 'a.txt']);
  });
});

describe('reconcileAttachments', () => {
  it('uploads and embeds a new file, inferring its mime type', async () => {
    await writeFile(join(dir, 'photo.png'), 'fake-bytes');
    const warnings = await reconcileAttachments(stack, id, dir);
    expect(warnings).toEqual([]);

    const record = await stack.get(id);
    const embeds = (record?.associations ?? []).filter((a) => a.kind === 'attachment');
    expect(embeds).toHaveLength(1);
    if (embeds[0].kind !== 'attachment') throw new Error('unreachable');
    const [meta] = await stack.getAttachmentRecords(embeds[0].fileId);
    expect(meta.content).toMatchObject({ mimeType: 'image/png', filename: 'photo.png' });
  });

  it('is a content-addressed no-op for a file already embedded, changed name aside', async () => {
    await writeFile(join(dir, 'a.txt'), 'same content');
    await reconcileAttachments(stack, id, dir);
    const versionAfterFirst = (await stack.get(id))!.version;

    await reconcileAttachments(stack, id, dir); // nothing changed
    expect((await stack.get(id))!.version).toBe(versionAfterFirst);
  });

  it('dissociates an embed whose file was removed from the directory', async () => {
    await writeFile(join(dir, 'a.txt'), 'content');
    await reconcileAttachments(stack, id, dir);
    expect((await stack.get(id))!.associations).toHaveLength(1);

    await rm(join(dir, 'a.txt'));
    await reconcileAttachments(stack, id, dir);
    expect((await stack.get(id))!.associations ?? []).toEqual([]);
  });

  it('leaves an unrelated (non-embed) association alone', async () => {
    await stack.associate(id, { kind: 'tag', label: 'keep' });
    await writeFile(join(dir, 'a.txt'), 'content');
    await reconcileAttachments(stack, id, dir);
    const record = await stack.get(id);
    expect(record?.associations).toEqual(expect.arrayContaining([{ kind: 'tag', label: 'keep' }]));
    expect(record?.associations).toHaveLength(2);
  });

  it('reports an unreadable file as a warning rather than throwing', async () => {
    // A directory entry that is not a plain file (readFile on it fails).
    await mkdir(join(dir, 'a-directory'));
    const warnings = await reconcileAttachments(stack, id, dir);
    expect(warnings.some((w) => w.includes('a-directory'))).toBe(true);
  });
});
