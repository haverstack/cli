/**
 * DID key custody. Core generates a keypair and hands back the private key;
 * where it lives is this CLI's problem (docs/spec/identity.md is explicit).
 *
 * Phase 1 stores it as a `0600` JWK file under the keys dir. An OS-keychain
 * backend is the planned alternative — the `key` field in a profile is
 * already the indirection point (a filename now, the literal `"keychain"`
 * later), so adding it changes no config shape and no caller here.
 * See docs/design.md § Identity and key custody.
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  exportDidPrivateKeyJwk,
  generateDidKeypair,
  importDidPrivateKeyJwk,
  signWithDid,
} from '@haverstack/core/did';
import { keysDir } from './paths.js';

export type StoredKey = {
  did: string;
  /** Value for `Profile.key` — resolvable by `loadSigner`. */
  keyRef: string;
};

/** A signing callback bound to a private key — the shape `DidCredential` wants. */
export type Signer = (payload: Uint8Array) => Promise<Uint8Array>;

/** Generate a fresh did:key and persist its private half for `profileName`. */
export async function generateAndStoreKey(profileName: string): Promise<StoredKey> {
  const keypair = await generateDidKeypair();
  const jwk = await exportDidPrivateKeyJwk(keypair.privateKey);

  const keyRef = `${profileName}.jwk.json`;
  await mkdir(keysDir(), { recursive: true, mode: 0o700 });
  const file = join(keysDir(), keyRef);
  await writeFile(file, `${JSON.stringify({ did: keypair.did, privateKey: jwk }, null, 2)}\n`, {
    mode: 0o600,
  });
  // writeFile only applies `mode` when it creates the file; force it in case
  // the file already existed with looser permissions.
  await chmod(file, 0o600);

  return { did: keypair.did, keyRef };
}

/** Reconstruct the signer for a profile's stored key. */
export async function loadSigner(keyRef: string): Promise<Signer> {
  if (keyRef === 'keychain') {
    throw new Error('OS-keychain key storage is not implemented yet; re-add the profile.');
  }
  let raw: string;
  try {
    raw = await readFile(join(keysDir(), keyRef), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Key file "${keyRef}" not found under ${keysDir()}.`, { cause: err });
    }
    throw err;
  }
  const { privateKey } = JSON.parse(raw) as { privateKey: JsonWebKey };
  const key = await importDidPrivateKeyJwk(privateKey);
  return (payload) => signWithDid(key, payload);
}

/** Human-readable location of a profile's key, for `stack rm` messaging. */
export function keyLocation(keyRef: string): string {
  return keyRef === 'keychain' ? 'the OS keychain' : join(keysDir(), keyRef);
}
