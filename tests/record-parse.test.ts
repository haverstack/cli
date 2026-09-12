import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { StackType, TypeSchema } from '@haverstack/core';
import * as commons from '@haverstack/commons';
import { parseRecord, RecordParseError } from '../src/record/parse.js';
import { validateAgainstSchema } from '../src/record/validate.js';
import { bodyFieldOf } from '../src/record/format.js';

const asType = (schema: TypeSchema, id = 'com.example/note@1'): StackType => ({
  id,
  baseId: id.split('@')[0],
  version: 1,
  name: 'T',
  schema,
  schemaHash: 'x',
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

const noteType = asType({
  title: { kind: 'string' },
  text: { kind: 'text', required: true },
  due: { kind: 'date' },
});

const file = (front: Record<string, unknown>, body = '') =>
  `---\n${stringify(front).trimEnd()}\n---\n${body}`;

describe('parseRecord', () => {
  it('splits native fields, content, and the body', () => {
    const parsed = parseRecord(
      file(
        {
          type: 'com.example/note@1',
          parentId: 'p0000000000x',
          tags: ['a', 'b'],
          title: 'Hi',
          due: '2026-02-01',
        },
        'the body\n',
      ),
      noteType,
    );
    expect(parsed).toMatchObject({
      typeId: 'com.example/note@1',
      parentId: 'p0000000000x',
      tags: ['a', 'b'],
      bodyField: 'text',
    });
    expect(parsed.content).toEqual({ title: 'Hi', due: '2026-02-01', text: 'the body' });
  });

  it('treats ~ / blank / missing parentId as no parent', () => {
    expect(
      parseRecord(
        file({ type: 'x@1', parentId: '~', text: 'b' }),
        asType({ text: { kind: 'text' } }),
      ).parentId,
    ).toBeNull();
    expect(
      parseRecord(file({ type: 'x@1', text: 'b' }), asType({ text: { kind: 'text' } })).parentId,
    ).toBeNull();
  });

  it('collects schema issues into a RecordParseError', () => {
    try {
      parseRecord(file({ type: 'com.example/note@1', due: 'soon' }), noteType);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RecordParseError);
      const issues = (err as RecordParseError).issues.map((i) => i.path);
      expect(issues).toContain('text'); // required, missing
      expect(issues).toContain('due'); // bad date
    }
  });

  it('rejects a missing front-matter fence and non-mapping front matter', () => {
    expect(() => parseRecord('just text', noteType)).toThrow(/no front matter/);
    expect(() => parseRecord('---\n- a\n- b\n---\n', noteType)).toThrow(/must be a mapping/);
  });

  it('flags a changed id or type on edit', () => {
    expect(() =>
      parseRecord(file({ id: '0123456789ab', type: 'com.example/note@1', text: 'b' }), noteType, {
        expectId: 'ffffffffffff',
      }),
    ).toThrow(/this edit is of/);
    expect(() =>
      parseRecord(file({ type: 'com.example/note@2', text: 'b' }), noteType, {
        expectType: 'com.example/note@1',
      }),
    ).toThrow(/type cannot change/);
  });

  it('flags a hand-edited _readonly block against its baseline', () => {
    const baseline = { version: 3, createdAt: '2026-01-01T00:00:00.000Z' };
    expect(() =>
      parseRecord(
        file({ type: 'com.example/note@1', _readonly: { version: 99 } }, 'b\n'),
        noteType,
        {
          readonlyBaseline: baseline,
        },
      ),
    ).toThrow(/_readonly/);
    // unchanged baseline is fine
    expect(
      parseRecord(file({ type: 'com.example/note@1', _readonly: baseline }, 'b\n'), noteType, {
        readonlyBaseline: baseline,
      }).typeId,
    ).toBe('com.example/note@1');
  });
});

describe('commons types round-trip through parseRecord', () => {
  const commonsTypes = Object.values(commons).filter(
    (v): v is { id: string; name: string; schema: TypeSchema } =>
      !!v && typeof v === 'object' && 'schema' in v && 'id' in v,
  );

  it('covers a representative set', () => {
    expect(commonsTypes.length).toBeGreaterThanOrEqual(8);
  });

  for (const ct of commonsTypes) {
    it(`${ct.id}`, () => {
      const type = asType(ct.schema, ct.id);
      const body = bodyFieldOf(type);
      const front: Record<string, unknown> = { type: ct.id, tags: [] };
      for (const [name, def] of Object.entries(ct.schema)) {
        if (name === body) continue;
        if (def.required) front[name] = sampleValue(def);
      }
      const parsed = parseRecord(file(front, body ? 'sample body\n' : ''), type);
      expect(validateAgainstSchema(parsed.content, ct.schema)).toEqual([]);
    });
  }
});

function sampleValue(def: TypeSchema[string]): unknown {
  switch (def.kind) {
    case 'string':
    case 'text':
      return 'sample';
    case 'number':
      return 1;
    case 'boolean':
      return false;
    case 'date':
      return '2026-01-01';
    case 'record-ref':
      return '0123456789ab';
    case 'file-ref':
      return 'a'.repeat(64);
    case 'array':
      return [];
    case 'object': {
      if (def.open) return {};
      const obj: Record<string, unknown> = {};
      for (const [k, d] of Object.entries(def.properties)) if (d.required) obj[k] = sampleValue(d);
      return obj;
    }
  }
}
