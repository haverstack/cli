import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { launchEditor, NoEditorError, resolveEditorCommand } from '../src/edit/editor.js';

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
