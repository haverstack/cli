/**
 * scaffoldRecord — a fresh `record.md` for `hstack new`, derived from a
 * type's schema: required fields present, optional fields commented out,
 * each line labelled with its kind. The body section exists only if the
 * type has a body field. See docs/design.md § Schema-driven front matter.
 */

import type { StackType, TypeSchema } from '@haverstack/core';
import { bodyFieldOf, fieldKindLabel, RESERVED_FRONT_MATTER_KEYS } from './format.js';

export type ScaffoldOptions = {
  /** Client-minted id to pin, from `--id`. */
  id?: string;
  /** Parent record id, from `--parent`. */
  parentId?: string;
  /** Override which text field is the body (from `--body` / config). */
  bodyField?: string | null;
  /** Only required fields — skip the commented-out optionals. */
  minimal?: boolean;
};

export function scaffoldRecord(type: StackType, opts: ScaffoldOptions = {}): string {
  const body = opts.bodyField !== undefined ? opts.bodyField : bodyFieldOf(type);

  const lines = ['---'];
  lines.push(
    opts.id ? `id: ${opts.id}` : hinted('# id:', 'optional — supply to pin the record id'),
  );
  lines.push(`type: ${type.id}`);
  lines.push(
    opts.parentId
      ? `parentId: ${opts.parentId}`
      : hinted('# parentId:', 'optional — id of a parent record'),
  );
  lines.push('tags: []');

  for (const [name, entry] of Object.entries(type.schema)) {
    if (name === body) continue;
    if (RESERVED_FRONT_MATTER_KEYS.includes(name)) {
      lines.push(
        `# note: content field "${name}" collides with a reserved key — not editable here`,
      );
      continue;
    }
    lines.push(...fieldLines(name, entry, 0, Boolean(opts.minimal)));
  }

  lines.push('---');
  return `${lines.join('\n')}\n${body ? '\n' : ''}`;
}

/** Lines for one schema field. Optional fields (and their subtrees) are commented out. */
function fieldLines(
  name: string,
  def: TypeSchema[string],
  indent: number,
  minimal: boolean,
): string[] {
  if (!def.required && minimal) return [];
  const pad = '  '.repeat(indent);
  const mark = def.required ? '' : '# ';
  const hint = `${def.required ? 'required' : 'optional'} — ${fieldKindLabel(def)}`;

  // `open: true` declares no interior to scaffold — a single line stands
  // for the whole field, same as any other leaf.
  if (def.kind === 'object' && !def.open) {
    const nested = Object.entries(def.properties).flatMap(([k, d]) =>
      fieldLines(k, d, indent + 1, minimal),
    );
    // An optional object comments its whole subtree; a required one keeps
    // its required children live.
    const body = def.required ? nested : nested.map(commentOut);
    return [hinted(`${pad}${mark}${name}:`, hint), ...body];
  }

  const value =
    def.kind === 'array'
      ? ' []'
      : def.kind === 'object'
        ? ' {}'
        : def.kind === 'boolean'
          ? ' false'
          : '';
  return [hinted(`${pad}${mark}${name}:${value}`, hint)];
}

/** `<lhs>` padded to a column, then `  # <note>`. */
function hinted(lhs: string, note: string): string {
  return `${lhs.padEnd(25)} # ${note}`;
}

function commentOut(line: string): string {
  const leading = line.match(/^\s*/)?.[0] ?? '';
  const rest = line.slice(leading.length);
  return rest.startsWith('# ') ? line : `${leading}# ${rest}`;
}
