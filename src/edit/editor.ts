/**
 * Launching the user's editor (and, optionally, a file manager) on a
 * working directory. Detached by default so the CLI process — and any lock
 * it holds on a local stack file — is released while you edit; `-c` waits
 * and drives the commit itself. See docs/design.md § The editing model.
 */

import { spawn, spawnSync } from 'node:child_process';
import type { Config } from '../config.js';

/** `config.editor`, else `$VISUAL`, else `$EDITOR`, else `''` (none configured). */
export function resolveEditorCommand(config: Config): string {
  return (config.editor || process.env.VISUAL || process.env.EDITOR || '').trim();
}

function tokenize(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

export class NoEditorError extends Error {
  constructor() {
    super('No editor configured. Set `editor` in config.toml, or $VISUAL / $EDITOR.');
    this.name = 'NoEditorError';
  }
}

/**
 * Open `filePath` in the editor. `wait: true` blocks until it exits (for a
 * terminal editor and `-c`); otherwise it is detached and this returns at
 * once.
 */
export function launchEditor(command: string, filePath: string, wait: boolean): void {
  const parts = tokenize(command);
  if (parts.length === 0) throw new NoEditorError();
  const [cmd, ...args] = parts;

  if (wait) {
    const res = spawnSync(cmd, [...args, filePath], { stdio: 'inherit' });
    if (res.error) throw res.error;
    return;
  }
  const child = spawn(cmd, [...args, filePath], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

/** Best-effort: open the OS file manager on `dir`. Never throws. */
export function launchExplorer(dir: string): void {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try {
    const child = spawn(opener, [dir], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // A missing file manager is not worth failing the edit over.
  }
}
