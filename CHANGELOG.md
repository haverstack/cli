# @haverstack/cli

## 0.4.0

### Minor Changes

- [#4](https://github.com/haverstack/cli/pull/4) [`6fb20b3`](https://github.com/haverstack/cli/commit/6fb20b3a0ffc66be8ac7622ed22bbcdd1131618f) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Adopt core 0.37: record permissions are associations, and six operations no longer bump a version
  
  **`Permission[]` is gone.** A record's ACL is two association kinds over the same table —
  `{ kind: 'permission', label: 'read' | 'write', grantee }` and `{ kind: 'anyone', label:
  'read' }` — with `grantAccess()` / `revokeAccess()` adding and withdrawing exactly one
  element. `hstack perm` follows: it no longer reads the whole list, edits an entry and
  writes the array back, a read-modify-write that silently discarded whatever a second
  admin granted in between.
  
  The flags move with the model. `--public` becomes `--anyone`, which carries `read` alone
  (`--write` beside it is refused rather than written and bounced). `--group` now requires
  `--role member` or `--role admin`, because member and admin are two different elements and
  neither is a safe guess. `perm rm` naming neither `--read` nor `--write` withdraws the
  target's access entirely; naming one withdraws just that one. `perm add --read --write`
  grants read first and `perm rm` withdraws write first, which is the one ordering that
  satisfies core's rule that no write lands in a set whose grantee cannot read it. New:
  `hstack perm ls <id>` prints the whole ACL.
  
  `hstack grant`'s target is core's required `GrantGrantee` union: `--default` becomes
  `--authenticated` (any entity holding a DID — a tier below `--anyone`, which also reaches
  anonymous requesters), and `--group` takes `--role`. `grant ls` accepts the same flags as
  a query, widened by the listing-only `--role any`, and `grant rm` reports how many grants
  it withdrew now that `revoke()` returns them.
  
  **`associate`, `dissociate`, `permissions`, `reparent`, `unlist` and `list` are no-bump**:
  they leave `version` and `updatedAt` exactly where they stand. `tag`, `link`, `perm` and
  `attach` therefore stop printing a version that did not move, and compare the record
  before and after instead — a repeat now says `already tagged` rather than claiming a write
  that did not happen. `hstack commit` reports the version its own `mutate()` produced,
  since the tag and attachment reconcile that follow cannot move it.
  
  Also: `hstack rm --hard` reports the files the purged record referenced (core's
  `delete()` returns them, because destroying the record destroys the only rows naming
  them), and `hstack attach add` records an `attachmentRecordId` so a filename resolves to
  the upload that reference came from.
  
  **Not backwards compatible.** The SQLite schema is create-if-missing with no migrations,
  so a database written before core 0.37 keeps its old tables and fails on the first
  permission write. Existing stacks must be recreated.

- [#4](https://github.com/haverstack/cli/pull/4) [`b5e514e`](https://github.com/haverstack/cli/commit/b5e514e178874c597f6930451e740d3351ad1dbe) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Name every association target the same way: one `--to`, parsed once, narrowed per command
  
  `link`, `perm` and `grant` each had their own way of spelling the other end — ten flags
  between them (`--to-record`, `--stack-url`, `--to-entity`, `--to-external`,
  `--external-id`, `--anyone`, `--entity`, `--group`, `--role`, `--authenticated`), three
  sets of "exactly one of" rules, and three shapes for what is, to the person typing, one
  idea. They now share `--to <target>`:
  
  ```
  anyone                     the world, anonymous requesters included   (perm)
  authenticated              any entity holding a DID                   (grant)
  did:key:z6Mk…              an identity                                (all three)
  group:<id>/<member|admin>  a group's roster at one role               (perm, grant)
  record:<id>[@<stackUrl>]   a record, here or in another stack         (link)
  external:<ns>/<id>         something outside any stack                (link)
  ```
  
  The vocabulary is the CLI's own and deliberately wider than any single core union. Core
  keeps three apart on purpose — a `RelationshipTarget` names no role, a
  `PermissionGrantee` has no record scope, and `anyone` is a kind rather than a grantee —
  and that split is right for the data model and wrong for a person, who is naming Alice
  either way. So one grammar parses, and each command narrows to the arms it accepts,
  refusing the rest by name. The narrowing is where core's distinctions are enforced.
  
  Exactly one shape is inferred: a leading `did:` is an entity, because a DID is the one
  identifier every command takes and `entity:did:key:…` reads badly on the most frequent
  call. Everything else names its scheme, and an unknown one is an error rather than a
  fallback. `external:` nests its namespace rather than sharing the top-level scheme slot,
  since `ns` is open and user-chosen — letting it compete with `group:`/`record:` would
  reserve words out of a namespace the CLI does not own.
  
  `formatTarget()` is `parseTarget()`'s inverse, so `perm ls` and `grant ls` now print
  targets unelided in the grammar their own commands accept: a listing row is a command
  argument. `grant ls --role any` becomes `--to group:<id>/any`, which also puts the
  listing widening and the world-read tier in structurally different slots instead of one
  letter apart.
  
  The single seam is the point. The deferred `--pick` selector resolves a filter to an id
  and substitutes it into the invoking command; against three flag shapes that would have
  been three substitution paths.
  
  Every entry point hands back one command's own narrow type —
  `parsePermissionTarget()`, `parseGrantTarget()`, `parseGrantQuery()` and
  `parseLinkTarget()`, returning core's `PermissionGrantee`, `GrantGrantee`, `GrantQuery`
  and `RelationshipTarget`. The wide union is module-private and never escapes, so the
  per-command table is enforced by the type system rather than by remembering to call a
  narrowing step. One shared parser still backs all four: one grammar to keep correct
  rather than four that can drift.
  
  A target from the wrong tier is refused and told what to say instead, never converted.
  `grant --to anyone` is pointed at `authenticated`; `link --to group:X/member` at
  `record:X`; `perm`/`grant --to record:X` at `group:X/<role>`. The one asymmetry is
  deliberate: `perm --to authenticated` is _not_ offered `anyone` as a synonym, because
  `anyone` is the wider tier — it names it and says so, leaving the widening a choice.
  
  `buildRelationshipTarget` and the `PermTargetOptions` / `GrantTargetOptions` /
  `LinkTargetOptions` types are gone — the target is a string now.

## 0.3.0

### Minor Changes

- [`4ee536b`](https://github.com/haverstack/cli/commit/4ee536b7d85f616f1b3867415272f84568d99c96) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Attachment associations now name the specific upload they came from
  (`attachmentRecordId`, added in `@haverstack/core@0.32.0`), fixing a real bug: two
  records referencing byte-identical content uploaded under different filenames used to
  both show whichever name was uploaded first, everywhere — in `hstack edit`'s downloaded
  working-dir filename and in `_readonly`'s attachment associations (which now also show a
  resolved `filename` for the first time). Each record now correctly shows its own name.
  Requires `@haverstack/core@^0.32.0` and `adapter-local`/`adapter-api@^0.31.0`.

## 0.2.0

### Minor Changes

- [`29924dd`](https://github.com/haverstack/cli/commit/29924dd5fe409c40ed494308f9c936889fce08ed) Thanks [@cuibonobo](https://github.com/cuibonobo)! - `--explorer`/`config.toml`'s `explorer = true` now open the file manager _before_ the
  editor, not after — previously, with a blocking (`-c`, or an auto-waited terminal)
  editor, the folder didn't appear until you'd already closed the editor you wanted it
  open alongside. Also fixes `-c`/`--commit` never opening it at all.

- [`5c1c95e`](https://github.com/haverstack/cli/commit/5c1c95e6ac9d57a8b80860d1580b95144a37daa8) Thanks [@cuibonobo](https://github.com/cuibonobo)! - `hstack new`/`hstack edit` gained `--explorer`, opening a file manager on the working
  directory for just that call (e.g. to drop an attachment before committing). Replaces
  `--no-explorer`, which negated a default that was already off unless `config.toml` set
  `explorer = true` — there was no way to ask for the folder without setting that
  persistently.

- [`9f42543`](https://github.com/haverstack/cli/commit/9f42543e69466761c56c7b797424cff634963e7a) Thanks [@cuibonobo](https://github.com/cuibonobo)! - `hstack new`/`hstack edit` now wait for a terminal editor (`nano`, `vim`, ...) to exit
  before returning, so it actually gets a controlling terminal to run in — previously it
  was launched detached like a GUI editor and silently did nothing. The wait only happens
  when `hstack` itself has a real terminal attached, so a script or agent driving it as a
  subprocess is unaffected either way. Waiting does not commit; that stays `-c`/`--commit`'s
  job. Added `--wait`/`--no-wait` to override the guess explicitly in either direction.

## 0.1.0

### Minor Changes

- [`4f171fe`](https://github.com/haverstack/cli/commit/4f171fec47dee64ff5c47da0007b4cfcb985855b) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Initial release: `hstack`/`haverstack`, a type-agnostic terminal tool for editing a
  Haverstack stack. Connect to a local SQLite file or a remote stack server; scaffold,
  edit, and validate records against their type's schema in your own editor; manage
  tags, relationships, permissions, type-level grants, and attachments; register new
  types from a schema file.
