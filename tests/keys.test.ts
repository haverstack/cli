import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyDidSignature } from '@haverstack/core/did';
import { generateAndStoreKey, loadSigner } from '../src/keys.js';
import { keysDir } from '../src/paths.js';
import { withTempEnv, type TempEnv } from './helpers.js';

let env: TempEnv;
beforeEach(async () => {
  env = await withTempEnv();
});
afterEach(() => env.cleanup());

describe('generateAndStoreKey', () => {
  it('writes a 0600 JWK file named after the profile', async () => {
    const { did, keyRef } = await generateAndStoreKey('work');

    expect(did).toMatch(/^did:key:z/);
    expect(keyRef).toBe('work.jwk.json');

    const info = await stat(join(keysDir(), keyRef));
    expect(info.mode & 0o777).toBe(0o600);
  });
});

describe('loadSigner', () => {
  it('reconstructs a signer whose output verifies against the DID', async () => {
    const { did, keyRef } = await generateAndStoreKey('work');
    const sign = await loadSigner(keyRef);

    const payload = new TextEncoder().encode('haverstack-auth-v1\nchallenge');
    const signature = await sign(payload);

    expect(await verifyDidSignature(did, signature, payload)).toBe(true);
  });

  it('explains a missing key file', async () => {
    await expect(loadSigner('ghost.jwk.json')).rejects.toThrow(/not found/);
  });

  it('rejects the not-yet-built keychain backend', async () => {
    await expect(loadSigner('keychain')).rejects.toThrow(/keychain/i);
  });
});
