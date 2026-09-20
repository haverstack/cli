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
import { collectTypes, formatTypes, showType, typesDefine } from './commands/types.js';
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
  isInteractiveTerminal,
  isTuiEditorCommand,
  NoEditorError,
  resolveEditorCommand,
} from './edit/editor.js';
import { stackAdd, stackList, stackRemove, stackUse } from './commands/stack.js';
import { tagAdd, tagRemove, linkAdd, linkRemove } from './commands/associations.js';
import {
  permAdd,
  permList,
  permRemove,
  grantAdd,
  grantRemove,
  grantList,
} from './commands/access.js';
import { attachAdd, attachRemove } from './commands/attach.js';

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
  opts: { commit?: boolean; wait?: boolean; explorer?: boolean },
): Promise<void> {
  for (const w of started.warnings) note(`  ! ${w}`);
  if (opts.commit && opts.wait === false) {
    throw new Error('--no-wait contradicts -c/--commit, which always waits for the editor.');
  }
  const config = await loadConfig();
  const editor = resolveEditorCommand(config);
  const explorer = config.explorer || opts.explorer;

  if (opts.commit) {
    if (!editor) throw new NoEditorError();
    // Before the editor, which blocks: opened after, a file manager would
    // only ever appear once you'd already closed the thing you wanted it
    // open alongside.
    if (explorer) launchExplorer(started.dir);
    launchEditor(editor, started.file, true);
    const outcome = await commitEdit(opened.stack, opened.target, started.recordId, {});
    out(outcome.message);
    if (!outcome.ok) process.exitCode = 1;
    return;
  }

  if (!editor) {
    out(`No editor configured. Edit this file, then run \`hstack commit\`:\n  ${started.file}`);
    return;
  }

  // A terminal editor (nano, vim, ...) can't do anything without a real
  // controlling terminal, so it only gets one by default when this process
  // has one itself — a script or agent driving hstack as a subprocess
  // never does, and must ask for --wait explicitly to get it anyway.
  const wait = opts.wait ?? (isInteractiveTerminal() && isTuiEditorCommand(editor));
  if (explorer) launchExplorer(started.dir);
  launchEditor(editor, started.file, wait);
  out(
    wait
      ? `Done editing ${started.recordId}. Run \`hstack commit\` when ready.\n  ${started.file}`
      : `Editing ${started.recordId}. Run \`hstack commit\` when done.\n  ${started.file}`,
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

types
  .command('define <schemaFile>')
  .description('Register (or additively extend) a type from a schema file')
  .action(async function (this: Command, schemaFile: string) {
    const opened = await open(this);
    try {
      out(await typesDefine(opened.stack, schemaFile));
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
  .option('--wait', 'wait for the editor to exit before returning (no auto-commit)')
  .option('--no-wait', 'never wait, even for a terminal editor (e.g. when scripting hstack)')
  .option('--explorer', 'also open a file manager on the working directory')
  .action(async function (
    this: Command,
    typeId: string,
    opts: {
      id?: string;
      parent?: string;
      body?: string;
      minimal?: boolean;
      commit?: boolean;
      wait?: boolean;
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
  .option('--wait', 'wait for the editor to exit before returning (no auto-commit)')
  .option('--no-wait', 'never wait, even for a terminal editor (e.g. when scripting hstack)')
  .option('--explorer', 'also open a file manager on the working directory')
  .action(async function (
    this: Command,
    id: string,
    opts: { commit?: boolean; wait?: boolean; explorer?: boolean },
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

const perm = program
  .command('perm')
  .description('Add, remove, or list record permissions (read/write, per grantee)');

function permOptions(cmd: Command) {
  return cmd
    .option('--anyone', 'reach the world, anonymous requesters included (read only)')
    .option('--entity <did>', 'this identity')
    .option('--group <id>', 'this group, at --role')
    .option('--role <role>', 'which half of a --group: "member" (wider) or "admin"', permRole)
    .option('--read', 'the read bit')
    .option('--write', 'the write bit (core refuses a writer who cannot read)');
}

type PermCliOptions = {
  anyone?: boolean;
  entity?: string;
  group?: string;
  role?: 'member' | 'admin';
  read?: boolean;
  write?: boolean;
};

function permRole(value: string): 'member' | 'admin' {
  if (value !== 'member' && value !== 'admin') {
    throw new InvalidArgumentError('--role must be "member" or "admin"');
  }
  return value;
}

function permTarget(opts: PermCliOptions) {
  return { anyone: opts.anyone, entity: opts.entity, group: opts.group, role: opts.role };
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
  .description('Withdraw record-level access — no --read/--write withdraws all of it')
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

perm
  .command('ls <id>')
  .description('List who reaches a record')
  .option('--json', 'output raw JSON')
  .action(async function (this: Command, id: string, opts: { json?: boolean }) {
    const opened = await open(this);
    try {
      out(await permList(opened.stack, id, Boolean(opts.json)));
    } finally {
      await opened.close();
    }
  });

const grant = program.command('grant').description('Add, remove, or list type-level grants');

function grantRole(allowAny: boolean) {
  return (value: string): 'member' | 'admin' | 'any' => {
    const allowed = allowAny ? ['"member"', '"admin"', '"any"'] : ['"member"', '"admin"'];
    if (!allowed.includes(`"${value}"`)) {
      const named = `${allowed.slice(0, -1).join(', ')} or ${allowed.at(-1)}`;
      throw new InvalidArgumentError(`--role must be ${named}`);
    }
    return value as 'member' | 'admin' | 'any';
  };
}

function grantOptions(cmd: Command, allowAny = false) {
  return cmd
    .option('--entity <did>', 'this identity')
    .option('--group <id>', 'this group, at --role')
    .option(
      '--role <role>',
      allowAny
        ? 'which half of a --group: "member", "admin", or "any" (default)'
        : 'which half of a --group: "member" (wider) or "admin"',
      grantRole(allowAny),
    )
    .option('--authenticated', 'any entity holding a DID');
}

type GrantCliOptions = {
  entity?: string;
  group?: string;
  role?: 'member' | 'admin' | 'any';
  authenticated?: boolean;
};

const grantTarget = (opts: GrantCliOptions) => ({
  entity: opts.entity,
  group: opts.group,
  role: opts.role,
  authenticated: opts.authenticated,
});

grantOptions(grant.command('add <typeId> <actions...>'))
  .description('Grant create/read/update/delete on a type family')
  .action(async function (this: Command, typeId: string, actions: string[], opts: GrantCliOptions) {
    const opened = await open(this);
    try {
      out(await grantAdd(opened.stack, typeId, grantTarget(opts), actions as GrantAction[]));
    } finally {
      await opened.close();
    }
  });

grantOptions(grant.command('rm <typeId> <actions...>'))
  .description('Revoke actions granted on a type family')
  .action(async function (this: Command, typeId: string, actions: string[], opts: GrantCliOptions) {
    const opened = await open(this);
    try {
      out(await grantRemove(opened.stack, typeId, grantTarget(opts), actions as GrantAction[]));
    } finally {
      await opened.close();
    }
  });

grantOptions(grant.command('ls'), true)
  .description('List grants — narrow by --type and/or a grantee')
  .option('--type <typeId>', 'only this type')
  .action(async function (this: Command, opts: GrantCliOptions & { type?: string }) {
    const opened = await open(this);
    try {
      out(await grantList(opened.stack, opts.type, grantTarget(opts)));
    } finally {
      await opened.close();
    }
  });

const attach = program.command('attach').description('Attach a file outside an edit session');

attach
  .command('add <id>')
  .description('Attach a file, uploading it')
  .requiredOption('--label <label>', 'the attachment label (e.g. "embed", "avatar")')
  .requiredOption('--file <path>', 'the file to upload')
  .action(async function (this: Command, id: string, opts: { label: string; file: string }) {
    const opened = await open(this);
    try {
      out(await attachAdd(opened.stack, id, opts.label, opts.file));
    } finally {
      await opened.close();
    }
  });

attach
  .command('rm <id>')
  .description('Detach a file (the fileId from `hstack show --json`)')
  .requiredOption('--label <label>', 'the attachment label')
  .requiredOption('--file-id <sha256>', 'the attachment’s fileId')
  .action(async function (this: Command, id: string, opts: { label: string; fileId: string }) {
    const opened = await open(this);
    try {
      out(await attachRemove(opened.stack, id, opts.label, opts.fileId));
    } finally {
      await opened.close();
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  note(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
