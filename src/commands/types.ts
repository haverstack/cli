/**
 * `hstack types` / `show` / `define` — inspect and register the types a
 * stack has. The CLI defines none of its own; `define` is how a stack
 * gets bootstrapped without writing code. See docs/design.md § Types.
 */

import { readFile } from 'node:fs/promises';
import type { Stack, StackType, TypeId, TypeSchema } from '@haverstack/core';
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

type TypeSpec = { id: TypeId; name: string; schema: TypeSchema; migratesFrom?: TypeId };

/**
 * `schema.json` is `defineType()`'s own arguments, parsed JSON no compiler
 * has seen — check the shape `defineType` itself expects before handing it
 * over, so a malformed file gets a message naming the field rather than an
 * unrelated failure a few calls deep.
 */
async function readTypeSpec(filePath: string): Promise<TypeSpec> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read "${filePath}": ${(err as Error).message}`, { cause: err });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`"${filePath}" is not valid JSON: ${(err as Error).message}`, { cause: err });
  }

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`"${filePath}" must be a JSON object: { id, name, schema, migratesFrom? }.`);
  }
  const spec = json as Record<string, unknown>;

  if (typeof spec.id !== 'string' || !spec.id) {
    throw new Error(`"${filePath}": "id" must be a non-empty string (e.g. "com.example/task@2").`);
  }
  if (typeof spec.name !== 'string' || !spec.name) {
    throw new Error(`"${filePath}": "name" must be a non-empty string.`);
  }
  if (typeof spec.schema !== 'object' || spec.schema === null || Array.isArray(spec.schema)) {
    throw new Error(`"${filePath}": "schema" must be an object of field definitions.`);
  }
  if (spec.migratesFrom !== undefined && typeof spec.migratesFrom !== 'string') {
    throw new Error(`"${filePath}": "migratesFrom" must be a string when present.`);
  }

  return {
    id: spec.id as TypeId,
    name: spec.name,
    schema: spec.schema as TypeSchema,
    migratesFrom: spec.migratesFrom as TypeId | undefined,
  };
}

export async function typesDefine(stack: Stack, filePath: string): Promise<string> {
  const spec = await readTypeSpec(filePath);
  const before = await stack.getType(spec.id);
  const type = await stack.defineType(spec.id, spec.name, spec.schema, {
    ...(spec.migratesFrom && { migratesFrom: spec.migratesFrom }),
  });
  const hash = type.schemaHash.slice(0, 12);

  if (!before) return `Registered ${type.id} (${type.name}), schema ${hash}….`;
  if (before.schemaHash === type.schemaHash) {
    return before.name === type.name
      ? `${type.id} is already registered with this schema — no change.`
      : `${type.id}: renamed to "${type.name}" (schema unchanged, ${hash}…).`;
  }
  // A schema-drift violation would have thrown StackSchemaDriftError above,
  // so reaching here means the change was legal additive-in-place evolution
  // (new optional fields only) — the hash still moves for a legal diff too.
  return `${type.id}: schema extended additively — new hash ${hash}….`;
}
