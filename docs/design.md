# `@haverstack/cli` — design

A general-purpose editing tool for a Haverstack stack. Create, edit, and organize
records of any type from a terminal, using your own editor, against a local SQLite file
or a remote stack server. This document describes how it works and why the moving parts
are where they are.

Package `@haverstack/cli`, repo `github.com/haverstack/cli`. Ships two bins: `haverstack`
(canonical, consistent with the `haverstack-eleventy` sibling) and `hstack` (a shorter
alias for daily use — examples here use it). Standalone, not
part of the core monorepo — same shape and toolchain as `@haverstack/eleventy`.

---

## What it is

The editing counterpart to the library. A stack you can only reach through code is a
stack you cannot casually use; the CLI is how a person writes into one without an app
being built first.

Its defining constraint is that it is **type-agnostic**. It knows nothing about notes,
articles, sites, or slugs. It knows how to fetch a type's schema, turn it into something
editable, and validate what comes back. Every type in a stack — commons, app-defined, or
one registered five minutes ago — is editable by the same tool on the day it is
registered.

It is also **script-composable**. Every read command takes `--json` for piping into
`jq`; the CLI is a client you can build on, not only one you sit in front of.

### Non-goals

- **Slugs, permalinks, feeds, site building.** Generator concerns. A slug collides only
  relative to a page tree and permalink rules, so the uniqueness predicate is undefined
  without them — a CLI able to answer it would be a site generator. That is
  `@haverstack/eleventy`'s job.
- **A TUI.** The editor is your editor; the file manager is your file manager. (A
  `--pick` fuzzy-selector for association targets is a plausible later addition; see
  [Deferred](#deferred).)
- **Serving.** That is the stack server's job.
- **Being a sync client.** It reads and writes on demand. No background daemon, no local
  mirror.
- **Authoring migration functions.** `registerMigration` takes a JS closure over old and
  new content — app code, not admin data a CLI flag can carry. `hstack types define`
  registers a _schema_; moving records across versions with a function stays in app code.

---

## It talks to a Stack — local or server

The CLI resolves one `Stack` per invocation and runs every command against it. Two
backends:

| Target                | Adapter                                    | Selected by                                                                                   |
| --------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| A local SQLite file   | `@haverstack/adapter-local` `LocalAdapter` | `--stack <path>`, `$HAVERSTACK_STACK` pointing at a path, or a profile whose target is a path |
| A remote stack server | `@haverstack/adapter-api` `APIAdapter`     | `--stack <name>` naming a server profile, or `$HAVERSTACK_STACK` naming one                   |

One seam, `openStack(target)`, produces a `Stack`; everything downstream is written
against `StackClient` and does not know which backend it has. A configurable default
profile means `hstack` with no `--stack` still knows where to go.

### Trust posture differs by backend, and the CLI says which it is in

- **Local** — `LocalAdapter` yields an unscoped `Stack`. Full trust: no type-level grant
  checks, `includeUnlisted` always allowed, `createdAt`/`updatedAt` backdatable on
  create. This is the same posture as an embedded single-app stack.
- **Server** — `APIAdapter` yields a session scoped to the profile's DID. That DID may be
  the stack owner or merely a grantee. Writes can come back as `StackPermissionError`;
  `includeUnlisted` is refused to anyone but the owner acting alone; `createdAt`/
  `updatedAt` on the wire are dropped for non-owners.

`hstack` prints the active target and whether it is operating as owner or grantee at the top
of any command that writes, so a permission refusal is never a surprise about _which_
stack or _whose_ authority was in play.

### The local single-writer lock

`LocalAdapter.open()` takes a process lock on the file (`<path>.lock`). The CLI holds it
only for the duration of one command — open, act, close — so it never blocks a stack
server or an `eleventy` build that wants the same file between invocations. This is why
the editing model below has the CLI process _exit_ while your editor is open rather than
hold the stack open across a writing session (see [The editing model](#the-editing-model)).

---

## Profiles, config, and key custody

A general-purpose tool talks to more than one stack, so configuration is global, never in
the working directory and never in a repository.

```
$XDG_CONFIG_HOME/haverstack/config.toml     # named profiles, defaults, editor prefs
$XDG_STATE_HOME/haverstack/edits/            # per-record locks and working copies
$XDG_DATA_HOME/haverstack/keys/              # DID private keys (JWK), when no OS keychain
```

(`~/.config`, `~/.local/state`, `~/.local/share` respectively when the XDG vars are
unset.)

### `config.toml`

```toml
default = "personal"
editor  = "code --new-window"   # falls back to $VISUAL, then $EDITOR
explorer = true                 # open a file manager on the working dir too

[profiles.personal]
url  = "https://stack.example.com"
did  = "did:key:z6Mk…"           # this CLI's identity, not the stack owner's
key  = "personal.jwk.json"       # how to find the private key (a filename in the keys dir)
expectedOwner = "did:key:z6Mk…"  # optional; open() refuses a server reporting anyone else

[profiles.personal.body]
"org.haverstack/article" = "text"   # per-type body-field override (see below)

[profiles.scratch]
path = "/home/jen/notes/scratch.db"   # a local file, not a URL
```

A profile names either a `url` (server) or a `path` (local file). `--stack` accepts a
profile name, a bare path, or a `https://` URL for a one-off server connection with no
stored profile (unauthenticated, for public reads). Resolution order when `--stack` is
absent: `$HAVERSTACK_STACK`, then the config's `default`.

### Identity and key custody

Authentication to a server is the DID challenge–response handshake, not a shared token.
`hstack stack add <name> --url <u>` generates a `did:key` Ed25519 keypair, prints the DID
for the stack owner to grant, and stores the private key. `APIAdapter.open()` runs the
handshake on open and re-runs it when the token expires, so there is no token to manage
by hand. `expectedOwner`, when set, makes `open()` refuse a server whose discovery
reports a different owner.

Key custody is the CLI's job — core is explicit that it is an app concern
(`identity.md`: "not this library's job"). The `key` field in a profile is the
indirection point: a **`0600` JWK file** under `$XDG_DATA_HOME/haverstack/keys/`, named
`<profile>.jwk.json`. An **OS-keychain** backend (`key = "keychain"`, via a lazily-loaded
optional dependency) is the planned alternative — adding it changes no config shape and
no code outside `keys.ts`, so it is deferred rather than designed around.

The key is persisted on first run whether or not a server is reachable yet, because the
asymmetry the spec warns about applies directly: losing it breaks nothing locally but
permanently ends the ability to authenticate to any server as that identity. A private
key round-trips through `exportDidPrivateKeyJwk` / `importDidPrivateKeyJwk`, and the
`DidCredential` handed to `APIAdapter` is `{ did, sign }` where `sign` closes over the
imported key via `signWithDid`. `hstack stack rm` never deletes the key file — it prints
where it is and leaves removing it to the user.

Local files need no identity: an unscoped `Stack` names no requester. `hstack stack add
<name> --path <p>` just records the (absolute) path.

---

## The editing model

An edit in progress is a **lock plus a working directory**. `hstack new` / `hstack edit`
materialize a record, open your editor on it, and _exit_. You edit — and save — as
freely as you like. `hstack commit` validates the working copy and writes it back as one
`mutate()`. `hstack discard` throws it away.

### Why stateful, not a synchronous editor spawn

A synchronous spawn (`git commit` style) would hold the stack open for the whole session
— hours or days for a long article — blocking any other writer of a local file, and
losing everything if the editor or terminal dies. The stateful model:

- **makes frequent saves free.** The working copy is a plain file. Saving it fifty times
  while drafting produces exactly zero version-history entries; only `hstack commit` calls
  `Stack.mutate()`.
- **survives a dead editor.** The working copy is on disk under XDG state; reopen it, or
  `hstack commit` it, whenever.
- **lets you consult the stack mid-edit.** `hstack show <other-id>` in another terminal
  works because the CLI isn't holding the file open.

### Working directory layout

```
$XDG_STATE_HOME/haverstack/edits/<stack-hash>/<recordId>/
  record.md          # YAML front matter + body — what your editor opens
  .hstack-lock.json  # { recordId, typeId, mode, bodyField, baseVersion?, readonly?, startedAt, stack }
  <anything else>    # files dropped here become attachments on commit (Phase 6)
```

`<stack-hash>` is a short SHA-256 of the resolved stack target (a path or `name (url)`),
so the same record id being edited against two stacks never collides. On `hstack new`,
`<recordId>` is minted up front with `generateId()` and written into the scaffold as
`id:`, so the edit has a real id from the start.

Locks are **per record, not global** — editing one record must never block editing
another, and referencing record B while writing record A is the common case. Nothing
lives in the current directory or a repo; a working copy that ends up committed to git is
a layout bug.

### Lifecycle

| Command                                           | Does                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hstack new <typeId> [--parent <id>] [--id <id>]` | Fetch the type, scaffold `record.md`, take a lock in `mode: "new"`, launch the editor.                                                                                                                                                                                      |
| `hstack edit <id>`                                | Fetch the record + its type, render `record.md`, snapshot `version` as `baseVersion`, take a lock in `mode: "edit"`, launch the editor. Download existing `embed` attachments into the working dir.                                                                         |
| `hstack status`                                   | List every open edit for the active stack: record id, type, mode, age, and whether it is stale (working file gone).                                                                                                                                                         |
| `hstack commit [<id>]`                            | Parse `record.md`, validate against the schema, reconcile `tags` as a set, write via `create()` (new) or `mutate()` with `ifVersion: baseVersion` (edit). On success, release the lock and delete the working dir. `<id>` is required only when more than one edit is open. |
| `hstack discard [<id>]`                           | Delete the working dir and lock. Never touches the stack. `--stale` sweeps every stale edit.                                                                                                                                                                                |

`hstack new` / `hstack edit` return once the working directory exists and hand the editor
launch to the CLI. A GUI editor is spawned **detached**, releasing any lock on a local
file immediately — the process exits and you keep working elsewhere until you're ready
to `commit`. A terminal editor (`nano`, `vim`, ...) can't run detached at all — it has no
window of its own, so without a controlling terminal it has nothing to draw into and
just exits — so `hstack` waits for one instead: not on a fixed name list alone, but only
when this process itself has a real terminal attached (`--wait`/`--no-wait` always
override the guess). A script or agent driving `hstack` as a subprocess never has one,
so it gets the same detached, immediately-returning behavior regardless of `$EDITOR`,
without needing to know about any flag. Waiting this way still doesn't commit anything —
that's `-c` / `--commit`'s job, which always waits _and_ commits once the editor exits,
the one-shot `git commit` feel. A file manager on the working dir opens **before** the
editor — including before a blocking one — when `explorer = true` is set in
`config.toml` (a standing preference) or `--explorer` is passed for just this call (e.g.
to drop an attachment before committing); off by default either way. Opening it first is
deliberate: opened after, it would only ever appear once you'd already closed the editor
you wanted it open alongside. The editor is `config.editor`, else `$VISUAL`, else
`$EDITOR`; with none set, `new`/`edit` just print the file path to open.

**`parentId` moves with the record.** Core's `mutate()` carries a content patch and a
`parentId` in one fenced write, so editing the `parentId` line and committing moves the
record — core checks the destination exists and refuses a cycle, surfaced as an ordinary
kept-copy failure if either is wrong. A move on its own is a **no-bump** write (below);
naming `contentPatch` alongside it is what puts the whole call back under `ifVersion`. A root record's rendered
buffer has no live `parentId` line to edit, so `hstack edit` always leaves a commented
`# parentId:` hint in its place — otherwise moving a record would be a capability with no
way to discover it from the file alone. Re-uploading files dropped into the working
directory is Phase 6.

### What does and does not bump a version

Core (0.33–0.35) settled six operations as **no-bump**: `associate`, `dissociate`,
`permissions`, `reparent`, `unlist` and `list`. They leave `version` _and_ `updatedAt`
exactly where they stand, take no snapshot, and are not fenced by `ifVersion` — a
set-add/remove composes correctly whatever order two writers land in, so there was never
a race for a precondition to guard. Only a content patch and the whole-record verbs bump.

Two consequences the CLI lives with:

- **`tag` / `link` / `perm` / `attach` report no version.** There is none to report, and
  printing the unchanged one would read as "this wrote at v4" rather than "v4 is where
  this record still is". They compare the record before and after instead, so a repeat
  says `already tagged` rather than claiming a write that did not happen.
- **`hstack commit` reports the version its own `mutate()` produced**, not a re-read after
  the tag and attachment reconcile. Those reconcile passes cannot move it.

### Optimistic concurrency

`hstack edit` records the record's `version` as `baseVersion`. `hstack commit` passes it as
`ifVersion`. If the record moved on the stack while you were editing — likelier here than
elsewhere because the window is a whole writing session — `mutate()` throws
`StackVersionConflictError { expectedVersion, actualVersion }`. The commit fails, the
working copy is left exactly as it is, and `hstack` prints the conflict plus how to see what
changed (`hstack show <id> --history`). Resolving it is manual: re-`hstack edit` a fresh copy
and reapply, or force past it with `hstack commit --force` (drops `ifVersion`,
last-writer-wins). Nothing is ever lost to a rejected write.

### Stale locks

An edit whose `record.md` is gone is _stale_. `hstack status` marks it rather than
treating it as active; `hstack edit` on a record with only a stale lock reclaims it;
`hstack discard --stale` sweeps every stale edit for the stack. Editor-process liveness is
_not_ a staleness signal — a detached GUI editor's launcher exits the moment it opens the
window, so a dead pid says nothing about whether the edit is still wanted.

---

## Schema-driven front matter

On `new` or `edit`, the CLI fetches the type (`stack.getType(typeId)`) and derives the
editing form from its schema.

```
---
id: 01hx3k9m2p7q          # readonly; blank on `new`
type: com.example/task@2
parentId: 01hx3k9m2p7q     # native field; ~ for none
tags: [work, urgent]       # reconciled as a set on commit
# dueDate: 2026-09-10      # optional field, scaffolded commented-out
title: Ship the CLI        # required field, scaffolded present
done: false
_readonly:
  version: 4
  createdAt: 2026-08-01T10:00:00Z
  updatedAt: 2026-09-01T09:00:00Z
  entityId: did:key:z6Mk…
  associations:            # shown for context; edited via `hstack link` / `hstack tag`
    - { kind: relationship, label: blocks, target: { scope: record, recordId: 01h… } }
  permissions:             # shown for context; edited via `hstack perm`
    - { kind: permission, label: read, grantee: { scope: entity, entityId: did:key:z6Mk… } }
    - { kind: anyone, label: read }
---
Body text goes here — the schema's one `text` field.
```

- **Every non-body field becomes a front-matter key.** `string`/`number`/`boolean`/
  `date`/`record-ref`/`file-ref` round-trip as YAML scalars; `array` and `object` fields
  as nested YAML.
- **Required fields are scaffolded present; optional fields commented-out.** Discoverable
  without being noisy — `hstack new --minimal` scaffolds only required fields, and
  `hstack edit` shows only fields that are set (plus `--all` to surface the rest).
- **`_readonly` is exactly that.** Associations, permissions, `version`, and authorship
  are shown so `record.md` is a faithful snapshot. `commit` compares the block against
  what `edit` rendered: an unchanged block is dropped from the write, a **present but
  altered** block is refused with a pointer to `hstack link` / `perm` / `tag`, and a
  block **deleted wholesale** is fine — removing the snapshot changes nothing.

### Which field is the body

In order:

1. Exactly one field of kind `text` — that is the body.
2. More than one — require `--body <field>`, or a per-type default in `config.toml`.
3. None — the record is front matter only, no body section.

This is the one convention the tool imposes on schemas it did not write. It holds for
every commons text type (`note`, `article`, `message`, `post`, `page` each have exactly
one `text` field) and degrades honestly rather than guessing. The body field's value
comes only from the body section, never a front-matter key of the same name. An **empty
body for a required text field** is treated as the omission it looks like — a
`the body is empty` error — even though core would accept `""`.

### Reserved front-matter keys

`id`, `type`, `parentId`, `tags`, and `_readonly` are the CLI's own front-matter keys. A
schema that declares a **content field** with one of these names (`tags` is the only
plausible one) can't round-trip through the file: scaffold and `show` skip it with a
`# note:` line, and `commit` leaves it untouched. Editing such a field needs the raw API.

### Validation on commit

The parsed front matter plus body is checked against the schema before any write —
mirroring core's own `validateContent` so the message names the field, working the same
local or remote. Core's write-path validation stays authoritative; this is the
pre-flight.

- required fields present (recursively, into `object` properties and `array` items).
- **a field the schema does not declare is rejected**, at every depth — matching core's
  own stance (a stray key is a typo, stale data, or a native field that landed in
  content by mistake). A field declared `open: true` is the deliberate exception: its
  interior is unvalidated, though it is still held to being the array or object the
  schema says it is, and field-name characters are still checked inside it.
- `date` fields against the ISO shape core pins (a regex, then `Date.parse` as a
  calendar check) — not bare `Date.parse`.
- `file-ref` against SHA-256 hex; scalar kind mismatches (`number` where a `string` was
  declared, …) by path.
- `array` / `object` structurally, recursively, with indexed paths (`emails[1].value`).
- reserved content keys (`__proto__`, `constructor`, `prototype`) and field names
  containing `. [ ] $ " * #` rejected, matching core.

A validation failure **re-opens the editor on the same buffer** with the errors
prepended as comments, rather than discarding the edit. The lock and working copy stay
put until a commit succeeds or you `hstack discard`.

---

## Associations — a hybrid split

Following git's plumbing/porcelain line: free text is a fine interface for content and
native scalars, and a bad one for a Crockford-32 record id or a DID. So the split is by
how typeable the value is, not by mechanism.

### In the front matter

- **`tags:`** — a YAML list, mapped to `tag` associations on commit and **reconciled as
  a set**: tags added to the list associate, tags removed dissociate. Cheap to type,
  cheap to diff.
- **`parentId`** — a native field, not an association; a plain scalar key.

### Through porcelain subcommands

Everything whose value is an opaque identifier or a discriminated union. Each noun's
subcommands are verb-first (`tag add <id> <label>`, not `tag <id> add <label>`) —
consistent with `stack add`/`types show` rather than the earlier sketch:

```
hstack tag   add|rm <id> <label>
hstack link  add|rm <id> --label <l> --to <target>
hstack perm  add|rm <id> --to <target> [--read] [--write]
hstack perm  ls <id>
hstack grant add|rm <typeId> --to <target> <action>...
hstack grant ls [--type <typeId>] [--to <target>]
```

Typing a discriminated union as YAML in a text file is precisely what a text editor is
bad at; a command with validation and, later, tab-completion is better even before any
picker exists. All three name their other end the same way — see **Naming a target**
below.

### Naming a target

`link`, `perm` and `grant` all take **`--to <target>`**, one grammar parsed in one place
(`src/target.ts`) and narrowed per command:

| `--to` value             | Resolves to                                             | Accepted by           |
| ------------------------ | ------------------------------------------------------- | --------------------- |
| `anyone`                 | `{ kind: 'anyone', label: 'read' }`                     | `perm`                |
| `authenticated`          | `{ kind: 'authenticated' }`                             | `grant`               |
| `did:key:z6Mk…`          | the entity arm — sugar for `entity:`                    | `perm` `grant` `link` |
| `entity:<did>`           | the entity arm                                          | `perm` `grant` `link` |
| `group:<id>/<role>`      | the group arm; `member`, `admin`, or `any` when listing | `perm` `grant`        |
| `record:<id>`            | `{ scope: 'record', recordId }`                         | `link`                |
| `record:<id>@<stackUrl>` | …in another stack                                       | `link`                |
| `external:<ns>/<id>`     | `{ scope: 'external', ns, id }`                         | `link`                |

**This vocabulary is the CLI's own, and deliberately wider than any single core union.**
Core keeps three apart on purpose — [a permission's grantee "is its own shape, not a
`RelationshipTarget`, which has no role and no group scope"][spec-perm], and `anyone` is
a kind rather than a grantee so no dropped field can produce world-read. That split is
right for the data model and wrong for a person, who is naming Alice either way. So the
CLI parses one grammar and each command narrows to the arms it accepts. The narrowing is
where core's distinctions are enforced; the grammar is where the human convenience lives.

[spec-perm]: https://github.com/haverstack/core/blob/main/docs/spec/access-control.md#record-level-permissions

Two rules keep the two from blurring:

**Every entry point returns one command's narrow type.** `parsePermissionTarget()`,
`parseGrantTarget()`, `parseGrantQuery()` and `parseLinkTarget()` are what the commands
and the package's consumers call; the wide union is module-private and never escapes.
The table above is therefore a type, not a convention — `parseLinkTarget()` cannot
return a grantee, because `RelationshipTarget` has nowhere to put one. A single shared
parser still backs all four, so there is one grammar to keep correct rather than four
that can drift.

**A target from the wrong tier is refused and told what to say instead**, never
converted. Mixing the tiers is the mistake with real consequences, so each command names
the confusion it actually expects:

| Written                              | Refused with                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `grant … --to anyone`                | a grant cannot reach anonymous requesters — did you mean `authenticated`?               |
| `perm … --to authenticated`          | a record permission has no authenticated tier; `anyone` is the nearest **and is wider** |
| `link … --to group:X/member`         | to link to the group's record, use `record:X`                                           |
| `perm`/`grant … --to record:X`       | to name a group, use `group:X/<member\|admin>`                                          |
| `link … --to anyone`/`authenticated` | an access tier is not something a record can point at                                   |

The asymmetry in the first two rows is deliberate. `anyone` is the **wider** tier — it
reaches anonymous requesters, `authenticated` reaches only DID holders — so `grant`
suggesting `authenticated` narrows and is safe to offer, while `perm` may not offer
`anyone` back as a synonym. It names it and says which way it moves, leaving the
widening a choice rather than an autocomplete.

Three rules keep the grammar honest:

- **Exactly one shape is inferred**: a leading `did:` is an entity. A DID is the one
  identifier every command takes, and `entity:did:key:…` reads badly on the most frequent
  call. Everything else names its scheme, and an unknown one is an error rather than a
  guess — core's `ExternalTarget` carries an explicit `ns` for the same reason.
- **`external:` nests its namespace** rather than sharing the top-level scheme slot.
  `ns` is open and user-chosen, so letting it compete with `group:`/`record:` would
  reserve words out of a namespace the CLI does not own.
- **`formatTarget()` is `parseTarget()`'s inverse**, so `perm ls` and `grant ls` print
  targets unelided in the same grammar their commands accept. A listing row is a command
  argument; copy-paste works, and the smoke test pins it.

The single seam is the point. `--pick` (below, deferred) resolves a partial filter to an
id and substitutes it into the invoking command — against three flag shapes that would be
three substitution paths and three sets of rules about which flag it may fill.

**`perm` writes one element at a time.** Record permissions are associations: the ACL is
two kinds over the same table — `{ kind: 'permission', label: 'read'|'write', grantee }`,
whose grantee is `{ scope: 'entity', entityId }` or `{ scope: 'group', groupId, role }`,
plus `{ kind: 'anyone', label: 'read' }` for world-read spelled affirmatively. Core's
`grantAccess(id, el)` / `revokeAccess(id, el)` add and withdraw exactly one, and `perm`
calls those rather than the `permissions` change-set key. The key replaces the whole set,
so between the read it would need and the write, whatever a second admin granted is gone;
a per-element write is the spelling that survives two people sharing one record at once.

An element's identity is its bit plus its grantee, and a role is **required** on a group —
member is the wider set, admin the narrower, and the two are different elements, so
`group:<id>` with no role is a parse error rather than a guess. `anyone` carries `read`
and nothing else; `--write` beside it is refused rather than written and then bounced by
core. `perm add --read --write` grants read first and `perm rm` withdraws write first,
because core's cross-element invariant is that **no write lands in a set whose grantee
cannot read it** — the CLI does not re-derive that rule, it just does not fight the one
ordering that satisfies it, and lets core's message teach the rest. `perm rm` naming
neither bit withdraws the target's access entirely; naming one withdraws just that one.
`perm ls` prints the whole ACL, which is otherwise only visible in `show --json` and the
`_readonly` block.

`grant` actions are core's `GrantAction` set — `create`, `read-own`, `read-any`,
`update-own`, `update-any`, `delete-own`, `delete-any`. Its `--to` is `authenticated`
(any entity holding a DID — the tier below `anyone`, which also reaches anonymous
requesters; the two never share a word), a DID, or a group at a role. `grant ls` takes
the same `--to` as a query, widened by the listing-only `group:<id>/any`; a DID listing
answers _coverage_ (grants naming them, their groups, and every authenticated grant), so
it is not a preview of what `grant rm` would withdraw. Core enforces the action dependency (a
`-any`/`-own` mutate action needs a matching-scope read action in the same grant) and
names the missing one in its own error; the CLI does not re-derive that rule client-side,
since a copy could disagree with the answer that actually governs the write. `revoke()`
returns what it withdrew, so `grant rm` reports a count rather than a silent success.
Grants are `_grant` records under the hood and work through either backend.

### Attachments — both ways

- **Files dropped in the working directory** become `attachment` associations on
  `commit`, label `embed` (the commons convention for files referenced from body text).
  This is the whole media workflow for an editing session: the working dir is already
  open in a file manager next to the editor. `hstack edit` downloads a record's existing
  embeds into the working dir first, so it's a faithful starting point either way.
- **`hstack attach add <id> --label <l> --file <p>`** / **`attach rm <id> --label <l>
--file-id <sha256>`** for attaching outside an edit session, or with a non-`embed`
  label. `add`'s mimeType is guessed from the extension (core's own
  `inferContentTypeFromFilename`, the same table a server uses when serving a download),
  falling back to `application/octet-stream`.

On commit, files in the working dir are reconciled against the record's current `embed`
attachments by **content, not filename**: a file's sha256 _is_ its fileId, so a file
already present as an embed is skipped outright — no re-upload, no wasted write. A new
hash is uploaded (`putAttachment`) and associated; an embedded hash no file in the
directory still holds is dissociated (never deleted — that is `collectAttachmentGarbage`'s
job, on its own grace period, not commit's). This runs for `new` as much as `edit`: a
file dropped into a not-yet-committed working directory is embedded on the record's first
write. A read or write failure on one file is a warning appended to the commit message,
never a blocked commit — the same posture `downloadEmbeds` already took.

The association also records `attachmentRecordId` — the specific `_attachment` record
`putAttachment()` just created — so a display name (in `_readonly`, and the filename
`downloadEmbeds` writes into the working dir) resolves through core's
`resolveReferencedAttachment()` rather than always picking the fileId's globally-earliest
upload. This matters because content is deduplicated but metadata isn't: two records can
reference byte-identical content uploaded under different filenames, and without this
each would show the other's name. Best-effort like everything else here — a stale or
missing pointer just falls back to the same resolution `resolveReferencedAttachment()`
already does with none.

### Reference-creation gating

Core gates reference creation on read access to the target: a `relationship` to a record
in this stack, a `parentId`, and an `attachment` association each require that the writer
can see what they point at. Against a server as a grantee this can fail at commit or at
`link`. The CLI does **not** reword that refusal — a missing target and an unreadable one
are deliberately indistinguishable (the anti-oracle property access-control.md documents:
telling them apart would let a grantee learn something a plain permission error does
not), so the honest thing is to show the same permission-denied message core already
gives, not to invent a more specific one the server never promised.

---

## Command surface

| Command                                                                      | Purpose                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `hstack stack add <name> (--url <u> [--expected-owner <did>] \| --path <p>)` | Create a profile; generate + store a key for a server profile                          |
| `hstack stack ls` / `hstack stack use <name>` / `hstack stack rm <name>`     | Manage profiles and the default                                                        |
| `hstack types`                                                               | List registered types (id, name, schemaHash)                                           |
| `hstack types show <typeId>`                                                 | Print a type's schema                                                                  |
| `hstack types define <schema.json>`                                          | Register a type from `{ id, name, schema, migratesFrom? }`                             |
| `hstack ls <typeId> \| --base <baseId>`                                      | List records of a type — `--parent <id>`/`--root`, `--tag <l>`…, `--limit N`           |
| `hstack show <id>`                                                           | Print a record — `--history` for version history                                       |
| `hstack new <typeId>`                                                        | Scaffold and open a new record — `--parent`, `--id`, `--minimal`, `--body <field>`     |
| `hstack edit <id>`                                                           | Open an existing record — `--all`, `--body <field>`, `-c`/`--commit`                   |
| `hstack status`                                                              | List open edits for the active profile                                                 |
| `hstack commit [<id>]`                                                       | Validate and write back — `--force` to drop the `ifVersion` fence                      |
| `hstack discard [<id>]`                                                      | Abandon a working copy — `--stale` to sweep stale locks                                |
| `hstack rm <id>`                                                             | Soft-delete — `--hard` to purge (owner-only on a server), reporting what it referenced |
| `hstack restore <id>`                                                        | Undelete                                                                               |
| `hstack versions <id>`                                                       | Version history                                                                        |
| `hstack tag add\|rm <id> <label>`                                            | Add or remove a tag                                                                    |
| `hstack link add\|rm <id> --label <l> (...)`                                 | Add or remove a relationship (above)                                                   |
| `hstack perm add\|rm <id> (...)` / `hstack perm ls <id>`                     | Grant or withdraw one element of a record's ACL; list the whole of it (above)          |
| `hstack grant add\|rm <typeId> (...) <action>...` / `hstack grant ls`        | Type-level grants (above)                                                              |
| `hstack attach add\|rm <id> --label <l> (...)`                               | Attach or detach a file outside an edit session (above)                                |

Every read command takes `--json`. Every listing command **loops the cursor to
exhaustion** or honours an explicit `--limit` — `cursor === null` is the only
end-of-results signal, an empty page is not the end, and `total` is `null` through a
server, so there is no count to check against. A command that returned one page and
implied it was the whole set would be a truncation bug.

---

## Types

**The CLI defines none.** It reads `GET /types` (or the local equivalent) and works with
whatever it finds. `hstack types define` registers a type from a schema file — the way a
stack gets bootstrapped without writing code — calling `stack.defineType(id, name,
schema, { migratesFrom })`.

Registering an identical schema (same `schemaHash` and `name`) returns before any write,
so re-running a define script is cheap. An illegal schema change on an existing `id`
throws `StackSchemaDriftError`; the CLI does not catch it or re-derive its own message —
core's already names every violation and states the remedy (a new version, `…@n+1`, plus,
in app code, a migration) — so it propagates verbatim rather than the CLI making the user
go read about drift. Additive-in-place evolution (new optional fields only) is accepted
without a version bump, matching core.

Migration _functions_ stay out of scope: `registerMigration` takes a JS closure, and
`commitMigration` / `migrateAll` are owner-acting-alone operations best driven from the
owning app.

---

## Deferred

- **`--pick` for association targets.** A short fuzzy-selector (backed by `stack.query()`)
  that resolves a partial filter to an id and substitutes it into the invoking `link` /
  `perm` / `grant` command's `--to`. Additive — it fills one slot with a string the
  grammar already accepts — and the natural place to grow toward a fuller interactive
  mode if flags prove clunky. Not a v1 blocker;
  revisit once it's clear which commands get used with unfamiliar ids often enough.
- **Watch / live status.** The CLI reads and writes on demand; a `hstack watch` over
  `stack.subscribe` (server only — `LocalAdapter` has no `subscribeChanges`) is possible
  but out of scope for an editing tool.
- **Deep nested-object editing.** YAML front matter is fine for a menu's item list and
  unpleasant for anything deeper. The ceiling is worth knowing before promising every
  schema edits equally well; a `$EDITOR`-on-a-JSON-fragment escape hatch for one field
  is the likely answer if it bites.
- **Bulk operations.** `hstack rm` / `hstack tag` over a query result. Scriptable today via
  `hstack ls --json | jq | xargs`; a native `--from-stdin` is a convenience, not a
  capability.

---

## Testing approach

The package's own tests use `MemoryAdapter` for speed and a temp `LocalAdapter` file
where adapter-specific behavior matters; `tests/server-integration.test.ts` runs the
same commands against a real, listening `@haverstack/server` instance for the
server-only paths (permission refusals, `includeUnlisted`, `ifVersion` conflicts).
`scripts/smoke.mjs` spawns the actual built `dist/cli.js` binary end to end, so a
packaging or argv-parsing mistake the in-process suite can't see still fails CI.
