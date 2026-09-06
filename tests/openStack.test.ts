import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Stack } from '@haverstack/core';
import { LocalAdapter } from '@haverstack/adapter-local';
import { computeMode, openStack } from '../src/openStack.js';
import { saveConfig } from '../src/config.js';
import { collectTypes } from '../src/commands/types.js';
import { withTempEnv, type TempEnv } from './helpers.js';

let env: TempEnv;
let dbPath: string;

beforeEach(async () => {
  env = await withTempEnv();
  const dir = await mkdtemp(join(tmpdir(), 'hstack-db-'));
  dbPath = join(dir, 'stack.db');
  const stack = await Stack.create(
    await LocalAdapter.initialize({ path: dbPath, entityId: 'did:key:zOwner' }),
  );
  await stack.defineType('com.example/task@1', 'Task', { title: { kind: 'string' } });
  await stack.close();
});

afterEach(async () => {
  await rm(join(dbPath, '..'), { recursive: true, force: true });
  await env.cleanup();
});

describe('computeMode', () => {
  it('is owner only when the authenticated DID is the reported owner', () => {
    expect(computeMode('did:key:zOwner', 'did:key:zOwner')).toBe('owner');
    expect(computeMode('did:key:zOwner', 'did:key:zSomeoneElse')).toBe('grantee');
    expect(computeMode('did:key:zOwner', undefined)).toBe('grantee');
  });
});

describe('openStack target resolution', () => {
  it('opens a local file passed as a path', async () => {
    const opened = await openStack({ target: dbPath });
    try {
      expect(opened.mode).toBe('unscoped');
      expect(opened.target).toBe(dbPath);
      expect((await collectTypes(opened.stack)).map((t) => t.id)).toContain('com.example/task@1');
    } finally {
      await opened.close();
    }
  });

  it('resolves a profile that names a local path', async () => {
    await saveConfig({ profiles: { scratch: { path: dbPath } } });
    const opened = await openStack({ target: 'scratch' });
    try {
      expect(opened.target).toBe(dbPath);
    } finally {
      await opened.close();
    }
  });

  it('falls back to $HAVERSTACK_STACK, then to the config default', async () => {
    process.env.HAVERSTACK_STACK = dbPath;
    let opened = await openStack();
    expect(opened.target).toBe(dbPath);
    await opened.close();

    delete process.env.HAVERSTACK_STACK;
    await saveConfig({ default: 'scratch', profiles: { scratch: { path: dbPath } } });
    opened = await openStack();
    expect(opened.target).toBe(dbPath);
    await opened.close();
  });

  it('errors when nothing selects a stack', async () => {
    await expect(openStack()).rejects.toThrow(/No stack selected/);
  });

  it('errors on an unknown profile name', async () => {
    await expect(openStack({ target: 'ghost' })).rejects.toThrow(/Unknown stack "ghost"/);
  });

  it('errors when a profile has neither url nor path', async () => {
    await saveConfig({ profiles: { broken: {} } });
    await expect(openStack({ target: 'broken' })).rejects.toThrow(/neither a url nor a path/);
  });
});
