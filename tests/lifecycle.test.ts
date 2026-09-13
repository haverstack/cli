/**
 * Phase 8 — a full `new → edit → commit → link → rm → restore` lifecycle in
 * one continuous run, against both a temp `LocalAdapter` file and
 * `MemoryAdapter` — the two backends every per-command test file otherwise
 * exercises piecemeal. Catches what only shows up end to end: state one
 * step leaves behind that the next step silently depends on.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { LocalAdapter } from '@haverstack/adapter-local';
import { newRecord, editRecord, commitEdit } from '../src/commands/edit.js';
import { readEditFile, writeEditFile } from '../src/edit/lock.js';
import { linkAdd } from '../src/commands/associations.js';
import { listRecords, removeRecord, restoreRecord, showRecord } from '../src/commands/records.js';
import { withTempEnv, type TempEnv } from './helpers.js';

const NOTE_ID = 'com.example/note@1';
const FOLDER_ID = 'com.example/folder@1';
const LABEL = 'lifecycle-stack';

type Backend = {
  name: string;
  make: () => Promise<{ stack: Stack; cleanup: () => Promise<void> }>;
};

const backends: Backend[] = [
  {
    name: 'MemoryAdapter',
    make: async () => ({
      stack: await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' })),
      cleanup: async () => {},
    }),
  },
  {
    name: 'LocalAdapter',
    make: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'hstack-lifecycle-db-'));
      const stack = await Stack.create(
        await LocalAdapter.initialize({ path: join(dir, 'stack.db'), entityId: 'did:key:zOwner' }),
      );
      return { stack, cleanup: () => rm(dir, { recursive: true, force: true }) };
    },
  },
];

describe.each(backends)('full lifecycle — $name', ({ make }) => {
  let stack: Stack;
  let cleanupBackend: () => Promise<void>;
  let env: TempEnv;

  beforeEach(async () => {
    env = await withTempEnv();
    ({ stack, cleanup: cleanupBackend } = await make());
    await stack.defineType(NOTE_ID, 'Note', {
      title: { kind: 'string' },
      text: { kind: 'text', required: true },
    });
    await stack.defineType(FOLDER_ID, 'Folder', { name: { kind: 'string', required: true } });
  });

  afterEach(async () => {
    await stack.close();
    await cleanupBackend();
    await env.cleanup();
  });

  it('creates, edits, links, soft-deletes, and restores one record', async () => {
    // new
    const started = await newRecord(stack, LABEL, NOTE_ID, {});
    await writeEditFile(
      started.dir,
      `---\nid: ${started.recordId}\ntype: ${NOTE_ID}\ntitle: First draft\n---\nHello.\n`,
    );
    const created = await commitEdit(stack, LABEL, started.recordId, {});
    expect(created).toEqual({ ok: true, message: expect.stringContaining('Created') });
    expect((await stack.get(started.recordId))?.content.title).toBe('First draft');

    // edit
    const editing = await editRecord(stack, LABEL, started.recordId);
    await writeEditFile(
      editing.dir,
      (await readEditFile(editing.dir)).replace('title: First draft', 'title: Revised'),
    );
    const edited = await commitEdit(stack, LABEL, started.recordId, {});
    expect(edited).toEqual({ ok: true, message: expect.stringContaining('Committed') });
    expect((await stack.get(started.recordId))?.content.title).toBe('Revised');

    // link — to a second record, created directly (not the thing under test here)
    const folder = await stack.create(FOLDER_ID, { name: 'Inbox' });
    const linkMsg = await linkAdd(stack, started.recordId, 'files-in', { toRecord: folder.id });
    expect(linkMsg).toMatch(/files-in/);
    const linked = (await stack.get(started.recordId))!;
    expect(linked.associations).toContainEqual(
      expect.objectContaining({ kind: 'relationship', label: 'files-in' }),
    );

    // rm (soft) — excluded from a default listing, but still fetchable
    const rmMsg = await removeRecord(stack, started.recordId, false);
    expect(rmMsg).toMatch(/Deleted/);
    expect((await stack.get(started.recordId))?.deletedAt).toBeDefined();
    const afterDelete = await listRecords(stack, { typeId: NOTE_ID, json: true });
    expect(JSON.parse(afterDelete)).toHaveLength(0);

    // restore — back to normal, listed again, content and links intact
    const restoreMsg = await restoreRecord(stack, started.recordId);
    expect(restoreMsg).toMatch(/Restored/);
    const restored = (await stack.get(started.recordId))!;
    expect(restored.deletedAt).toBeUndefined();
    expect(restored.content.title).toBe('Revised');
    expect(restored.associations).toContainEqual(
      expect.objectContaining({ kind: 'relationship', label: 'files-in' }),
    );
    const afterRestore = await listRecords(stack, { typeId: NOTE_ID, json: true });
    expect(JSON.parse(afterRestore)).toHaveLength(1);

    // show renders cleanly at every stage this test left the record in
    expect(await showRecord(stack, started.recordId, {})).toContain('Revised');
  });
});
