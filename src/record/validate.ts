/**
 * A pre-flight check of parsed content against a type's schema, so a bad
 * edit is reported field-by-field before any write is attempted rather
 * than coming back as a rejected `create()`/`update()`. It mirrors
 * `@haverstack/core`'s own `validateContent` (which core does not export
 * from its root); core's write-path validation stays authoritative.
 * See docs/spec/data-model.md § Types and § Content field names.
 */

import type { FieldDef, TypeSchema } from '@haverstack/core';

export type FieldIssue = { path: string; message: string };

// Copied verbatim from core's validate.ts so the two agree on what a
// `date` field accepts.
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
const FILE_ID_RE = /^[0-9a-f]{64}$/;
const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];
const KEY_METACHARACTERS = ['.', '[', ']', '$', '"', '*', '#'];
const KEY_METACHARACTER_RE = new RegExp(`[${KEY_METACHARACTERS.map((c) => `\\${c}`).join('')}]`);
const MAX_DEPTH = 32;

const jsTypeFor = (kind: FieldDef['kind']): string =>
  kind === 'number' ? 'number' : kind === 'boolean' ? 'boolean' : 'string';

function checkField(
  value: unknown,
  def: FieldDef,
  path: string,
  out: FieldIssue[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;

  if (def.kind === 'array') {
    if (!Array.isArray(value)) {
      out.push({ path, message: `expected a list, got ${typeName(value)}` });
      return;
    }
    value.forEach((item, i) => checkField(item, def.items, `${path}[${i}]`, out, depth + 1));
    return;
  }

  if (def.kind === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      out.push({ path, message: `expected a mapping, got ${typeName(value)}` });
      return;
    }
    walkSchema(value as Record<string, unknown>, def.properties, path, out, depth + 1);
    return;
  }

  if (def.kind === 'date') {
    if (typeof value !== 'string' || !ISO_8601_RE.test(value) || Number.isNaN(Date.parse(value))) {
      out.push({ path, message: `expected an ISO 8601 date (YYYY-MM-DD, optionally with a time)` });
    }
    return;
  }

  if (def.kind === 'file-ref') {
    if (typeof value !== 'string' || !FILE_ID_RE.test(value)) {
      out.push({ path, message: 'expected a 64-character lowercase hex fileId (SHA-256)' });
    }
    return;
  }

  const expected = jsTypeFor(def.kind);
  if (typeof value !== expected) {
    out.push({ path, message: `expected ${expected}, got ${typeName(value)}` });
  }
}

function walkSchema(
  content: Record<string, unknown>,
  schema: TypeSchema,
  prefix: string,
  out: FieldIssue[],
  depth: number,
): void {
  for (const [key, def] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = content[key];
    if (value === undefined || value === null) {
      if (def.required) out.push({ path, message: 'required field is missing' });
      continue;
    }
    checkField(value, def, path, out, depth);
  }
}

function walkKeys(value: unknown, prefix: string, out: FieldIssue[], depth: number): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkKeys(item, `${prefix}[${i}]`, out, depth + 1));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (KEY_METACHARACTER_RE.test(key)) {
      out.push({
        path,
        message: `field name contains a reserved character (${KEY_METACHARACTERS.join(' ')})`,
      });
    }
    walkKeys(child, path, out, depth + 1);
  }
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  return typeof value;
}

/** Collect every schema/shape problem in `content`; empty means it is valid. */
export function validateAgainstSchema(
  content: Record<string, unknown>,
  schema: TypeSchema,
): FieldIssue[] {
  const out: FieldIssue[] = [];
  for (const key of RESERVED_KEYS) {
    if (Object.hasOwn(content, key)) {
      out.push({
        path: key,
        message: 'reserved key — names JavaScript object machinery, not a field',
      });
    }
  }
  walkKeys(content, '', out, 0);
  walkSchema(content, schema, '', out, 0);
  return out;
}
