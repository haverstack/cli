/**
 * `hstack types` — list the types registered in a stack.
 *
 * Phase 0's proof-of-wiring command, and the base every editing command
 * builds on: the CLI defines no types, it reports whatever the stack has
 * (the six system types at minimum). See docs/design.md § Types.
 */

import type { Stack, StackType } from '@haverstack/core';

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
