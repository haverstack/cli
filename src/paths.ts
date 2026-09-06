/**
 * Where the CLI keeps its own state — global, never in the working
 * directory or a repository. Follows the XDG base-directory spec; the env
 * vars are read on every call so tests can point them at a scratch dir.
 * See docs/design.md § Profiles, config, and key custody.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

function xdg(envVar: string, fallback: string): string {
  const fromEnv = process.env[envVar];
  return fromEnv && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), fallback);
}

/** `$XDG_CONFIG_HOME/haverstack` — named profiles and preferences. */
export function configDir(): string {
  return join(xdg('XDG_CONFIG_HOME', '.config'), 'haverstack');
}

export function configPath(): string {
  return join(configDir(), 'config.toml');
}

/** `$XDG_STATE_HOME/haverstack/edits` — per-record locks and working copies. */
export function editsDir(): string {
  return join(xdg('XDG_STATE_HOME', join('.local', 'state')), 'haverstack', 'edits');
}

/** `$XDG_DATA_HOME/haverstack/keys` — DID private keys, as `0600` JWK files. */
export function keysDir(): string {
  return join(xdg('XDG_DATA_HOME', join('.local', 'share')), 'haverstack', 'keys');
}
