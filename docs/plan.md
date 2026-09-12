# `@haverstack/cli` — build plan

Phased plan for building the CLI described in [`design.md`](./design.md). Each phase is a
shippable slice with its own tests. Progress notes go at the bottom of each phase as work
lands, the way `@haverstack/eleventy` tracked its phases.

Conventions (from core's `AGENTS.md`, which this repo follows): build before typecheck;
a changeset per shipping change; comments answer _why_, ≤5 lines, no issue refs in code;
no back-compat shims — there is no install base. Before pushing, run `format:check`,
`lint`, `test`, `build`, `typecheck`.

---

## Phase 0 — scaffold ✅

Mirror `@haverstack/eleventy`'s toolchain.

- [x] `package.json`: `@haverstack/cli`, `"type": "module"`,
      `bin: { haverstack, hstack }`, `engines.node >= 22`, MIT, `files: ["dist"]`.
      Also a minimal `exports` for programmatic use from the sandbox/tests.
- [x] Deps: `@haverstack/core@^0.26`, `@haverstack/adapter-local@^0.25`,
      `@haverstack/adapter-api@^0.25`, `commander@^15`. `yaml` / TOML libs deferred to
      the phase that first imports them (Phase 1/3) to avoid unused-dep noise.
- [x] `tsconfig.json` / `tsconfig.build.json` / flat `eslint.config.mjs` /
      `.prettierrc` / `.prettierignore` / `vitest.config.ts` — copied from eleventy.
      (No `skipLibCheck` needed; the published `@haverstack/*` types are clean here.)
- [x] `.changeset/config.json` + `README.md`, `.github/workflows/ci.yml` (five checks),
      `.github/workflows/release.yml` (changesets + OIDC), `AGENTS.md`.
- [x] `pnpm-workspace.yaml` — `allowBuilds: esbuild`, `minimumReleaseAgeExclude` for the
      six transitive `@haverstack/*` packages.
- [x] `src/cli.ts` (shebang + `--help` with the planned command groups), `src/openStack.ts`
      (Phase 0: local `.db` path only; URL/profile targets throw a clear "later"),
      `src/commands/types.ts` (`collectTypes` + `formatTypes`), `src/index.ts`.
      `hstack types --stack <path>` and `$HAVERSTACK_STACK` both verified end-to-end.
- [x] `~/Dev/haverstack/cli-example/`: own git repo (local only), `@haverstack/cli` via
      `link:../cli`, `scripts/seed.ts` → `.stack/stack.db` (commons types + an invented
      `com.example.cli/recipe@1` + ~13 records: tagged, nested, unlisted, soft-deleted).
      `pnpm seed` / `pnpm types` / `pnpm reseed`.

All five checks green. `smol-toml` arrives in Phase 1; `yaml` in Phase 2;
`@napi-rs/keyring` (and its `allowBuilds` entry) with the deferred keychain backend.

## Phase 1 — connection, config, key custody ✅

- [x] `src/config.ts` — `config.toml` load/save via `smol-toml`. `Profile` = `url`|`path`,
      `did`, `key`, `expectedOwner`, `body`; top level `default`, `editor`, `explorer`.
      Comments are not preserved across a rewrite (machine-managed file).
- [x] `src/paths.ts` — XDG `config`/`state`/`data` dirs, env read on every call so tests
      point them at a scratch dir. Created on demand (`keys/` as `0700`).
- [x] `src/openStack.ts` — `openStack({ target })`: resolves `--stack` → `$HAVERSTACK_STACK`
      → `config.default`; a path opens `LocalAdapter`, a URL / a `url` profile opens
      `APIAdapter.open({ url, credential, expectedOwner })`, a bare word is a profile
      name. Returns `{ stack, target, mode, did, close }`; `computeMode` = `owner` iff the
      authenticated DID is the reported owner, else `grantee`; local is `unscoped`.
- [x] `src/keys.ts` — `generateAndStoreKey` writes a `0600` `<profile>.jwk.json`;
      `loadSigner` re-imports it and returns `p => signWithDid(key, p)`. **OS keychain
      deferred** — `key` field already carries the indirection (`"keychain"` sentinel
      reserved, `loadSigner` throws a clear "not built yet" on it). `@napi-rs/keyring` + its `allowBuilds` entry land with that increment, not now.
- [x] `src/commands/stack.ts` + `src/cli.ts` — `hstack stack add|ls|use|rm`. `add --url`
      generates the key and prints the DID to grant; `add --path` stores an absolute
      path; first profile becomes the default. `rm` leaves the key file, says where.
- [x] `src/banner.ts` — `formatBanner` → `→ <target>  [<mode>]`, printed to **stderr** by
      any command that opens a stack (so `--json` on stdout stays clean).

Deferred to a follow-up increment (additive, no schema/flow change): OS-keychain key
backend; `--as <profile>` to borrow an identity for a one-off URL connection. All five
checks green. Deps: `+ smol-toml`.

## Phase 2 — read commands ✅

- [x] `src/commands/types.ts` — `types` list + `types show <typeId>` (`--json`), the
      latter with a `formatSchema` field table (kinds, `required`, nested `object`/`array`).
- [x] `src/commands/records.ts` — `hstack ls [typeId]` / `--base`, `--parent`/`--root`,
      repeatable `--tag`, `--limit`, `--json`. Type column dropped when one exact type is
      pinned. Soft-deleted rows show `(deleted)`; unlisted/deleted excluded by default.
- [x] `src/paginate.ts` — `queryAll(stack, query, limit?)`: `do/while` on `cursor`,
      `null` is the only stop, `limit` slices. Used by `ls`, reused later.
- [x] `src/commands/records.ts` — `hstack show <id>` (`--json`, `--history` appends the
      version table) and `hstack versions <id>` (`--json`). `getVersions` returns only
      _prior_ snapshots, so "at vN with no prior versions" is the fresh-record message.
- [x] `src/record/format.ts` — `renderRecord(record, type?)` → `record.md` text (YAML
      front matter via `yaml`, `_readonly` block, body = the one `text` field via
      `bodyFieldOf`), `summarize` for listings, `formatSchema` / `fieldKindLabel`. This
      is the faithful-render half; `scaffold` + `parse` + validation are Phase 3.

Dep `+ yaml` (needed now for front-matter emission; also Phase 3's parser). Banner prints
to stderr from every stack-opening command. All five checks green.

## Phase 3 — schema ↔ file codec ✅

Pure functions, no I/O. All in `src/record/`.

- [x] `scaffold.ts` — `scaffoldRecord(type, { id, parentId, bodyField, minimal })` →
      `record.md`: `type` + `tags: []` + required fields present, optional fields
      commented out, each line hint-labelled with its kind; required nested objects
      expand one level. Body section only when the type has a body field. No `_readonly`
      on a new record.
- [x] `format.ts` — `renderRecord` gained `{ all }` to list unset optional fields
      commented out (spliced in before `_readonly:`). `RESERVED_FRONT_MATTER_KEYS`
      (`id`/`type`/`parentId`/`tags`/`_readonly`) — a colliding content field is skipped
      with a `# note:` in scaffold and dropped in render.
- [x] `parse.ts` — `parseRecord(text, type, opts)` with opts `bodyField` / `expectId` /
      `expectType` / `readonlyBaseline`. Returns the pieces a write needs, or throws
      `RecordParseError` with `{ path, message }[]`. Body-field value comes only from the
      body section; an empty body for a required text field is an error. `~`/blank
      `parentId` → `null`. `_readonly` diff-guard against a supplied baseline.
- [x] `validate.ts` — `validateAgainstSchema(content, schema)`: mirrors core's
      `validateContent` (core doesn't export it) — required-missing, ISO date, 64-hex
      file-ref, scalar-kind, array/object recursion with indexed paths, reserved keys,
      field-name metacharacters. Core's write path stays authoritative.
- [x] Tests: `record-scaffold`, `record-parse` (incl. a round-trip over every commons
      type + nested `object`/`array` fixtures), `record-validate`, `--all`.

Dep `+ @haverstack/commons` (devDependency, for the round-trip test) + its workspace
release-age exclude. `hstack new`/`edit`/`commit` wire this in at Phase 4.

## Phase 4 — editing model ✅

- [x] `src/edit/lock.ts` — `edits/<sha256(stackTarget).slice(0,12)>/<recordId>/` with
      `record.md` + `.hstack-lock.json` (`recordId`, `typeId`, `mode`, `bodyField`,
      `baseVersion?`, `readonly?`, `startedAt`, `stack`). Per-record; `acquireEdit`
      refuses a live one (`EditInProgressError`), reclaims a stale one; `listEdits` /
      `resolveEdit` / `releaseEdit`. **No `editorPid`** — a detached GUI launcher exits
      at once, so pid-liveness is not a staleness signal; stale = `record.md` gone.
- [x] `src/edit/editor.ts` — `resolveEditorCommand` (`config.editor` → `$VISUAL` →
      `$EDITOR` → `''`), `launchEditor(cmd, file, wait)` (detached + `unref`, or
      `spawnSync` for `-c`), `launchExplorer` (best-effort `xdg-open`/`open`/`explorer`).
- [x] `src/edit/attachments.ts` — `downloadEmbeds` copies `embed` attachments into the
      dir (filename from the earliest `_attachment@1`, collision-suffixed), best-effort.
- [x] `src/commands/edit.ts` — `newRecord` (mints the id with `generateId`, scaffolds,
      `mode:"new"`), `editRecord` (renders, snapshots `version` + `_readonly`,
      `mode:"edit"`, downloads embeds), `editStatus`, `discardEdit` (`--stale`), and
      `commitEdit`:
  - parse fail → prepend `# ✗ …` notes, return `reopen` (CLI relaunches the editor),
    keep the dir. Next parse strips a leading blank/`#` block (regex widened in
    `parse.ts`).
  - `new` → `create({ id, parentId })` + associate tags. `edit` → `mutate({ contentPatch,
parentId })` (a removed content line → `null`, reserved keys skipped) under
    `ifVersion: baseVersion` unless `--force`, then tag set-reconcile.
  - conflict / dup-id / validation / bad-or-missing-parent matched by error **`code`**
    (not `instanceof` — a linked dev tree can load two `@haverstack/core` copies);
    working copy always kept on any recognized failure.
  - `parentId` change on `edit` moves the record in the same write (see the dependency
    bump note below — this was a refusal until core made moving possible).
- [x] `src/commands/records.ts` — `removeRecord` (`--hard`), `restoreRecord`.
- [x] `src/cli.ts` — `new`, `edit`, `status`, `commit`, `discard`, `rm`, `restore`
      wired; `afterStart` does the editor/explorer launch (or the `-c` commit).
- [x] Tests: `edit-lock`, `edit-editor`, `edit-commit`. Dogfooded end-to-end via the
      binary with a scripted `$EDITOR` (new -c, detached edit, status, commit, the
      reopen-on-error loop, rm/restore, empty-commit errors).

**Dependency bump (2026-09-11): core/adapter-local/adapter-api 0.26→0.31/0.30/0.30,
commons 0.20→0.25.** `update()`/`setPermissions()`/`setUnlisted()`/`setParent()` are gone
from `@haverstack/core` — `mutate(id, changes, opts)` replaces all four (one change set,
one version), with `patchContent(id, patch, opts)` as the content-only spelling. Landed:

- `commitEdit`'s edit path now calls `mutate({ contentPatch, parentId }, { ifVersion })`
  instead of `update()`. **`parentId` is movable again** — core added `setParent()` then
  folded it into `mutate()` — so the CLI no longer refuses a changed `parentId`; core
  checks the destination exists and isn't a cycle, surfaced as an ordinary kept-copy
  failure (matched by `code`, same as any other write refusal) if either is wrong.
- `renderRecord` always shows `tags:` (even `[]`) and, on a root record, a commented
  `# parentId:` hint — a root's buffer previously had no live `parentId` line to edit,
  which would have made moving a record a capability with no way to discover it from
  the file.
- **Behavior change upstream: an undeclared content field is now rejected**, at every
  depth, unless the field is declared `open: true` (a new schema shape whose interior is
  unvalidated but which is still held to being an object/array). `record/validate.ts`
  mirrors both: `walkSchema` flags any content key the schema doesn't declare, and
  `checkField` skips recursing into an `open` field while still checking it's the right
  container kind. `formatSchema`/`fieldKindLabel`/`scaffoldRecord` render `open` fields
  as `array<open>`/`object<open>`, one leaf line, no expansion.
- Test-file `stack.update()` calls → `stack.patchContent()`. `cli-example`'s
  `scripts/seed.ts` (`setUnlisted` → `mutate({ unlisted: true })`) and
  `scripts/exercise-{codec,edit}.ts` updated and bumped the same way; `exercise-edit.ts`
  gained a "move to a new parent in the same commit" scenario. Both dogfood scripts and
  the full test suite verified green against the bumped versions; the binary was
  separately re-verified end to end (edit shows the hint → hand-edit `parentId:` →
  `commit` moves the record).
- `total` (removed from `QueryResult` in core 0.27) needed no change — `queryAll` never
  read it.

## Phase 5 — relational porcelain ✅

Verb-first subcommands throughout (`tag add <id> <label>`, matching `stack add`/`types
show` rather than the sketch's `tag <id> add <label>`).

- [x] `src/commands/associations.ts` — `tagAdd`/`tagRemove` (`stack.associate`/
      `dissociate`, idempotent, pre-checked against `stack.get` for a consistent "No
      record" message). `buildRelationshipTarget` builds core's `RelationshipTarget`
      union from `--to-record` (`+ --stack-url`) / `--to-entity` / a pair of flags,
      `--to-external <ns>` plus `--external-id <id>` — two flags rather than one taking
      two values, since commander has no clean way to parse `<ns> <id>` off one option.
      `linkAdd`/`linkRemove` wrap associate/dissociate with it. `rm` takes the same
      target flags `add` did, since `dissociate()` matches a target exactly.
- [x] `src/commands/access.ts` — `permAdd`/`permRemove`: an entry is keyed by `public` /
      `entity:<did>` / `group:<id>:<role|member>`; `add` reads the record's
      `Permission[]`, **merges** access bits into a matching entry (OR, never resets),
      and writes back via `mutate({ permissions })` (`setPermissions()` is gone — see
      the dependency-bump note above); `rm` **narrows** a named bit or drops the whole
      entry once neither bit survives. `grantAdd`/`grantRemove`/`grantList` wrap
      `stack.grant`/`revoke`/`listGrants` directly — **no client-side dependency
      check**: core's `checkGrantsValid` already enforces "a `-any`/`-own` mutate action
      needs a matching-scope read action in the same grant" and names the missing one,
      so duplicating it client-side would risk disagreeing with the answer that
      actually governs the write. Same reasoning applies to `perm`'s own
      write-requires-read rule, also left to core.
- [x] **Dropped**: reference-creation-gating error rewording. The refusal for an
      unreadable vs. a missing target is deliberately indistinguishable (the anti-oracle
      property core documents) — inventing a more specific CLI message would leak
      exactly the distinction the server declines to make. The plain permission error
      core/the server already returns is the honest answer.
- [x] `cli.ts` wires `tag add|rm`, `link add|rm`, `perm add|rm`, `grant add|rm|ls`.
- [x] Tests: `associations`, `access` (incl. merge/narrow semantics and core's grant- and
      permission-dependency errors surfacing unmodified). The sandbox's
      `scripts/exercise-relations.ts` (`pnpm exercise:relations`) dogfoods all four
      against a real `LocalAdapter` stack; the binary was separately checked end to end.

## Phase 6 — attachments ✅

- [x] `src/commands/attach.ts` — `attachAdd`/`attachRemove` (verb-first, matching Phase
      5): `add <id> --label <l> --file <p>` reads the file, guesses its mimeType via
      core/wire's `inferContentTypeFromFilename` (falling back to
      `application/octet-stream`), `putAttachment`s it, and `associate`s the result;
      `rm <id> --label <l> --file-id <sha>` dissociates by the exact `(label, fileId)`
      pair `dissociate()` needs.
- [x] `src/edit/attachments.ts` gained `reconcileAttachments(stack, id, dir)`: hashes
      every file in the working dir (excluding `record.md`/the lock — now
      `RESERVED_WORKING_FILES`, exported from `lock.ts`) with sha256 — the fileId itself,
      so a file already present as an `embed` is skipped outright, no re-upload. A new
      hash is uploaded + associated; an embedded hash no file still holds is dissociated
      (never deletes bytes — `collectAttachmentGarbage` owns that, separately). A
      read/upload/associate failure on one file is a warning, never a blocked commit.
      `downloadEmbeds` (Phase 4) refactored onto core's `getAttachmentRecords(fileId)`
      (added upstream since Phase 4, already earliest-first) in place of a hand-rolled
      `queryAll` + sort.
- [x] `commitEdit` calls `reconcileAttachments` after tag reconcile, for **both** `new`
      and `edit` — a file dropped before the first commit is embedded on the record's
      first write, not just on a later edit. Fixed along the way: the `new` branch's
      reported version was stale whenever the embed write actually landed (it only
      re-fetched on a warning); now it always re-fetches, matching the `edit` branch.
- [x] `cli.ts` wires `attach add|rm`.
- [x] Tests: `attachments` (`downloadEmbeds`/`reconcileAttachments` incl. mime inference,
      content-addressed no-op, dissociate-on-removal, unrelated-association isolation,
      unreadable-file-as-warning), `attach` (the command layer), plus two `edit-commit`
      cases proving the working-dir path end to end. The sandbox's
      `scripts/exercise-attach.ts` (`pnpm exercise:attach`) dogfoods the full lifecycle
      against a real `LocalAdapter` stack; the binary was separately checked end to end
      (a scripted editor that both edits `record.md` and drops a file, `edit` downloading
      it back, deleting it and re-committing to dissociate).

## Phase 7 — type registration ✅

- [x] `src/commands/types.ts` gained `typesDefine(stack, filePath)`: reads
      `{ id, name, schema, migratesFrom? }` from a JSON file, pre-validates its shape
      (non-empty string `id`/`name`, object `schema`, optional string `migratesFrom`) so a
      malformed file names the exact field rather than failing deeper in `defineType`, then
      calls `stack.defineType`. Compares `getType(id)` before and after the call to report
      which of four outcomes happened: brand-new registration, an idempotent no-op
      (identical schemaHash + name), a name-only rename (identical schemaHash), or a legal
      additive-in-place extension (new hash, no drift). `StackSchemaDriftError` is not
      caught — core's own message already lists every violation and states the
      version-bump remedy with a concrete `defineType(...)` example, so the CLI adds
      nothing and lets it propagate to `cli.ts`'s top-level handler.
- [x] `cli.ts` wires `types define <schemaFile>` alongside the existing `types show`.
- [x] Tests cover fresh registration, `migratesFrom` propagation, the idempotent/rename/
      additive-evolution paths, verbatim drift-error surfacing (remedy text included), and
      each malformed-input rejection. All checks green. The sandbox's
      `scripts/exercise-typesdefine.ts` (`pnpm exercise:typesdefine`) dogfoods all four
      outcomes plus the drift error against a real `LocalAdapter` stack; the binary was
      separately checked end to end against the seeded sandbox stack, then `pnpm reseed`
      restored it.

## Phase 8 — integration, docs, release

- [ ] Integration tests: full `new → edit → commit → link → rm → restore` against a temp
      `LocalAdapter` file and against `MemoryAdapter`.
- [ ] Server-path tests against a spun-up `@haverstack/server` (owner and grantee
      sessions): permission refusals, `includeUnlisted` denial, `ifVersion` conflicts.
- [ ] `README.md`: install, `hstack stack add`, the editing loop, `--json` recipes.
- [ ] `cli-example/` smoke-test script exercised in CI.
- [ ] First changeset; `0.1.0`.

---

## Open questions to resolve as we build

- **Keychain dependency choice** — `keytar` is unmaintained; `@napi-rs/keyring` is the
  current pick. Confirm it builds on the three platforms in CI, else ship JWK-only for
  `0.1` and add the keychain later.
- **`hstack edit` on a record whose type has multiple `text` fields** — `--body` each time
  is tedious; the per-type `config.toml` override covers a stack you use often. Good
  enough for v1?
- **Detached editor on a headless box** — no file manager, and a detached GUI editor
  makes no sense over SSH. `explorer = false` + `-c` covers it, but maybe detect no
  `$DISPLAY`/`$WAYLAND_DISPLAY` and default to `-c` behaviour.
- **`_readonly` block noise** — a faithful snapshot is useful but long on a record with
  many associations. A `--no-readonly` flag, or fold it to a `# 3 associations, 1
permission — hstack show <id> to see` summary line?
