/**
 * Phase 8 — server-path tests, against a real, listening
 * `@haverstack/server` (not a mocked fetch): the wire round trip for
 * permission refusals, `includeUnlisted` denial, and `ifVersion` conflicts.
 *
 * The "owner" side is exercised via `server.ctx.stack` directly — the same
 * unscoped, full-trust `Stack` the real server process holds internally —
 * standing in for an operator with direct access, since `startTestServer`'s
 * fixed entity id has no real keypair a DID handshake could authenticate
 * as (see docs/design.md § Profiles: auth is DID challenge-response only,
 * never a shared token, so there is no lower-friction way to open the
 * *client* side as owner here). The "grantee" side is the real thing: a
 * generated did:key, a profile, and `openStack()` performing the actual
 * challenge-response handshake against the live server — proving the code
 * this package ships, not a stand-in for it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '@haverstack/server/testing';
import { openStack, type OpenedStack } from '../src/openStack.js';
import { saveConfig } from '../src/config.js';
import { generateAndStoreKey } from '../src/keys.js';
import { editRecord, commitEdit, discardEdit } from '../src/commands/edit.js';
import { readEditFile, writeEditFile } from '../src/edit/lock.js';
import { withTempEnv, type TempEnv } from './helpers.js';

const TYPE_ID = 'com.example/note@1';

let server: TestServer;
let env: TempEnv;

beforeEach(async () => {
  server = await startTestServer();
  env = await withTempEnv();
  await server.ctx.stack.defineType(TYPE_ID, 'Note', {
    title: { kind: 'string' },
    text: { kind: 'text', required: true },
  });
});

afterEach(async () => {
  await env.cleanup();
  await server.close();
});

/** Generates a grantee identity, saves it as a profile, and opens it for real. */
async function openAsGrantee(): Promise<OpenedStack> {
  const { did, keyRef } = await generateAndStoreKey('grantee');
  await saveConfig({
    profiles: {
      grantee: { url: server.url, did, key: keyRef, expectedOwner: server.ctx.stack.ownerEntityId },
    },
  });
  return openStack({ target: 'grantee' });
}

/** Changes the front-matter `title:` line, so commitEdit sends a real, non-empty patch. */
async function changeTitle(dir: string, to: string): Promise<void> {
  const text = await readEditFile(dir);
  await writeEditFile(dir, text.replace(/title: .*/, `title: ${to}`));
}

describe('server-path integration', () => {
  it('opens a real grantee session over the wire and reports the right mode', async () => {
    const opened = await openAsGrantee();
    try {
      expect(opened.mode).toBe('grantee');
      expect(opened.did).toBeDefined();
      expect(opened.did).not.toBe(server.ctx.stack.ownerEntityId);
    } finally {
      await opened.close();
    }
  });

  it('refuses a mutate the grantee was only given read-any for', async () => {
    const record = await server.ctx.stack.create(TYPE_ID, {
      title: 'orig',
      text: 'owner-authored',
    });
    await server.ctx.stack.grant(null, [{ typeId: TYPE_ID, actions: ['read-any'] }]);

    const opened = await openAsGrantee();
    try {
      // Read succeeds — read-any was granted.
      expect(await opened.stack.get(record.id)).not.toBeNull();

      const started = await editRecord(opened.stack, 'grantee', record.id);
      await changeTitle(started.dir, 'changed-by-grantee');

      const outcome = await commitEdit(opened.stack, 'grantee', record.id, {});
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toMatch(/permission/i);
      // Refused, not silently applied: the record is exactly as it was.
      expect((await server.ctx.stack.get(record.id))?.content.title).toBe('orig');
    } finally {
      await discardEdit('grantee', record.id, {}).catch(() => {});
      await opened.close();
    }
  });

  it('denies includeUnlisted to a grantee, over the real wire', async () => {
    await server.ctx.stack.create(TYPE_ID, { text: 'irrelevant' }, { unlisted: true });
    await server.ctx.stack.grant(null, [{ typeId: TYPE_ID, actions: ['read-any'] }]);

    const opened = await openAsGrantee();
    try {
      await expect(
        opened.stack.query({ filter: { typeId: TYPE_ID, includeUnlisted: true } }),
      ).rejects.toThrow(/includeUnlisted is owner-only/);
    } finally {
      await opened.close();
    }
  });

  it('reports a version conflict when the record moves under an in-progress edit', async () => {
    const record = await server.ctx.stack.create(TYPE_ID, { title: 'orig', text: 'v1' });
    await server.ctx.stack.grant(null, [{ typeId: TYPE_ID, actions: ['read-any', 'update-any'] }]);

    const opened = await openAsGrantee();
    try {
      const started = await editRecord(opened.stack, 'grantee', record.id);
      await changeTitle(started.dir, 'changed-by-grantee');

      // The record moves on before the grantee commits — same story as the
      // real world (another writer, or the owner, editing concurrently).
      await server.ctx.stack.mutate(record.id, { contentPatch: { text: 'v2 from elsewhere' } });

      const outcome = await commitEdit(opened.stack, 'grantee', record.id, {});
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toMatch(/Conflict:.*moved to v2/);
    } finally {
      await discardEdit('grantee', record.id, {}).catch(() => {});
      await opened.close();
    }
  });
});
