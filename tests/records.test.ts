import { beforeEach, describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { MemoryAdapter } from '@haverstack/core/testing';
import { listRecords, recordVersions, showRecord } from '../src/commands/records.js';
import { showType } from '../src/commands/types.js';

let stack: Stack;
let inboxId: string;
let noteId: string;

beforeEach(async () => {
  stack = await Stack.create(new MemoryAdapter({ ownerEntityId: 'did:key:zOwner' }));
  await stack.defineType('com.example/note@1', 'Note', {
    title: { kind: 'string' },
    text: { kind: 'text', required: true },
  });
  await stack.defineType('com.example/task@1', 'Task', { title: { kind: 'string' } });

  const inbox = await stack.create('com.example/note@1', { title: 'Inbox', text: 'root' });
  inboxId = inbox.id;
  const child = await stack.create(
    'com.example/note@1',
    { title: 'Child', text: 'nested' },
    { parentId: inbox.id },
  );
  noteId = child.id;
  await stack.associate(child.id, { kind: 'tag', label: 'starred' });
  await stack.create('com.example/task@1', { title: 'A task' });
});

describe('listRecords', () => {
  it('lists all records with a TYPE column, id-summary rows', async () => {
    const text = await listRecords(stack, {});
    expect(text.split('\n')).toHaveLength(4); // header + 3
    expect(text).toMatch(/^ID\s+TYPE\s+SUMMARY$/m);
    expect(text).toMatch(/com\.example\/note@1\s+Inbox/);
  });

  it('drops the TYPE column when a single exact type is queried', async () => {
    const text = await listRecords(stack, { typeId: 'com.example/note@1' });
    expect(text).toMatch(/^ID\s+SUMMARY$/m);
    expect(text).not.toContain('com.example/note@1');
  });

  it('filters by parent, root, and tag', async () => {
    expect(await listRecords(stack, { parent: inboxId, json: true })).toContain('"Child"');
    const roots = JSON.parse(await listRecords(stack, { root: true, json: true }));
    expect(roots.every((r: { parentId?: string }) => r.parentId === undefined)).toBe(true);
    const tagged = JSON.parse(await listRecords(stack, { tags: ['starred'], json: true }));
    expect(tagged).toHaveLength(1);
  });

  it('rejects --root together with --parent', async () => {
    await expect(listRecords(stack, { root: true, parent: inboxId })).rejects.toThrow(/not both/);
  });

  it('honors --limit and reports an empty result', async () => {
    const one = JSON.parse(await listRecords(stack, { limit: 1, json: true }));
    expect(one).toHaveLength(1);
    expect(await listRecords(stack, { typeId: 'com.example/ghost@1' })).toBe(
      'No matching records.',
    );
  });
});

describe('showRecord', () => {
  it('renders front matter + body and can append history', async () => {
    await stack.update(noteId, { title: 'Child v2' });
    const text = await showRecord(stack, noteId, { history: true });
    expect(text).toMatch(/^---\n/);
    expect(text).toContain('tags:');
    expect(text).toMatch(/Versions\nVER\s+UPDATED/);
  });

  it('emits the record as JSON under --json', async () => {
    const parsed = JSON.parse(await showRecord(stack, noteId, { json: true }));
    expect(parsed.id).toBe(noteId);
  });

  it('errors on a missing id', async () => {
    await expect(showRecord(stack, 'nope', {})).rejects.toThrow(/No record/);
  });
});

describe('recordVersions', () => {
  it('reports "no prior versions" for an untouched record', async () => {
    // inbox was only created; the child note already has a tag-associate snapshot.
    expect(await recordVersions(stack, inboxId, false)).toMatch(/no prior versions/);
  });

  it('lists prior versions after an update', async () => {
    await stack.update(inboxId, { title: 'again' });
    const text = await recordVersions(stack, inboxId, false);
    expect(text).toMatch(/^VER\s+UPDATED/m);
    expect(text).toMatch(/current: v2/);
  });

  it('errors on a missing id', async () => {
    await expect(recordVersions(stack, 'nope', false)).rejects.toThrow(/No record/);
  });
});

describe('showType', () => {
  it('prints a schema table and a header', async () => {
    const text = await showType(stack, 'com.example/note@1', false);
    expect(text).toMatch(/com\.example\/note@1\s+\(Note\)/);
    expect(text).toMatch(/text\s+text\s+required/);
  });

  it('errors on an unknown type', async () => {
    await expect(showType(stack, 'com.example/ghost@9', false)).rejects.toThrow(/No type/);
  });
});
