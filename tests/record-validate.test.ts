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

  it('rejects a field the schema does not declare, at every depth', () => {
    const schema: TypeSchema = {
      title: { kind: 'string' },
      address: { kind: 'object', properties: { city: { kind: 'string' } } },
    };
    const out = paths(schema, { title: 'x', extra: 1, address: { city: 'NYC', zip: '10001' } });
    expect(out).toContain('extra: not declared in the type’s schema');
    expect(out).toContain('address.zip: not declared in the type’s schema');
  });

  it('holds an open container to its own kind but not its interior', () => {
    const schema: TypeSchema = {
      blob: { kind: 'object', open: true },
      list: { kind: 'array', open: true },
    };
    expect(
      validateAgainstSchema(
        { blob: { anything: 'goes', nested: { ok: true } }, list: [1, 'x', null] },
        schema,
      ),
    ).toEqual([]);
    expect(paths(schema, { blob: [1, 2] })[0]).toMatch(/blob: expected a mapping/);
    expect(paths(schema, { list: { not: 'a list' } })[0]).toMatch(/list: expected a list/);
  });

  it('still checks field-name metacharacters inside an open container', () => {
    const schema: TypeSchema = { blob: { kind: 'object', open: true } };
    const out = paths(schema, { blob: { ['a.b']: 1 } });
    expect(out.some((m) => m.startsWith('blob.a.b:'))).toBe(true);
  });
});
