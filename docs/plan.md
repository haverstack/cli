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

All five checks green (8 tests). `yaml` + a TOML parser (`smol-toml`) and
`@napi-rs/keyring` land in Phase 1 when first imported; add `@napi-rs/keyring` to
`allowBuilds` then.

## Phase 1 — connection, config, key custody

- [ ] `config.toml` load/save: profiles (`url`|`path`, `did`, `key`, `expectedOwner`,
      per-type `body` overrides), `default`, `editor`, `explorer`.
- [ ] XDG path resolution (`config` / `state` / `data`), created on demand.
- [ ] `openStack(target)`: profile name | bare path | `https://` URL →
      `LocalAdapter.open` or `APIAdapter.open({ url, credential, expectedOwner })` →
      `Stack.create`. Returns `{ stack, mode: "owner" | "grantee" | "unscoped" }` (mode
      from comparing the session DID to the discovered owner).
- [ ] Key custody: `generateDidKeypair` on `hstack stack add --url`; store via OS keychain
      (optional dep, lazy) else `0600` JWK under the keys dir; load → `DidCredential`
      (`didCredentialFromKeypair` in-process, or a keychain-backed `sign`).
- [ ] `hstack stack add | ls | use | rm`. `add --url` prints the DID to grant.
- [ ] Banner: active target + mode, printed by write commands.

## Phase 2 — read commands

- [ ] `hstack types`, `hstack types show <typeId>` (`--json`).
- [ ] `hstack ls <typeId> | --base <baseId>` with `--parent`/`--root`, `--tag`…,
      `--limit`, `--json`. Cursor loop to exhaustion; never stop on an empty page.
- [ ] `hstack show <id>` (`--json`, `--history` → `getVersions`).
- [ ] `hstack versions <id>`.
- [ ] Shared record-rendering helper (`StackRecord` → the `record.md` text) — reused by
      the editor in Phase 4.

## Phase 3 — schema ↔ file codec

The most-tested module. Pure functions, no I/O.

- [ ] `scaffold(type, { minimal, parentId, id })` → `record.md` text: required fields
      present, optional commented-out, `_readonly` block, body section per the
      body-field rule (one `text` field; else `--body`/config; else none).
- [ ] `render(record, type)` → `record.md` text for `hstack edit` (set fields, `--all` to
      include unset).
- [ ] `parse(text, type)` → `{ content, parentId, tags, bodyField }` + validation:
      `date` ISO shape, `record-ref` charset, `file-ref` SHA-256 hex, `array`/`object`
      recursion, reserved keys and field-name characters. Returns structured errors
      with field paths.
- [ ] `_readonly` diff-guard: detect edits to that block, error naming the porcelain
      command.
- [ ] Tests over every commons type's schema + a nested `array`/`object` fixture.

## Phase 4 — editing model

- [ ] Working-dir + lock manager: `edits/<profile>/<recordId>/` with `record.md` and
      `.hstack-lock.json` (`recordId`, `typeId`, `mode`, `baseVersion`, `editorPid`,
      `startedAt`, `profile`). Per-record, profile-namespaced.
- [ ] Editor launch: `config.editor` → `$VISUAL` → `$EDITOR`; detached by default,
      capture pid; `explorer` opens a file manager on the dir. `-c`/`--commit` waits
      then commits.
- [ ] `hstack new` — scaffold, lock `mode:"new"`, launch.
- [ ] `hstack edit` — fetch record + type, render, snapshot `version` as `baseVersion`,
      download `embed` attachments into the dir, lock `mode:"edit"`, launch.
- [ ] `hstack status` — list open edits; detect stale (dir gone / pid dead).
- [ ] `hstack commit [<id>]` — parse, validate (fail → reopen editor with errors
      prepended), reconcile `parentId` + `tags` (set) + working-dir attachments,
      `create()` or `update({ ifVersion: baseVersion })`, then release lock + delete
      dir. `--force` drops `ifVersion`. `StackVersionConflictError` → keep everything,
      print conflict + `hstack show --history` hint.
- [ ] `hstack discard [<id>]` (`--stale` sweeps).
- [ ] `hstack rm <id>` (`--hard`), `hstack restore <id>`.

## Phase 5 — relational porcelain

- [ ] `hstack tag <id> add|rm <label>`.
- [ ] `hstack link <id> add|rm` — flags `--label`, and one of `--to-record`
      (`+ --stack-url`) / `--to-entity` / `--to-external <ns> <id>`; builds core's
      `RelationshipTarget` union, absent `--stack-url` meaning this stack.
- [ ] `hstack perm <id> add|rm` — flags `--public` / `--entity <did>` / `--group <id>`,
      plus `--read` / `--write`; reads, modifies, and writes back the full `Permission[]`
      (`setPermissions` replaces wholesale).
- [ ] `hstack grant <typeId> add|rm` (`--entity` / `--group` / `--default`, then
      `<action>...`) and `hstack grant ls` — enforce the matching-scope-read dependency
      before `stack.grant`.
- [ ] Reference-creation-gating errors reworded ("can't reference X, can't read it").

## Phase 6 — attachments

- [ ] `hstack attach <id> add --label <l> --file <p>` / `rm --label <l> --file-id <sha>`.
- [ ] Working-dir attachment reconcile in `commit`: upload new (`putAttachment`),
      associate, dissociate removed; content-addressed skip for unchanged.
- [ ] Download `embed` attachments on `hstack edit` (done in Phase 4; verify round-trip
      here).

## Phase 7 — type registration

- [ ] `hstack types define <schema.json>` — `{ id, name, schema, migratesFrom? }` →
      `defineType`. Idempotent no-op on identical schema.
- [ ] Surface `StackSchemaDriftError` verbatim + state the version-bump remedy.

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
