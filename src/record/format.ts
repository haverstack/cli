/**
 * StackRecord -> the `record.md` text: YAML front matter for native and
 * scalar fields, the body below the divider. This renders an existing
 * record faithfully — it is the `hstack show` output and the starting
 * buffer for `hstack edit`. Scaffolding a *new* record from a schema, and
 * parsing the text back with validation, are Phase 3.
 * See docs/design.md § Schema-driven front matter.
 */

import type { FieldDef, StackRecord, StackType, TypeSchema } from '@haverstack/core';
import { iso, oneLine } from '../util.js';
import { stringify } from 'yaml';

/**
 * The single field that renders as the body: the one `text` field, else a
 * `text` field literally named `body` or `text`, else none (front matter
 * only). Ambiguity is left for `hstack edit --body` to resolve.
 */
export function bodyFieldOf(type: StackType | null | undefined): string | null {
  if (!type) return null;
  const textFields = Object.entries(type.schema)
    .filter(([, def]) => def.kind === 'text')
    .map(([name]) => name);
  if (textFields.length === 1) return textFields[0];
  if (textFields.includes('body')) return 'body';
  if (textFields.includes('text')) return 'text';
  return null;
}

export function renderRecord(record: StackRecord, type?: StackType | null): string {
  const body = bodyFieldOf(type);

  const front: Record<string, unknown> = { id: record.id, type: record.typeId };
  if (record.parentId) front.parentId = record.parentId;

  const tags = (record.associations ?? []).filter((a) => a.kind === 'tag').map((a) => a.label);
  if (tags.length > 0) front.tags = tags;

  // Schema order when the type is known; declared fields first, then any
  // undeclared extras the record happens to carry.
  const order = type ? Object.keys(type.schema) : [];
  for (const key of Object.keys(record.content)) if (!order.includes(key)) order.push(key);
  for (const key of order) {
    if (key === body || !(key in record.content)) continue;
    front[key] = record.content[key];
  }

  front._readonly = readonlyBlock(record);

  const yaml = stringify(front, { lineWidth: 0 }).trimEnd();
  const bodyValue = body ? record.content[body] : undefined;
  const bodyText = typeof bodyValue === 'string' ? bodyValue : '';
  return `---\n${yaml}\n---\n${bodyText ? `${bodyText}\n` : ''}`;
}

function readonlyBlock(record: StackRecord): Record<string, unknown> {
  const ro: Record<string, unknown> = {
    version: record.version,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  };
  if (record.entityId) ro.entityId = record.entityId;
  if (record.updatedBy && record.updatedBy !== record.entityId) ro.updatedBy = record.updatedBy;
  if (record.deletedAt) ro.deletedAt = iso(record.deletedAt);
  if (record.unlistedAt) ro.unlistedAt = iso(record.unlistedAt);

  const relatedAndFiles = (record.associations ?? []).filter((a) => a.kind !== 'tag');
  if (relatedAndFiles.length > 0) ro.associations = relatedAndFiles;
  if (record.permissions && record.permissions.length > 0) ro.permissions = record.permissions;
  return ro;
}

/** A one-line human label for a record in a listing. */
export function summarize(record: StackRecord): string {
  for (const key of ['title', 'name', 'text', 'body', 'url', 'label']) {
    const value = record.content[key];
    if (typeof value === 'string' && value.trim().length > 0) return oneLine(value);
  }
  return '—';
}

/** `string`, `array<string>`, `object`, … for a schema field. */
export function fieldKindLabel(def: FieldDef): string {
  if (def.kind === 'array') return `array<${fieldKindLabel(def.items)}>`;
  return def.kind;
}

export function formatSchema(schema: TypeSchema, indent = 0): string {
  const pad = '  '.repeat(indent);
  const names = Object.keys(schema);
  if (names.length === 0) return `${pad}(no fields)`;
  const width = Math.max(...names.map((n) => n.length));

  const lines: string[] = [];
  for (const [name, def] of Object.entries(schema)) {
    const req = def.required ? '  required' : '';
    lines.push(`${pad}${name.padEnd(width)}  ${fieldKindLabel(def)}${req}`);
    if (def.kind === 'object') lines.push(formatSchema(def.properties, indent + 1));
    else if (def.kind === 'array' && def.items.kind === 'object') {
      lines.push(formatSchema(def.items.properties, indent + 1));
    }
  }
  return lines.join('\n');
}
