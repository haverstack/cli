/**
 * openStack — resolve a `--stack` target to an open Stack.
 *
 * Phase 0 handles local SQLite files by path only. Named server profiles,
 * `$HAVERSTACK_STACK`, config.toml resolution and the owner/grantee mode
 * probe arrive in Phase 1. See docs/design.md § It talks to a Stack.
 */

import { isAbsolute, resolve } from 'node:path';
import { Stack } from '@haverstack/core';
import { LocalAdapter } from '@haverstack/adapter-local';

export type StackMode = 'unscoped' | 'owner' | 'grantee';

export type OpenedStack = {
  stack: Stack;
  /** Where the stack resolved to — shown in the write-command banner. */
  target: string;
  /** Trust posture. Local files are always `unscoped`. */
  mode: StackMode;
  /** Flush and release the adapter's lock. Always call it. */
  close: () => Promise<void>;
};

function looksLikeUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

/**
 * A local path for now means: contains a slash or ends in `.db`. A bare word
 * will later be looked up as a profile name; until profiles exist it is an
 * error rather than a silently-created file.
 */
function looksLikePath(target: string): boolean {
  return target.includes('/') || target.includes('\\') || target.endsWith('.db');
}

export async function openStack(target: string | undefined): Promise<OpenedStack> {
  if (!target) {
    throw new Error(
      'No stack selected. Pass --stack <path-to-.db>. Named server profiles arrive in a later release.',
    );
  }

  if (looksLikeUrl(target)) {
    throw new Error(
      `Server stacks are not wired up yet: "${target}". Pass a path to a local .db file for now.`,
    );
  }

  if (!looksLikePath(target)) {
    throw new Error(
      `Unrecognized stack target "${target}". Pass a path to a local .db file ` +
        '(profile names are not resolvable yet).',
    );
  }

  const path = isAbsolute(target) ? target : resolve(process.cwd(), target);
  const adapter = await LocalAdapter.open({ path });
  const stack = await Stack.create(adapter);

  return {
    stack,
    target: path,
    mode: 'unscoped',
    close: () => stack.close(),
  };
}
