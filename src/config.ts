/**
 * config.toml — named stack profiles and a few preferences.
 *
 * A profile names one stack: a server (`url`, plus the DID this CLI
 * authenticates as and a reference to its key) or a local file (`path`).
 * The file is machine-managed by `hstack stack add|use|rm`; hand edits are
 * respected but comments are not preserved across a rewrite.
 * See docs/design.md § Profiles, config, and key custody.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse, stringify } from 'smol-toml';
import { configDir, configPath } from './paths.js';

export type Profile = {
  /** Server stack: base URL. Mutually exclusive with `path`. */
  url?: string;
  /** Local stack: absolute path to the `.db` file. Mutually exclusive with `url`. */
  path?: string;
  /** The DID this CLI authenticates as against `url`. */
  did?: string;
  /** How to find the private key for `did`: a JWK filename under the keys dir. */
  key?: string;
  /** Refuse a server whose discovery reports a different owner. */
  expectedOwner?: string;
  /** Per-type body-field override, `typeId` -> field name. */
  body?: Record<string, string>;
};

export type Config = {
  /** Profile used when `--stack` and `$HAVERSTACK_STACK` are both absent. */
  default?: string;
  /** Editor command; falls back to `$VISUAL`, then `$EDITOR`. */
  editor?: string;
  /** Open a file manager on the working directory during an edit. */
  explorer?: boolean;
  profiles: Record<string, Profile>;
};

const EMPTY: Config = { profiles: {} };

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(configPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY);
    throw err;
  }
  const parsed = parse(raw) as Partial<Config>;
  return {
    default: typeof parsed.default === 'string' ? parsed.default : undefined,
    editor: typeof parsed.editor === 'string' ? parsed.editor : undefined,
    explorer: typeof parsed.explorer === 'boolean' ? parsed.explorer : undefined,
    profiles:
      parsed.profiles && typeof parsed.profiles === 'object'
        ? (parsed.profiles as Record<string, Profile>)
        : {},
  };
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  // Drop undefined keys so `stringify` doesn't choke and the file stays tidy.
  const clean: Record<string, unknown> = { profiles: config.profiles };
  if (config.default !== undefined) clean.default = config.default;
  if (config.editor !== undefined) clean.editor = config.editor;
  if (config.explorer !== undefined) clean.explorer = config.explorer;
  await writeFile(configPath(), `${stringify(clean)}\n`);
}

export function getProfile(config: Config, name: string): Profile | undefined {
  return config.profiles[name];
}

/** Truncated identity for a listing: `did:key:z6Mk…AbCd`. */
export function shortDid(did: string): string {
  return did.length > 20 ? `${did.slice(0, 12)}…${did.slice(-4)}` : did;
}
