#!/usr/bin/env node
/**
 * @haverstack/cli — the `haverstack` / `hstack` binary.
 *
 * A type-agnostic tool for editing a Haverstack stack from a terminal,
 * against a local SQLite file or a remote server. This file wires argument
 * parsing to the command implementations in ./commands, the connection seam
 * in ./openStack, and the profile store in ./config. See docs/design.md.
 */

import { readFileSync } from 'node:fs';
import { Command, InvalidArgumentError } from 'commander';
import { openStack } from './openStack.js';
import { formatBanner } from './banner.js';
import { collectTypes, formatTypes, showType } from './commands/types.js';
import { listRecords, recordVersions, showRecord } from './commands/records.js';
import { stackAdd, stackList, stackRemove, stackUse } from './commands/stack.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const program = new Command();

program
  .name('hstack')
  .description('Type-agnostic editing tool for a Haverstack stack')
  .version(pkg.version)
  .option('-s, --stack <target>', 'stack to operate on: a path, a profile name, or a URL');

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError('expected a positive integer');
  return n;
}

const collect = (value: string, prev: string[]): string[] => [...prev, value];

/** Open the stack named by the global `--stack` / env / default, printing the banner. */
async function open(command: Command) {
  const { stack: target } = command.optsWithGlobals() as { stack?: string };
  const opened = await openStack({ target });
  process.stderr.write(`${formatBanner(opened)}\n`);
  return opened;
}

// --- stack profiles -------------------------------------------------------

const stack = program.command('stack').description('Manage stack profiles');

stack
  .command('add <name>')
  .description('Add a profile: --url <server> (generates an identity) or --path <file.db>')
  .option('--url <url>', 'server stack base URL')
  .option('--path <path>', 'local stack .db file')
  .option('--expected-owner <did>', 'refuse a server reporting a different owner')
  .action(async (name: string, opts: { url?: string; path?: string; expectedOwner?: string }) => {
    out(await stackAdd(name, opts));
  });

stack
  .command('ls')
  .description('List profiles; * marks the default')
  .action(async () => out(await stackList()));

stack
  .command('use <name>')
  .description('Set the default profile')
  .action(async (name: string) => out(await stackUse(name)));

stack
  .command('rm <name>')
  .description('Remove a profile (its key file is left in place)')
  .action(async (name: string) => out(await stackRemove(name)));

// --- types --------------------------------------------------------------

const types = program
  .command('types')
  .description('List the types registered in the stack')
  .option('--json', 'output raw JSON')
  .action(async function (this: Command, opts: { json?: boolean }) {
    const opened = await open(this);
    try {
      out(formatTypes(await collectTypes(opened.stack), Boolean(opts.json)));
    } finally {
      await opened.close();
    }
  });

types
  .command('show <typeId>')
  .description("Print a type's schema")
  .option('--json', 'output raw JSON')
  .action(async function (this: Command, typeId: string, opts: { json?: boolean }) {
    const opened = await open(this);
    try {
      out(await showType(opened.stack, typeId, Boolean(opts.json)));
    } finally {
      await opened.close();
    }
  });

// --- records ----------------------------------------------------------------

program
  .command('ls [typeId]')
  .description('List records, newest storage order; loops the cursor to exhaustion')
  .option('--base <baseId>', 'match every version of a type family')
  .option('--parent <id>', 'only children of this record')
  .option('--root', 'only records with no parent')
  .option('--tag <label>', 'require this tag (repeatable)', collect, [])
  .option('--limit <n>', 'stop after N records', positiveInt)
  .option('--json', 'output raw JSON')
  .action(async function (
    this: Command,
    typeId: string | undefined,
    opts: {
      base?: string;
      parent?: string;
      root?: boolean;
      tag: string[];
      limit?: number;
      json?: boolean;
    },
  ) {
    const opened = await open(this);
    try {
      out(
        await listRecords(opened.stack, {
          typeId,
          base: opts.base,
          parent: opts.parent,
          root: opts.root,
          tags: opts.tag,
          limit: opts.limit,
          json: opts.json,
        }),
      );
    } finally {
      await opened.close();
    }
  });

program
  .command('show <id>')
  .description('Print a record as front matter + body')
  .option('--history', 'also list version history')
  .option('--json', 'output raw JSON')
  .action(async function (this: Command, id: string, opts: { history?: boolean; json?: boolean }) {
    const opened = await open(this);
    try {
      out(await showRecord(opened.stack, id, { history: opts.history, json: opts.json }));
    } finally {
      await opened.close();
    }
  });

program
  .command('versions <id>')
  .description('Show a record’s version history')
  .option('--json', 'output raw JSON')
  .action(async function (this: Command, id: string, opts: { json?: boolean }) {
    const opened = await open(this);
    try {
      out(await recordVersions(opened.stack, id, Boolean(opts.json)));
    } finally {
      await opened.close();
    }
  });

program.addHelpText(
  'after',
  `
Planned command groups (see docs/design.md § Command surface):
  new | edit | status | commit | discard    the editing loop
  rm | restore             delete and undelete
  tag | link | attach | perm | grant         associations, permissions, grants
`,
);

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
