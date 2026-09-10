import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import {
  commitEdit,
  discardEdit,
  editRecord,
  editStatus,
  newRecord,
} from '../src/commands/edit.js';
import { readEditFile, writeEditFile } from '../src/edit/lock.js';
import { withTempEnv, type TempEnv } from './helpers.js';

let env: TempEnv;
let stack: Stack;
const LABEL = 'test-stack';

beforeEach(async () => {
  env = await withTempEnv();
  stack = await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));
  await stack.defineType('com.example/note@1', 'Note', {
    title: { kind: 'string' },
    text: { kind: 'text', required: true },
    pinned: { kind: 'boolean' },
  });
});
afterEach(async () => {
  await stack.close();
  await env.cleanup();
});

async function fill(dir: string, front: Record<string, string>, body: string) {
  const lines = Object.entries(front).map(([k, v]) => `${k}: ${v}`);
  await writeEditFile(dir, `---\n${lines.join('\n')}\n---\n${body}\n`);
}

describe('new -> commit', () => {
  it('creates the record at the scaffolded id and applies tags', async () => {
    const started = await newRecord(stack, LABEL, 'com.example/note@1', {});
    await fill(
      started.dir,
      { id: started.recordId, type: 'com.example/note@1', tags: '[a, b]', title: 'Hi' },
      'The body.',
    );
    const outcome = await commitEdit(stack, LABEL, started.recordId, {});
    expect(outcome).toEqual({ ok: true, message: expect.stringContaining('Created') });

    const record = await stack.get(started.recordId);
    expect(record?.content).toEqual({ title: 'Hi', text: 'The body.' });
    expect((record?.associations ?? []).map((x) => x.label).sort()).toEqual(['a', 'b']);
    expect(await editStatus(LABEL)).toBe('No edits in progress.');
  });

  it('reports a scaffold left unfilled as a parse failure and keeps the working copy', async () => {
    const started = await newRecord(stack, LABEL, 'com.example/note@1', {});
    // scaffold as-is: required body empty
    const outcome = await commitEdit(stack, LABEL, started.recordId, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reopen).toBe(started.dir);
    expect(await readEditFile(started.dir)).toMatch(/^# ✗ commit rejected/);
  });
});

describe('edit -> commit', () => {
  let id: string;
  beforeEach(async () => {
    const rec = await stack.create('com.example/note@1', { title: 'Orig', text: 'orig body' });
    id = rec.id;
  });

  it('writes changes back as a patch, nulling fields whose line was removed', async () => {
    await stack.update(id, { pinned: true }); // v2, pinned set
    const started = await editRecord(stack, LABEL, id);
    let md = await readEditFile(started.dir);
    md = md
      .replace('title: Orig', 'title: Changed')
      .replace(/^pinned:.*\n/m, '')
      .replace('orig body', 'new body');
    await writeEditFile(started.dir, md);

    const outcome = await commitEdit(stack, LABEL, id, {});
    expect(outcome.ok).toBe(true);
    const record = await stack.get(id);
    expect(record?.content).toEqual({ title: 'Changed', text: 'new body' });
  });

  it('reconciles tags as a set', async () => {
    await stack.associate(id, { kind: 'tag', label: 'keep' });
    await stack.associate(id, { kind: 'tag', label: 'drop' });
    const started = await editRecord(stack, LABEL, id);
    await fill(
      started.dir,
      { id, type: 'com.example/note@1', tags: '[keep, add]', title: 'Orig' },
      'orig body',
    );
    await commitEdit(stack, LABEL, id, {});
    const labels = (await stack.get(id))!
      .associations!.filter((a) => a.kind === 'tag')
      .map((a) => a.label)
      .sort();
    expect(labels).toEqual(['add', 'keep']);
  });

  it('refuses a stale write, keeps the copy, and --force overrides', async () => {
    const started = await editRecord(stack, LABEL, id); // baseVersion 1
    await stack.update(id, { title: 'External edit' }); // -> v2
    await writeEditFile(
      started.dir,
      (await readEditFile(started.dir)).replace('title: Orig', 'title: Mine'),
    );

    const conflict = await commitEdit(stack, LABEL, id, {});
    expect(conflict.ok).toBe(false);
    expect(conflict.message).toMatch(/moved to v2 while you were editing/);
    expect(await editStatus(LABEL)).toMatch(/open/); // still there

    const forced = await commitEdit(stack, LABEL, id, { force: true });
    expect(forced.ok).toBe(true);
    expect((await stack.get(id))?.content.title).toBe('Mine');
  });

  it('rejects a changed parentId', async () => {
    await stack.defineType('com.example/folder@1', 'Folder', {
      name: { kind: 'string', required: true },
    });
    const parent = await stack.create('com.example/folder@1', { name: 'p' });
    const started = await editRecord(stack, LABEL, id);
    await writeEditFile(
      started.dir,
      (await readEditFile(started.dir)).replace(
        'type: com.example/note@1',
        `type: com.example/note@1\nparentId: ${parent.id}`,
      ),
    );
    const outcome = await commitEdit(stack, LABEL, id, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/parentId cannot change/);
  });

  it('a rejected commit re-parses cleanly once the notes are left in place', async () => {
    const started = await editRecord(stack, LABEL, id);
    await writeEditFile(
      started.dir,
      '---\nid: ' + id + '\ntype: com.example/note@1\ntags: []\n---\n\n',
    );
    const first = await commitEdit(stack, LABEL, id, {});
    expect(first.ok).toBe(false);

    // fix the body but leave the prepended `#` notes at the top
    const annotated = await readEditFile(started.dir);
    await writeEditFile(started.dir, annotated.replace(/\n---\n\s*$/, '\n---\nrestored\n'));
    const second = await commitEdit(stack, LABEL, id, {});
    expect(second.ok).toBe(true);
    expect((await stack.get(id))?.content.text).toBe('restored');
  });
});

describe('discard', () => {
  it('removes a single named edit', async () => {
    const rec = await stack.create('com.example/note@1', { title: 't', text: 'b' });
    await editRecord(stack, LABEL, rec.id);
    expect(await discardEdit(LABEL, rec.id, {})).toMatch(/Discarded the edit/);
    expect(await editStatus(LABEL)).toBe('No edits in progress.');
  });

  it('--stale sweeps only edits whose working file is gone', async () => {
    const { rm } = await import('node:fs/promises');
    const live = await stack.create('com.example/note@1', { title: 'a', text: 'b' });
    const dead = await stack.create('com.example/note@1', { title: 'c', text: 'd' });
    await editRecord(stack, LABEL, live.id);
    const deadEdit = await editRecord(stack, LABEL, dead.id);
    await rm(`${deadEdit.dir}/record.md`);

    expect(await discardEdit(LABEL, undefined, { stale: true })).toMatch(/Discarded 1 stale/);
    const { listEdits } = await import('../src/edit/lock.js');
    expect(await listEdits(LABEL)).toHaveLength(1);
  });
});
