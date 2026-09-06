import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stackAdd, stackList, stackRemove, stackUse } from '../src/commands/stack.js';
import { loadConfig } from '../src/config.js';
import { keysDir } from '../src/paths.js';
import { withTempEnv, type TempEnv } from './helpers.js';

let env: TempEnv;
beforeEach(async () => {
  env = await withTempEnv();
});
afterEach(() => env.cleanup());

describe('stackAdd', () => {
  it('adds a local profile with an absolute path and makes it the default', async () => {
    const msg = await stackAdd('scratch', { path: 'notes/s.db' });
    expect(msg).toMatch(/local file/);
    expect(msg).toMatch(/default profile/);

    const config = await loadConfig();
    expect(config.default).toBe('scratch');
    expect(config.profiles.scratch.path).toBe(join(process.cwd(), 'notes/s.db'));
  });

  it('adds a server profile: generates a key, stores the DID and key ref', async () => {
    const msg = await stackAdd('work', { url: 'https://stack.example.com' });
    expect(msg).toMatch(/Grant this DID/);

    const { work } = (await loadConfig()).profiles;
    expect(work.url).toBe('https://stack.example.com');
    expect(work.did).toMatch(/^did:key:z/);
    expect(work.key).toBe('work.jwk.json');
    await stat(join(keysDir(), 'work.jwk.json'));
  });

  it('carries --expected-owner into the profile', async () => {
    await stackAdd('work', { url: 'https://x', expectedOwner: 'did:key:zOwner' });
    expect((await loadConfig()).profiles.work.expectedOwner).toBe('did:key:zOwner');
  });

  it('refuses a name that already exists', async () => {
    await stackAdd('work', { url: 'https://x' });
    await expect(stackAdd('work', { url: 'https://y' })).rejects.toThrow(/already exists/);
  });

  it('requires exactly one of --url / --path', async () => {
    await expect(stackAdd('bad', {})).rejects.toThrow(/exactly one/);
    await expect(stackAdd('bad', { url: 'https://x', path: 'y.db' })).rejects.toThrow(
      /exactly one/,
    );
  });

  it('rejects an unusable profile name', async () => {
    await expect(stackAdd('../evil', { path: 'x.db' })).rejects.toThrow(/Invalid profile name/);
  });
});

describe('stackList', () => {
  it('guides the user when there are no profiles', async () => {
    expect(await stackList()).toMatch(/No profiles yet/);
  });

  it('marks the default with a star', async () => {
    await stackAdd('work', { url: 'https://stack.example.com' });
    await stackAdd('scratch', { path: 's.db' });
    const listing = await stackList();
    expect(listing).toMatch(/^\* work /m);
    expect(listing).toMatch(/^ {2}scratch .*local/m);
  });
});

describe('stackUse', () => {
  it('switches the default and rejects an unknown profile', async () => {
    await stackAdd('work', { url: 'https://x' });
    await stackAdd('scratch', { path: 's.db' });
    await stackUse('scratch');
    expect((await loadConfig()).default).toBe('scratch');
    await expect(stackUse('nope')).rejects.toThrow(/No profile/);
  });
});

describe('stackRemove', () => {
  it('drops the profile, keeps the key, and clears a stale default', async () => {
    await stackAdd('work', { url: 'https://x' });
    const msg = await stackRemove('work');

    expect(msg).toMatch(/left at/);
    expect(msg).toMatch(/was the default/);

    const config = await loadConfig();
    expect(config.profiles.work).toBeUndefined();
    expect(config.default).toBeUndefined();
    // key file is deliberately not deleted
    await stat(join(keysDir(), 'work.jwk.json'));
  });
});
