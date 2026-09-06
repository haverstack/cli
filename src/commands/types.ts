/**
 * `hstack types` / `hstack types show <typeId>` — inspect the types a stack
 * has. The CLI defines none; it reports whatever it finds (the six system
 * types at minimum). See docs/design.md § Types.
 */

import type { Stack, StackType } from '@haverstack/core';
import { formatSchema } from '../record/format.js';
import { iso } from '../util.js';

export async function collectTypes(stack: Stack): Promise<StackType[]> {
  const types = await stack.listTypes();
  return [...types].sort((a, b) => a.id.localeCompare(b.id));
}

export function formatTypes(types: StackType[], json: boolean): string {
  if (json) return JSON.stringify(types, null, 2);
  if (types.length === 0) return 'No types registered.';

  const idWidth = Math.max('TYPE'.length, ...types.map((t) => t.id.length));
  const nameWidth = Math.max('NAME'.length, ...types.map((t) => t.name.length));
  const line = (id: string, name: string, schema: string) =>
    `${id.padEnd(idWidth)}  ${name.padEnd(nameWidth)}  ${schema}`;

  return [
    line('TYPE', 'NAME', 'SCHEMA'),
    ...types.map((t) => line(t.id, t.name, t.schemaHash.slice(0, 12))),
  ].join('\n');
}

export async function showType(stack: Stack, typeId: string, json: boolean): Promise<string> {
  const type = await stack.getType(typeId);
  if (!type) throw new Error(`No type "${typeId}".`);
  if (json) return JSON.stringify(type, null, 2);

  const header =
    `${type.id}  (${type.name})\n` +
    `schema ${type.schemaHash.slice(0, 12)}  ·  version ${type.version}  ·  ` +
    `registered ${iso(type.createdAt)}` +
    (type.migratesFrom ? `  ·  migrates from ${type.migratesFrom}` : '');
  return `${header}\n\n${formatSchema(type.schema)}`;
}
