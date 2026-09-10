import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireEdit,
  EditInProgressError,
  editDir,
  editRoot,
  listEdits,
  readEditFile,
  releaseEdit,
  resolveEdit,
  type LockData,
} from '../src/edit/lock.js';
import { withTempEnv, type TempEnv } from './helpers.js';

let env: TempEnv;
beforeEach(async () => {
  env = await withTempEnv();
});
afterEach(() => env.cleanup());

const STACK = 'file:///tmp/some.db';

const lock = (recordId: string, over: Partial<LockData> = {}): LockData => ({
  recordId,
  typeId: 'com.example/note@1',
  mode: 'edit',
  bodyField: 'text',
  startedAt: new Date().toISOString(),
  stack: STACK,
  ...over,
});

describe('acquireEdit', () => {
  it('creates a per-record working directory namespaced by a hash of the stack', async () => {
    const dir = await acquireEdit(STACK, lock('rec1'), '---\ntype: x\n---\n');
    expect(dir).toBe(editDir(STACK, 'rec1'));
    expect(dir.startsWith(editRoot(STACK))).toBe(true);
    expect(await readEditFile(dir)).toContain('type: x');
  });

  it('refuses a second acquire while an edit is live', async () => {
    await acquireEdit(STACK, lock('rec1'), 'body');
    await expect(acquireEdit(STACK, lock('rec1'), 'body')).rejects.toBeInstanceOf(
      EditInProgressError,
    );
  });

  it('reclaims a stale lock (working file gone)', async () => {
    const dir = await acquireEdit(STACK, lock('rec1'), 'body');
    await rm(join(dir, 'record.md'));
    // the lock json remains but the edit is stale -> acquire succeeds
    await expect(acquireEdit(STACK, lock('rec1'), 'fresh')).resolves.toBe(dir);
    expect(await readEditFile(dir)).toBe('fresh');
  });

  it('keeps edits for different records side by side', async () => {
    await acquireEdit(STACK, lock('a'), 'A');
    await acquireEdit(STACK, lock('b'), 'B');
    expect((await listEdits(STACK)).map((e) => e.recordId).sort()).toEqual(['a', 'b']);
  });
});

describe('listEdits', () => {
  it('is empty for an unknown stack and marks stale edits', async () => {
    expect(await listEdits('nope')).toEqual([]);
    const dir = await acquireEdit(STACK, lock('r'), 'x');
    expect((await listEdits(STACK))[0].stale).toBe(false);
    await rm(join(dir, 'record.md'));
    expect((await listEdits(STACK))[0]).toMatchObject({
      stale: true,
      staleReason: 'working file is gone',
    });
  });
});

describe('resolveEdit', () => {
  it('returns the only edit, the named edit, or an informative error', async () => {
    await expect(resolveEdit(STACK)).rejects.toThrow(/No edit in progress/);
    await acquireEdit(STACK, lock('solo'), 'x');
    expect((await resolveEdit(STACK)).recordId).toBe('solo');

    await acquireEdit(STACK, lock('other'), 'y');
    await expect(resolveEdit(STACK)).rejects.toThrow(/Several edits are open/);
    expect((await resolveEdit(STACK, 'other')).recordId).toBe('other');
    await expect(resolveEdit(STACK, 'ghost')).rejects.toThrow(/No edit in progress for "ghost"/);
  });
});

describe('releaseEdit', () => {
  it('removes the working directory', async () => {
    const dir = await acquireEdit(STACK, lock('r'), 'x');
    await releaseEdit(dir);
    expect(await listEdits(STACK)).toEqual([]);
  });
});
