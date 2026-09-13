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

/** "/usr/bin/vim" -> "vim". */
function commandBasename(cmd: string): string {
  return (cmd.split(/[\\/]/).pop() ?? cmd).toLowerCase();
}

const TUI_EDITOR_NAMES = new Set([
  'vi',
  'vim',
  'nvim',
  'nano',
  'pico',
  'ne',
  'jed',
  'joe',
  'mcedit',
  'micro',
  'hx',
  'kak',
  'ed',
]);

/**
 * Best-effort guess at whether `command` needs a real controlling terminal
 * to run at all, as opposed to opening its own window — used only to pick
 * a default for `--wait`, never authoritative: `--wait`/`--no-wait` always
 * override it. `emacs` goes either way depending on `-nw`.
 */
export function isTuiEditorCommand(command: string): boolean {
  const parts = tokenize(command);
  const name = commandBasename(parts[0] ?? '');
  if (name === 'emacs' || name === 'emacsclient') {
    return parts.some((p) => p === '-nw' || p === '--no-window-system');
  }
  return TUI_EDITOR_NAMES.has(name);
}

/**
 * Whether this process itself has a real terminal on both ends — the
 * signal that distinguishes a human at a shell (safe to default a TUI
 * editor to `--wait`) from a script or agent driving `hstack` as a
 * subprocess (never safe to assume that, regardless of $EDITOR).
 */
export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
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
