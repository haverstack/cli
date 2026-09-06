import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { StackRecord, StackType } from '@haverstack/core';
import {
  bodyFieldOf,
  fieldKindLabel,
  formatSchema,
  renderRecord,
  summarize,
} from '../src/record/format.js';

const noteType: StackType = {
  id: 'com.example/note@1',
  baseId: 'com.example/note',
  version: 1,
  name: 'Note',
  schema: { title: { kind: 'string' }, text: { kind: 'text', required: true } },
  schemaHash: 'abc',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const baseRecord: StackRecord = {
  id: '0123456789ab',
  typeId: 'com.example/note@1',
  createdAt: new Date('2026-02-01T10:00:00Z'),
  updatedAt: new Date('2026-02-02T11:00:00Z'),
  version: 3,
  content: { title: 'Hello', text: 'The body\nsecond line' },
};

function frontMatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error('no front matter');
  return parse(match[1]) as Record<string, unknown>;
}

describe('bodyFieldOf', () => {
  it('picks the sole text field', () => {
    expect(bodyFieldOf(noteType)).toBe('text');
  });
  it('disambiguates by the name "body" then "text"', () => {
    const two = (a: string, b: string): StackType => ({
      ...noteType,
      schema: { [a]: { kind: 'text' }, [b]: { kind: 'text' } },
    });
    expect(bodyFieldOf(two('body', 'notes'))).toBe('body');
    expect(bodyFieldOf(two('lead', 'text'))).toBe('text');
    expect(bodyFieldOf(two('lead', 'notes'))).toBeNull();
  });
  it('is null without a type', () => {
    expect(bodyFieldOf(null)).toBeNull();
  });
});

describe('renderRecord', () => {
  it('puts native + scalar fields in front matter and the text field in the body', () => {
    const text = renderRecord(baseRecord, noteType);
    const fm = frontMatter(text);

    expect(fm.id).toBe('0123456789ab');
    expect(fm.type).toBe('com.example/note@1');
    expect(fm.title).toBe('Hello');
    expect(fm).not.toHaveProperty('text');
    expect(text.endsWith('The body\nsecond line\n')).toBe(true);
  });

  it('surfaces tags as a list and other associations under _readonly', () => {
    const record: StackRecord = {
      ...baseRecord,
      associations: [
        { kind: 'tag', label: 'starred' },
        { kind: 'tag', label: 'work' },
        { kind: 'relationship', label: 'blocks', target: { scope: 'record', recordId: 'zzz' } },
      ],
      permissions: [{ access: 'public' }],
    };
    const fm = frontMatter(renderRecord(record, noteType));
    expect(fm.tags).toEqual(['starred', 'work']);
    const ro = fm._readonly as Record<string, unknown>;
    expect(ro.version).toBe(3);
    expect(ro.associations).toHaveLength(1);
    expect(ro.permissions).toEqual([{ access: 'public' }]);
  });

  it('marks a soft-deleted record in _readonly', () => {
    const record = { ...baseRecord, deletedAt: new Date('2026-03-01T00:00:00Z') };
    const ro = frontMatter(renderRecord(record, noteType))._readonly as Record<string, unknown>;
    expect(ro.deletedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('renders front matter only when the type has no body field', () => {
    const bare: StackType = { ...noteType, schema: { title: { kind: 'string' } } };
    const record = { ...baseRecord, content: { title: 'Just a title' } };
    const text = renderRecord(record, bare);
    expect(text.endsWith('---\n')).toBe(true);
  });

  it('lists unset optional fields commented out under --all', () => {
    const wide: StackType = {
      ...noteType,
      schema: { title: { kind: 'string' }, text: { kind: 'text' }, due: { kind: 'date' } },
    };
    const record = { ...baseRecord, content: { title: 'set', text: 'body' } };
    const plain = renderRecord(record, wide);
    const all = renderRecord(record, wide, { all: true });
    expect(plain).not.toContain('# due:');
    expect(all).toMatch(/# due:.*# optional — date/);
    expect(all).toMatch(/\n_readonly:/); // inserted before the readonly block
  });
});

describe('summarize', () => {
  it('prefers title, falls back through name/text/url, else a dash', () => {
    expect(summarize({ ...baseRecord, content: { title: 'T' } })).toBe('T');
    expect(summarize({ ...baseRecord, content: { name: 'N' } })).toBe('N');
    expect(summarize({ ...baseRecord, content: { url: 'https://x' } })).toBe('https://x');
    expect(summarize({ ...baseRecord, content: {} })).toBe('—');
  });
});

describe('formatSchema', () => {
  it('labels kinds, marks required, and indents nested shapes', () => {
    const out = formatSchema({
      title: { kind: 'string', required: true },
      tags: { kind: 'array', items: { kind: 'string' } },
      address: { kind: 'object', properties: { city: { kind: 'string', required: true } } },
    });
    expect(out).toMatch(/title +string {2}required/);
    expect(out).toMatch(/tags +array<string>/);
    expect(out).toMatch(/\n {2}city +string {2}required/);
  });

  it('fieldKindLabel handles nested arrays', () => {
    expect(
      fieldKindLabel({ kind: 'array', items: { kind: 'array', items: { kind: 'number' } } }),
    ).toBe('array<array<number>>');
  });
});
