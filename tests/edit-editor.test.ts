import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  launchEditor,
  isTuiEditorCommand,
  isInteractiveTerminal,
  NoEditorError,
  resolveEditorCommand,
} from '../src/edit/editor.js';

const saved = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
beforeEach(() => {
  delete process.env.VISUAL;
  delete process.env.EDITOR;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('resolveEditorCommand', () => {
  it('prefers config.editor, then $VISUAL, then $EDITOR, else empty', () => {
    expect(resolveEditorCommand({ profiles: {} })).toBe('');
    process.env.EDITOR = 'nano';
    expect(resolveEditorCommand({ profiles: {} })).toBe('nano');
    process.env.VISUAL = 'vim';
    expect(resolveEditorCommand({ profiles: {} })).toBe('vim');
    expect(resolveEditorCommand({ profiles: {}, editor: 'code --wait' })).toBe('code --wait');
  });
});

describe('launchEditor', () => {
  it('runs a waited command to completion', () => {
    // `true` exits 0 immediately; the file path is passed as a trailing arg.
    expect(() => launchEditor('true', '/tmp/whatever', true)).not.toThrow();
  });

  it('throws NoEditorError on an empty command', () => {
    expect(() => launchEditor('', '/tmp/x', false)).toThrow(NoEditorError);
    expect(() => launchEditor('   ', '/tmp/x', true)).toThrow(NoEditorError);
  });

  it('surfaces a spawn error for a missing binary in wait mode', () => {
    expect(() => launchEditor('definitely-not-an-editor-xyz', '/tmp/x', true)).toThrow();
  });
});

describe('isTuiEditorCommand', () => {
  it('recognizes common terminal editors regardless of path or args', () => {
    expect(isTuiEditorCommand('nano')).toBe(true);
    expect(isTuiEditorCommand('/usr/bin/vim')).toBe(true);
    expect(isTuiEditorCommand('nvim +42')).toBe(true);
  });

  it('treats GUI editors as not needing a terminal', () => {
    expect(isTuiEditorCommand('code --wait')).toBe(false);
    expect(isTuiEditorCommand('subl -w')).toBe(false);
    expect(isTuiEditorCommand('')).toBe(false);
  });

  it('special-cases emacs on the presence of -nw', () => {
    expect(isTuiEditorCommand('emacs')).toBe(false);
    expect(isTuiEditorCommand('emacs -nw')).toBe(true);
    expect(isTuiEditorCommand('emacs --no-window-system')).toBe(true);
  });
});

describe('isInteractiveTerminal', () => {
  it('reflects whether both stdin and stdout are a real tty', () => {
    const savedIn = process.stdin.isTTY;
    const savedOut = process.stdout.isTTY;
    try {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      expect(isInteractiveTerminal()).toBe(true);

      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      expect(isInteractiveTerminal()).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: savedIn, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: savedOut, configurable: true });
    }
  });
});
