/**
 * `hstack stack add|ls|use|rm` — manage the named profiles in config.toml.
 *
 * Each function returns the text to print, so the wiring in cli.ts stays a
 * one-liner and the behaviour is testable without capturing stdout.
 * See docs/design.md § Profiles, config, and key custody.
 */

import { isAbsolute, resolve } from 'node:path';
import { loadConfig, saveConfig, shortDid, type Profile } from '../config.js';
import { generateAndStoreKey, keyLocation } from '../keys.js';

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export type StackAddOptions = {
  url?: string;
  path?: string;
  expectedOwner?: string;
};

export async function stackAdd(name: string, opts: StackAddOptions): Promise<string> {
  if (!NAME_RE.test(name)) {
    throw new Error(`Invalid profile name "${name}". Use letters, digits, "-" and "_".`);
  }
  if ((opts.url ? 1 : 0) + (opts.path ? 1 : 0) !== 1) {
    throw new Error('Pass exactly one of --url <server> or --path <file.db>.');
  }

  const config = await loadConfig();
  if (config.profiles[name]) {
    throw new Error(`Profile "${name}" already exists. Remove it first with \`hstack stack rm\`.`);
  }

  const lines: string[] = [];
  let profile: Profile;

  if (opts.url) {
    const { did, keyRef } = await generateAndStoreKey(name);
    profile = { url: opts.url, did, key: keyRef };
    if (opts.expectedOwner) profile.expectedOwner = opts.expectedOwner;
    lines.push(
      `Added profile "${name}" → ${opts.url}`,
      '',
      'Grant this DID on the server:',
      `  ${did}`,
      `Key stored at ${keyLocation(keyRef)} (0600).`,
    );
  } else {
    const abs = isAbsolute(opts.path!) ? opts.path! : resolve(process.cwd(), opts.path!);
    profile = { path: abs };
    lines.push(`Added profile "${name}" → ${abs} (local file)`);
  }

  config.profiles[name] = profile;
  if (!config.default) {
    config.default = name;
    lines.push('Set as the default profile.');
  }
  await saveConfig(config);
  return lines.join('\n');
}

export async function stackList(): Promise<string> {
  const config = await loadConfig();
  const names = Object.keys(config.profiles).sort();
  if (names.length === 0) {
    return [
      'No profiles yet. Add one with:',
      '  hstack stack add <name> --url <server>',
      '  hstack stack add <name> --path <file.db>',
    ].join('\n');
  }

  const nameW = Math.max(...names.map((n) => n.length));
  const targetOf = (p: Profile) => p.url ?? p.path ?? '(empty)';
  const targetW = Math.max(...names.map((n) => targetOf(config.profiles[n]).length));

  return names
    .map((n) => {
      const p = config.profiles[n];
      const mark = n === config.default ? '*' : ' ';
      const id = p.did ? shortDid(p.did) : p.path ? 'local' : '';
      return `${mark} ${n.padEnd(nameW)}  ${targetOf(p).padEnd(targetW)}  ${id}`.trimEnd();
    })
    .join('\n');
}

export async function stackUse(name: string): Promise<string> {
  const config = await loadConfig();
  if (!config.profiles[name]) throw new Error(`No profile "${name}".`);
  config.default = name;
  await saveConfig(config);
  return `Default profile is now "${name}".`;
}

export async function stackRemove(name: string): Promise<string> {
  const config = await loadConfig();
  const profile = config.profiles[name];
  if (!profile) throw new Error(`No profile "${name}".`);

  delete config.profiles[name];
  const wasDefault = config.default === name;
  if (wasDefault) config.default = undefined;
  await saveConfig(config);

  const lines = [`Removed profile "${name}".`];
  if (profile.key) {
    lines.push(
      `Its key was left at ${keyLocation(profile.key)} — delete it yourself once you're ` +
        'sure (losing it is permanent).',
    );
  }
  if (wasDefault) {
    lines.push('That was the default; set a new one with `hstack stack use <name>`.');
  }
  return lines.join('\n');
}
