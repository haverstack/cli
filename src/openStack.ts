/**
 * openStack — resolve a target to an open Stack, local or server.
 *
 * Resolution order for the target: the `--stack` value, else
 * `$HAVERSTACK_STACK`, else the config's `default` profile. A target that
 * looks like a path opens a local file; one that looks like a URL is a
 * one-off server connection; anything else is a profile name.
 * See docs/design.md § It talks to a Stack.
 */

import { isAbsolute, resolve } from 'node:path';
import { Stack } from '@haverstack/core';
import type { DidCredential } from '@haverstack/core/wire';
import { LocalAdapter } from '@haverstack/adapter-local';
import { APIAdapter } from '@haverstack/adapter-api';
import { loadConfig, type Profile } from './config.js';
import { loadSigner } from './keys.js';

export type StackMode = 'unscoped' | 'owner' | 'grantee';

export type OpenedStack = {
  stack: Stack;
  /** Resolved label for the write-command banner. */
  target: string;
  /** Trust posture: local files are always `unscoped`. */
  mode: StackMode;
  /** The DID this session authenticated as, if any. */
  did?: string;
  /** Flush and release the adapter's resources. Always call it. */
  close: () => Promise<void>;
};

function looksLikeUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

function looksLikePath(target: string): boolean {
  return target.includes('/') || target.includes('\\') || target.endsWith('.db');
}

/** Owner iff we authenticated as exactly the DID the server calls its owner. */
export function computeMode(ownerEntityId: string | undefined, did: string | undefined): StackMode {
  return did !== undefined && did === ownerEntityId ? 'owner' : 'grantee';
}

export type OpenStackOptions = {
  /** The `--stack` value, if given. */
  target?: string;
};

async function openLocal(path: string): Promise<OpenedStack> {
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path);
  const adapter = await LocalAdapter.open({ path: abs });
  const stack = await Stack.create(adapter);
  return { stack, target: abs, mode: 'unscoped', close: () => stack.close() };
}

async function openServer(url: string, label: string, profile?: Profile): Promise<OpenedStack> {
  let credential: DidCredential | undefined;
  if (profile?.did && profile.key) {
    const sign = await loadSigner(profile.key);
    credential = { did: profile.did, sign };
  }
  const adapter = await APIAdapter.open({
    url,
    credential,
    expectedOwner: profile?.expectedOwner,
  });
  const stack = await Stack.create(adapter);
  return {
    stack,
    target: label,
    mode: computeMode(stack.ownerEntityId, credential?.did),
    did: credential?.did,
    close: () => stack.close(),
  };
}

export async function openStack(opts: OpenStackOptions = {}): Promise<OpenedStack> {
  const config = await loadConfig();
  const target = opts.target ?? process.env.HAVERSTACK_STACK ?? config.default;

  if (!target) {
    throw new Error(
      'No stack selected. Pass --stack <path|profile>, set $HAVERSTACK_STACK, ' +
        'or set a default with `hstack stack use <name>`.',
    );
  }

  if (looksLikeUrl(target)) {
    return openServer(target, target);
  }

  if (looksLikePath(target)) {
    return openLocal(target);
  }

  const profile = config.profiles[target];
  if (!profile) {
    throw new Error(
      `Unknown stack "${target}". It is not a profile, and does not look like a path or URL. ` +
        'Add it with `hstack stack add`, or pass a path to a .db file.',
    );
  }
  if (profile.path) return openLocal(profile.path);
  if (profile.url) return openServer(profile.url, `${target} (${profile.url})`, profile);
  throw new Error(`Profile "${target}" has neither a url nor a path.`);
}
