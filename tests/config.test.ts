import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, saveConfig } from '../src/config.js';
import { configPath } from '../src/paths.js';
import { withTempEnv, type TempEnv } from './helpers.js';

let env: TempEnv;
beforeEach(async () => {
  env = await withTempEnv();
});
afterEach(() => env.cleanup());

describe('loadConfig', () => {
  it('returns an empty config when the file is absent', async () => {
    expect(await loadConfig()).toEqual({ profiles: {} });
  });
});

describe('saveConfig / loadConfig round trip', () => {
  it('preserves profiles, the default, and preferences', async () => {
    const config = {
      default: 'work',
      editor: 'code --wait',
      explorer: true,
      profiles: {
        work: { url: 'https://stack.example.com', did: 'did:key:zWork', key: 'work.jwk.json' },
        scratch: { path: '/tmp/scratch.db' },
      },
    };
    await saveConfig(config);
    expect(await loadConfig()).toEqual(config);
  });

  it('writes TOML with a profiles table', async () => {
    await saveConfig({ profiles: { scratch: { path: '/tmp/s.db' } } });
    const raw = await readFile(configPath(), 'utf8');
    expect(raw).toContain('[profiles.scratch]');
    expect(raw).toContain('path = "/tmp/s.db"');
  });

  it('round-trips a per-type body override', async () => {
    const config = {
      profiles: { work: { url: 'https://x', body: { 'org.haverstack/article': 'text' } } },
    };
    await saveConfig(config);
    expect((await loadConfig()).profiles.work.body).toEqual({ 'org.haverstack/article': 'text' });
  });
});
