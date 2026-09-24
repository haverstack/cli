#!/usr/bin/env node
/**
 * End-to-end smoke test for the built binary (`dist/cli.js`), spawned as a
 * real subprocess — not the exported functions `tests/` calls in-process.
 * Runs in CI after `pnpm run build` so a packaging or wiring mistake that
 * only shows up when `hstack` actually runs (a bad shebang, a missing
 * dist file, an argv-parsing slip) fails the build rather than shipping.
 * Self-contained: seeds its own temp stack, no external fixtures needed.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LocalAdapter } from '@haverstack/adapter-local';
import { Stack } from '@haverstack/core';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'dist', 'cli.js');
const TYPE_ID = 'smoke.test/item@1';

let failures = 0;
function check(ok, msg) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
}

const work = mkdtempSync(join(tmpdir(), 'hstack-smoke-'));
const dbPath = join(work, 'stack.db');
const env = {
  ...process.env,
  XDG_CONFIG_HOME: join(work, 'config'),
  XDG_STATE_HOME: join(work, 'state'),
  XDG_DATA_HOME: join(work, 'data'),
  HAVERSTACK_STACK: dbPath,
  EDITOR: `node ${join(work, 'editor-stub.mjs')}`,
};

// A scripted "editor": fills the empty body section a fresh scaffold
// leaves for a required text field, so `-c` can commit non-interactively.
writeFileSync(
  join(work, 'editor-stub.mjs'),
  "import {appendFileSync} from 'node:fs'; appendFileSync(process.argv[2], 'Smoke test body.\\n');\n",
);

function run(...args) {
  return execFileSync('node', [cli, ...args], { env, encoding: 'utf8' });
}

async function main() {
  const seed = await Stack.create(
    await LocalAdapter.initialize({ path: dbPath, entityId: 'did:key:zSmoke' }),
  );
  await seed.defineType(TYPE_ID, 'Item', { body: { kind: 'text', required: true } });
  await seed.close();

  const types = JSON.parse(run('types', '--json'));
  check(
    types.some((t) => t.id === TYPE_ID),
    '`types --json` lists the seeded type',
  );

  run('new', TYPE_ID, '-c');
  const created = JSON.parse(run('ls', TYPE_ID, '--json'));
  check(created.length === 1, '`new -c` created exactly one record');
  const id = created[0]?.id;
  check(Boolean(id), 'created record has an id');

  const shown = run('show', id);
  check(shown.includes('Smoke test body.'), '`show` renders the committed body');

  run('tag', 'add', id, 'smoke');
  const tagged = JSON.parse(run('show', id, '--json'));
  check(
    (tagged.associations ?? []).some((a) => a.kind === 'tag' && a.label === 'smoke'),
    '`tag add` associated the tag',
  );

  run('perm', 'add', id, '--to', 'anyone');
  const shared = JSON.parse(run('show', id, '--json'));
  check(
    (shared.permissions ?? []).some((p) => p.kind === 'anyone' && p.label === 'read'),
    '`perm add --to anyone` wrote an `anyone` element',
  );
  check(shared.version === tagged.version, 'tagging and sharing are no-bump writes');

  // The listing prints targets in --to's own grammar, so a row is a command.
  const permRow = run('perm', 'ls', id)
    .trim()
    .split('\n')
    .at(-1)
    .split(/\s{2,}/)[0];
  check(permRow === 'anyone', `\`perm ls\` prints the target as --to takes it (${permRow})`);
  run('perm', 'rm', id, '--to', permRow);
  check(
    (JSON.parse(run('show', id, '--json')).permissions ?? []).length === 0,
    '`perm ls` output feeds straight back into `perm rm`',
  );

  run('link', 'add', id, '--label', 'mirrors', '--to', 'external:atproto/at://x/y');
  check(
    (JSON.parse(run('show', id, '--json')).associations ?? []).some(
      (a) => a.kind === 'relationship' && a.target?.ns === 'atproto' && a.target?.id === 'at://x/y',
    ),
    '`link add --to external:<ns>/<id>` splits on the first slash only',
  );
  run('link', 'rm', id, '--label', 'mirrors', '--to', 'external:atproto/at://x/y');

  run('rm', id);
  const afterRm = JSON.parse(run('ls', TYPE_ID, '--json'));
  check(afterRm.length === 0, '`rm` excludes the record from a default listing');

  run('restore', id);
  const afterRestore = JSON.parse(run('ls', TYPE_ID, '--json'));
  check(afterRestore.length === 1, '`restore` brings it back');

  rmSync(work, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
