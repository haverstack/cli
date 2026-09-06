import { describe, expect, it } from 'vitest';
import type { StackType } from '@haverstack/core';
import { scaffoldRecord } from '../src/record/scaffold.js';

const type = (schema: StackType['schema']): StackType => ({
  id: 'com.example/thing@1',
  baseId: 'com.example/thing',
  version: 1,
  name: 'Thing',
  schema,
  schemaHash: 'x',
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

describe('scaffoldRecord', () => {
  const t = type({
    title: { kind: 'string', required: true },
    body: { kind: 'text', required: true },
    due: { kind: 'date' },
    done: { kind: 'boolean', required: true },
  });

  it('opens with type, an empty tags list, and required fields present', () => {
    const text = scaffoldRecord(t);
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toMatch(/^type: com\.example\/thing@1$/m);
    expect(text).toContain('tags: []');
    expect(text).toMatch(/^title:/m);
    expect(text).toMatch(/^done: false/m);
  });

  it('comments out optional fields and labels every line with its kind', () => {
    const text = scaffoldRecord(t);
    expect(text).toMatch(/^# due:.*# optional — date$/m);
    expect(text).toMatch(/^title:.*# required — string$/m);
  });

  it('--minimal drops the commented optionals', () => {
    const text = scaffoldRecord(t, { minimal: true });
    expect(text).not.toContain('# due:');
    expect(text).toMatch(/^title:/m);
  });

  it('emits a body section only when the type has a body field', () => {
    expect(scaffoldRecord(t).endsWith('---\n\n')).toBe(true);
    const noBody = type({ title: { kind: 'string', required: true } });
    expect(scaffoldRecord(noBody).endsWith('---\n')).toBe(true);
  });

  it('pins id and parent when given', () => {
    const text = scaffoldRecord(t, { id: '0123456789ab', parentId: 'cba9876543210' });
    expect(text).toMatch(/^id: 0123456789ab$/m);
    expect(text).toMatch(/^parentId: cba9876543210$/m);
  });

  it('notes a content field that collides with a reserved front-matter key', () => {
    const clash = type({ tags: { kind: 'array', items: { kind: 'string' } } });
    expect(scaffoldRecord(clash)).toMatch(/# note: content field "tags" collides/);
  });

  it('expands a required nested object one level', () => {
    const nested = type({
      address: {
        kind: 'object',
        required: true,
        properties: { city: { kind: 'string', required: true }, zip: { kind: 'string' } },
      },
    });
    const text = scaffoldRecord(nested);
    expect(text).toMatch(/^address:.*# required — object$/m);
    expect(text).toMatch(/^ {2}city:.*# required — string$/m);
    expect(text).toMatch(/^ {2}# zip:.*# optional — string$/m);
  });
});
