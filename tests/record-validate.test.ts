import { describe, expect, it } from 'vitest';
import type { TypeSchema } from '@haverstack/core';
import { validateAgainstSchema } from '../src/record/validate.js';

const paths = (schema: TypeSchema, content: Record<string, unknown>) =>
  validateAgainstSchema(content, schema).map((i) => `${i.path}: ${i.message}`);

describe('validateAgainstSchema', () => {
  it('accepts content that matches the schema', () => {
    const schema: TypeSchema = {
      title: { kind: 'string', required: true },
      count: { kind: 'number' },
      done: { kind: 'boolean' },
      when: { kind: 'date' },
    };
    expect(
      validateAgainstSchema({ title: 'x', count: 2, done: true, when: '2026-01-02' }, schema),
    ).toEqual([]);
  });

  it('flags a missing required field', () => {
    expect(paths({ title: { kind: 'string', required: true } }, {})).toContain(
      'title: required field is missing',
    );
  });

  it('flags scalar kind mismatches by path', () => {
    const schema: TypeSchema = { n: { kind: 'number' }, b: { kind: 'boolean' } };
    const out = paths(schema, { n: 'seven', b: 1 });
    expect(out).toContain('n: expected number, got string');
    expect(out).toContain('b: expected boolean, got number');
  });

  it('checks the ISO 8601 shape for date fields', () => {
    const schema: TypeSchema = { d: { kind: 'date' } };
    expect(validateAgainstSchema({ d: '2026-01-02' }, schema)).toEqual([]);
    expect(validateAgainstSchema({ d: '2026-01-02T10:30:00Z' }, schema)).toEqual([]);
    expect(paths(schema, { d: 'March 1' })[0]).toMatch(/^d: expected an ISO 8601 date/);
    expect(paths(schema, { d: '2026-13-40' })[0]).toMatch(/ISO 8601/);
  });

  it('requires a 64-hex fileId for file-ref', () => {
    const schema: TypeSchema = { f: { kind: 'file-ref' } };
    expect(validateAgainstSchema({ f: 'a'.repeat(64) }, schema)).toEqual([]);
    expect(paths(schema, { f: 'nope' })[0]).toMatch(/64-character lowercase hex/);
  });

  it('recurses into arrays and objects with indexed paths', () => {
    const schema: TypeSchema = {
      emails: {
        kind: 'array',
        items: { kind: 'object', properties: { value: { kind: 'string', required: true } } },
      },
    };
    const out = paths(schema, { emails: [{ value: 'a@b' }, { label: 'home' }] });
    expect(out).toContain('emails[1].value: required field is missing');
  });

  it('rejects reserved keys and field names with metacharacters', () => {
    // Computed keys create own properties even for "__proto__" (the literal
    // form would invoke the prototype setter instead).
    const content: Record<string, unknown> = { ['__proto__']: 1, ['a.b']: 2 };
    const out = validateAgainstSchema(content, {}).map((i) => i.path);
    expect(out).toContain('__proto__');
    expect(out).toContain('a.b');
  });
});
