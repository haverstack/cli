/**
 * queryAll — run a query to exhaustion.
 *
 * `cursor === null` is the only end-of-results signal: a short or empty
 * page is not the end (a permission-scoped query can return several empty
 * pages before results appear), and `total` is `null` under scope. So
 * every listing loops the cursor. An explicit `limit` is the only way to
 * stop early. See docs/design.md § Command surface.
 */

import type { Stack, StackQuery, StackRecord } from '@haverstack/core';

export async function queryAll(
  stack: Stack,
  query: StackQuery = {},
  limit?: number,
): Promise<StackRecord[]> {
  const out: StackRecord[] = [];
  let cursor: string | undefined;

  do {
    const page = await stack.query({ ...query, cursor });
    out.push(...page.records);
    cursor = page.cursor ?? undefined;
    if (limit !== undefined && out.length >= limit) return out.slice(0, limit);
  } while (cursor !== undefined);

  return out;
}
