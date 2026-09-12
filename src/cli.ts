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
import type { GrantAction } from '@haverstack/core';
import { openStack } from './openStack.js';
import { loadConfig } from './config.js';
import { formatBanner } from './banner.js';
import { collectTypes, formatTypes, showType } from './commands/types.js';
import {
  listRecords,
  recordVersions,
  removeRecord,
  restoreRecord,
  showRecord,
} from './commands/records.js';
import {
  commitEdit,
  discardEdit,
  editRecord,
  editStatus,
  newRecord,
  type StartResult,
} from './commands/edit.js';
import {
  launchEditor,
  launchExplorer,
  NoEditorError,
  resolveEditorCommand,
} from './edit/editor.js';
import { stackAdd, stackList, stackRemove, stackUse } from './commands/stack.js';
import { tagAdd, tagRemove, linkAdd, linkRemove } from './commands/associations.js';
import { permAdd, permRemove, grantAdd, grantRemove, grantList } from './commands/access.js';

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

function note(text: string): void {
  process.stderr.write(`${text}\n`);
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
  note(formatBanner(opened));
  return opened;
}

/** Launch the editor for a just-started edit, or (with `-c`) drive the commit inline. */
async function afterStart(
  opened: Awaited<ReturnType<typeof open>>,
  started: StartResult,
  opts: { commit?: boolean; explorer?: boolean },
): Promise<void> {
  for (const w of started.warnings) note(`  ! ${w}`);
  const config = await loadConfig();
  const editor = resolveEditorCommand(config);

  if (opts.commit) {
    if (!editor) throw new NoEditorError();
    launchEditor(editor, started.file, true);
    const outcome = await commitEdit(opened.stack, opened.target, started.recordId, {});
    out(outcome.message);
    if (!outcome.ok) process.exitCode = 1;
    return;
  }

  if (editor) launchEditor(editor, started.file, false);
  if (config.explorer && opts.explorer !== false) launchExplorer(started.dir);
  out(
    editor
      ? `Editing ${started.recordId}. Run \`hstack commit\` when done.\n  ${started.file}`
      : `No editor configured. Edit this file, then run \`hstack commit\`:\n  ${started.file}`,
  );
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

// --- reading records ------------------------------------------------------

program
  .command('ls [typeId]')
  .description('List records; loops the cursor to exhaustion')
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

// --- the editing loop --------------------------------------------------------

program
  .command('new <typeId>')
  .description('Scaffold a new record and open it in your editor')
  .option('--id <id>', 'pin the record id instead of minting one')
  .option('--parent <id>', 'set the parent record')
  .option('--body <field>', 'which text field is the body')
  .option('--minimal', 'scaffold required fields only')
  .option('-c, --commit', 'wait for the editor, then commit')
  .option('--no-explorer', 'do not open a file manager')
  .action(async function (
    this: Command,
    typeId: string,
    opts: {
      id?: string;
      parent?: string;
      body?: string;
      minimal?: boolean;
      commit?: boolean;
      explorer?: boolean;
    },
  ) {
    const opened = await open(this);
    try {
      const started = await newRecord(opened.stack, opened.target, typeId, {
        id: opts.id,
        parent: opts.parent,
        body: opts.body,
        minimal: opts.minimal,
      });
      await afterStart(opened, started, opts);
    } finally {
      await opened.close();
    }
  });

program
  .command('edit <id>')
  .description('Open an existing record in your editor')
  .option('-c, --commit', 'wait for the editor, then commit')
  .option('--no-explorer', 'do not open a file manager')
  .action(async function (
    this: Command,
    id: string,
    opts: { commit?: boolean; explorer?: boolean },
  ) {
    const opened = await open(this);
    try {
      const started = await editRecord(opened.stack, opened.target, id);
      await afterStart(opened, started, opts);
    } finally {
      await opened.close();
    }
  });

program
  .command('status')
  .description('List edits in progress')
  .action(async function (this: Command) {
    const opened = await open(this);
    try {
      out(await editStatus(opened.target));
    } finally {
      await opened.close();
    }
  });

program
  .command('commit [id]')
  .description('Validate an edited record and write it back')
  .option('--force', 'skip the optimistic-concurrency check (last writer wins)')
  .action(async function (this: Command, id: string | undefined, opts: { force?: boolean }) {
    const opened = await open(this);
    try {
      const outcome = await commitEdit(opened.stack, opened.target, id, { force: opts.force });
      out(outcome.message);
      if (outcome.reopen) {
        const editor = resolveEditorCommand(await loadConfig());
        if (editor) launchEditor(editor, `${outcome.reopen}/record.md`, false);
      }
      if (!outcome.ok) process.exitCode = 1;
    } finally {
      await opened.close();
    }
  });

program
  .command('discard [id]')
  .description('Throw away an edit in progress')
  .option('--stale', 'discard every stale edit for this stack')
  .action(async function (this: Command, id: string | undefined, opts: { stale?: boolean }) {
    const opened = await open(this);
    try {
      out(await discardEdit(opened.target, id, { stale: opts.stale }));
    } finally {
      await opened.close();
    }
  });

// --- delete / restore ------------------------------------------------------

program
  .command('rm <id>')
  .description('Soft-delete a record (or --hard to purge)')
  .option('--hard', 'purge permanently (owner only on a server)')
  .action(async function (this: Command, id: string, opts: { hard?: boolean }) {
    const opened = await open(this);
    try {
      out(await removeRecord(opened.stack, id, Boolean(opts.hard)));
    } finally {
      await opened.close();
    }
  });

program
  .command('restore <id>')
  .description('Undo a soft delete')
  .action(async function (this: Command, id: string) {
    const opened = await open(this);
    try {
      out(await restoreRecord(opened.stack, id));
    } finally {
      await opened.close();
    }
  });

// --- associations, permissions, grants -------------------------------------

const tag = program.command('tag').description('Add or remove a tag');

tag
  .command('add <id> <label>')
  .description('Tag a record')
  .action(async function (this: Command, id: string, label: string) {
    const opened = await open(this);
    try {
      out(await tagAdd(opened.stack, id, label));
    } finally {
      await opened.close();
    }
  });

tag
  .command('rm <id> <label>')
  .description('Untag a record')
  .action(async function (this: Command, id: string, label: string) {
    const opened = await open(this);
    try {
      out(await tagRemove(opened.stack, id, label));
    } finally {
      await opened.close();
    }
  });

const link = program.command('link').description('Add or remove a relationship association');

function linkOptions(cmd: Command) {
  return cmd
    .requiredOption('--label <label>', 'the relationship label')
    .option('--to-record <id>', 'target a record in this stack (or another, with --stack-url)')
    .option('--stack-url <url>', 'the target record lives in this other stack')
    .option('--to-entity <did>', 'target an identity')
    .option('--to-external <ns>', 'target something outside any stack, in this namespace')
    .option('--external-id <id>', 'the identifier within --to-external’s namespace');
}

type LinkCliOptions = {
  label: string;
  toRecord?: string;
  stackUrl?: string;
  toEntity?: string;
  toExternal?: string;
  externalId?: string;
};

linkOptions(link.command('add <id>'))
  .description('Link a record to a target')
  .action(async function (this: Command, id: string, opts: LinkCliOptions) {
    const opened = await open(this);
    try {
      out(
        await linkAdd(opened.stack, id, opts.label, {
          toRecord: opts.toRecord,
          stackUrl: opts.stackUrl,
          toEntity: opts.toEntity,
          toExternalNs: opts.toExternal,
          externalId: opts.externalId,
        }),
      );
    } finally {
      await opened.close();
    }
  });

linkOptions(link.command('rm <id>'))
  .description('Remove a link (same target flags as when it was added)')
  .action(async function (this: Command, id: string, opts: LinkCliOptions) {
    const opened = await open(this);
    try {
      out(
        await linkRemove(opened.stack, id, opts.label, {
          toRecord: opts.toRecord,
          stackUrl: opts.stackUrl,
          toEntity: opts.toEntity,
          toExternalNs: opts.toExternal,
          externalId: opts.externalId,
        }),
      );
    } finally {
      await opened.close();
    }
  });

const perm = program.command('perm').description('Add or remove a record permission');

function permOptions(cmd: Command) {
  return cmd
    .option('--public', 'anyone may access it')
    .option('--entity <did>', 'grant this identity access')
    .option('--group <id>', 'grant this group access')
    .option('--role <role>', 'restrict a --group entry to admins ("admin")')
    .option('--read', 'grant read access')
    .option('--write', 'grant write access');
}

type PermCliOptions = {
  public?: boolean;
  entity?: string;
  group?: string;
  role?: string;
  read?: boolean;
  write?: boolean;
};

function permTarget(opts: PermCliOptions) {
  if (opts.role && opts.role !== 'admin') throw new InvalidArgumentError('--role must be "admin"');
  return {
    public: opts.public,
    entity: opts.entity,
    group: opts.group,
    role: opts.role as 'admin' | undefined,
  };
}

permOptions(perm.command('add <id>'))
  .description('Grant record-level access')
  .action(async function (this: Command, id: string, opts: PermCliOptions) {
    const opened = await open(this);
    try {
      out(
        await permAdd(opened.stack, id, permTarget(opts), Boolean(opts.read), Boolean(opts.write)),
      );
    } finally {
      await opened.close();
    }
  });

permOptions(perm.command('rm <id>'))
  .description('Remove or narrow record-level access')
  .action(async function (this: Command, id: string, opts: PermCliOptions) {
    const opened = await open(this);
    try {
      out(
        await permRemove(
          opened.stack,
          id,
          permTarget(opts),
          Boolean(opts.read),
          Boolean(opts.write),
        ),
      );
    } finally {
      await opened.close();
    }
  });

const grant = program.command('grant').description('Add, remove, or list type-level grants');

function grantOptions(cmd: Command) {
  return cmd
    .option('--entity <did>', 'grant this identity')
    .option('--group <id>', 'grant this group')
    .option('--default', 'grant any authenticated entity');
}

type GrantCliOptions = { entity?: string; group?: string; default?: boolean };

grantOptions(grant.command('add <typeId> <actions...>'))
  .description('Grant create/read/update/delete on a type family')
  .action(async function (this: Command, typeId: string, actions: string[], opts: GrantCliOptions) {
    const opened = await open(this);
    try {
      out(
        await grantAdd(
          opened.stack,
          typeId,
          { entity: opts.entity, group: opts.group, isDefault: opts.default },
          actions as GrantAction[],
        ),
      );
    } finally {
      await opened.close();
    }
  });

grantOptions(grant.command('rm <typeId> <actions...>'))
  .description('Revoke actions granted on a type family')
  .action(async function (this: Command, typeId: string, actions: string[], opts: GrantCliOptions) {
    const opened = await open(this);
    try {
      out(
        await grantRemove(
          opened.stack,
          typeId,
          { entity: opts.entity, group: opts.group, isDefault: opts.default },
          actions as GrantAction[],
        ),
      );
    } finally {
      await opened.close();
    }
  });

grant
  .command('ls')
  .description('List grants')
  .option('--type <typeId>', 'only this type')
  .action(async function (this: Command, opts: { type?: string }) {
    const opened = await open(this);
    try {
      out(await grantList(opened.stack, opts.type));
    } finally {
      await opened.close();
    }
  });

program.addHelpText(
  'after',
  `
Planned command groups (see docs/design.md § Command surface):
  attach                     files as attachments outside an edit session
`,
);

program.parseAsync(process.argv).catch((err: unknown) => {
  note(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
