/**
 * parseRecord — the inverse of render/scaffold: take the edited
 * `record.md` back to the pieces a write needs, and refuse it with
 * field-level messages if it does not hold up. Pure; no Stack, no I/O.
 * See docs/design.md § Schema-driven front matter.
 */

import { parse as parseYaml } from 'yaml';
import type { StackType } from '@haverstack/core';
import { bodyFieldOf, RESERVED_FRONT_MATTER_KEYS } from './format.js';
import { validateAgainstSchema, type FieldIssue } from './validate.js';

export type ParsedRecord = {
  /** Present only when the file carried an `id` (blank on `new`). */
  id?: string;
  typeId: string;
  /** `null` = no parent; a string = that parent id. */
  parentId: string | null;
  tags: string[];
  /** Which field the body text was assigned to, or `null` if there is none. */
  bodyField: string | null;
  content: Record<string, unknown>;
};

export class RecordParseError extends Error {
  constructor(readonly issues: FieldIssue[]) {
    super(
      `The record does not hold up:\n` +
        issues.map((i) => `  ${i.path ? `${i.path}: ` : ''}${i.message}`).join('\n'),
    );
    this.name = 'RecordParseError';
  }
}

const NATIVE_KEYS = new Set(RESERVED_FRONT_MATTER_KEYS);
const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/;

export type ParseOptions = {
  /** Force the body field (from `--body` / config) instead of inferring it. */
  bodyField?: string;
  /** On `edit`: the id the file must still name. */
  expectId?: string;
  /** On `edit`: the typeId the file must still name (type changes are a migration). */
  expectType?: string;
  /** On `edit`: the `_readonly` block as last rendered, to detect hand edits. */
  readonlyBaseline?: unknown;
};

export function parseRecord(
  text: string,
  type: StackType | null,
  opts: ParseOptions = {},
): ParsedRecord {
  const match = text.match(FRONT_MATTER_RE);
  if (!match) {
    throw new RecordParseError([
      { path: '', message: 'no front matter — expected a `---` fenced block at the top' },
    ]);
  }
  const [, frontText, bodyText = ''] = match;

  let front: unknown;
  try {
    front = parseYaml(frontText, { schema: 'core' });
  } catch (err) {
    throw new RecordParseError([
      { path: '', message: `front matter is not valid YAML: ${(err as Error).message}` },
    ]);
  }
  if (front === null || typeof front !== 'object' || Array.isArray(front)) {
    throw new RecordParseError([{ path: '', message: 'front matter must be a mapping' }]);
  }
  const fm = front as Record<string, unknown>;
  const issues: FieldIssue[] = [];

  // --- native fields ---
  const id = typeof fm.id === 'string' && fm.id.trim() ? fm.id.trim() : undefined;
  if (opts.expectId && id && id !== opts.expectId) {
    issues.push({ path: 'id', message: `is "${id}"; this edit is of "${opts.expectId}"` });
  }

  const typeId = typeof fm.type === 'string' ? fm.type.trim() : '';
  if (!typeId) issues.push({ path: 'type', message: 'missing' });
  else if (opts.expectType && typeId !== opts.expectType) {
    issues.push({
      path: 'type',
      message: `changed to "${typeId}"; a record's type cannot change here (that is a migration)`,
    });
  }

  // `~` (YAML null), an empty value, or an absent key all mean "no parent".
  let parentId: string | null = null;
  const rawParent = fm.parentId;
  if (typeof rawParent === 'string') {
    const trimmed = rawParent.trim();
    if (trimmed && trimmed !== '~') parentId = trimmed;
  } else if (rawParent !== undefined && rawParent !== null) {
    issues.push({ path: 'parentId', message: 'must be a record id or empty' });
  }

  let tags: string[] = [];
  if (Array.isArray(fm.tags)) {
    if (fm.tags.every((t) => typeof t === 'string')) tags = fm.tags as string[];
    else issues.push({ path: 'tags', message: 'must be a list of strings' });
  } else if (fm.tags !== undefined && fm.tags !== null) {
    issues.push({ path: 'tags', message: 'must be a list of strings' });
  }

  if (opts.readonlyBaseline !== undefined && !deepEqual(fm._readonly, opts.readonlyBaseline)) {
    issues.push({
      path: '_readonly',
      message:
        'was edited — it is a read-only snapshot. Use `hstack link` / `hstack perm` / ' +
        '`hstack tag` to change associations and permissions.',
    });
  }

  // --- content ---
  // The body field's value comes from the body section, never front matter.
  const bodyField = opts.bodyField ?? bodyFieldOf(type);
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (NATIVE_KEYS.has(key) || key === bodyField) continue;
    content[key] = value;
  }
  const bodyRequired = Boolean(bodyField && type?.schema[bodyField]?.required);
  if (bodyField) {
    const value = stripTrailingNewline(bodyText);
    if (value.trim() !== '' || bodyRequired) content[bodyField] = value;
  }

  if (type) issues.push(...validateAgainstSchema(content, type.schema));

  // Core accepts "" for a required text field; the CLI treats an empty body
  // as the omission it looks like.
  if (bodyRequired && String(content[bodyField as string] ?? '').trim() === '') {
    issues.push({ path: bodyField as string, message: 'the body is empty (a required field)' });
  }

  if (issues.length > 0) throw new RecordParseError(issues);

  return { id, typeId, parentId, tags, bodyField, content };
}

function stripTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  return keys.every((k) => deepEqual(ao[k], bo[k]));
}
