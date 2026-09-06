#!/usr/bin/env node
/**
 * @haverstack/cli — the `haverstack` / `hstack` binary.
 *
 * A type-agnostic tool for editing a Haverstack stack from a terminal,
 * against a local SQLite file or (later) a remote server. This file is the
 * entry point: it wires argument parsing to the command implementations in
 * ./commands and the connection seam in ./openStack. See docs/design.md.
 */

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { openStack } from './openStack.js';
import { collectTypes, formatTypes } from './commands/types.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const program = new Command();

program
  .name('hstack')
  .description('Type-agnostic editing tool for a Haverstack stack')
  .version(pkg.version)
  .option(
    '-s, --stack <target>',
    'stack to operate on: a path to a local .db file (or $HAVERSTACK_STACK)',
  );

program
  .command('types')
  .description('List the types registered in the stack')
  .option('--json', 'output raw JSON instead of a table')
  .action(async function (this: Command, opts: { json?: boolean }) {
    const { stack: target } = this.optsWithGlobals() as { stack?: string };
    const opened = await openStack(target ?? process.env.HAVERSTACK_STACK);
    try {
      const types = await collectTypes(opened.stack);
      process.stdout.write(`${formatTypes(types, Boolean(opts.json))}\n`);
    } finally {
      await opened.close();
    }
  });

program.addHelpText(
  'after',
  `
Planned command groups (see docs/design.md § Command surface):
  stack add|ls|use|rm      manage stack profiles
  types [show|define]      inspect and register types
  ls | show | versions     read records
  new | edit | status | commit | discard    the editing loop
  rm | restore             delete and undelete
  tag | link | attach | perm | grant         associations, permissions, grants
`,
);

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
