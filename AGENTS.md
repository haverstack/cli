# Agent Guide

Instructions for AI coding agents working in this repository.

## Before you push

Run all five. They mirror `.github/workflows/ci.yml`.

```sh
pnpm run format:check   # pnpm run format to fix in place
pnpm run lint
pnpm test
pnpm run build
pnpm run typecheck
```

`pnpm test` and `pnpm run typecheck` do not need a prior build — deps resolve from the
published `node_modules/@haverstack/*/dist`, and vitest transforms `src` directly.

Report results honestly. If something fails, say so with the output.

## Design docs

- [`docs/design.md`](./docs/design.md) — how the CLI works and why. A change to observable
  behavior updates the relevant section in the same change. Module comments cite it as
  `docs/design.md § Section`.
- [`docs/plan.md`](./docs/plan.md) — the phased build plan. Tick items and add short
  progress notes as work lands.

## Conventions

Carried from `@haverstack/core`:

- **Comments answer _why_, not _how_.** Four or five lines is the maximum. File-top module
  comments are exempt.
- **Never cite GitHub issues in code comments.** They belong in commit messages and PR
  descriptions.
- **Never describe previous implementations.** State the current invariant.
- **No backward-compatibility shims.** There is no install base. Delete rather than
  deprecate; no "legacy".
- **Name tests after the invariant they pin**, not the defect that prompted them.

## Changesets

Every change that ships to npm carries a changeset (`pnpm changeset`). `patch` for
anything a consumer cannot observe; `minor` for anything they can (`0.x`, so minor is the
breaking slot). No changeset for tests, CI, or repo tooling.

Releasing is automated (`.github/workflows/release.yml`): pushing changesets to `main`
opens a `chore: version packages` PR that consumes them; merging it publishes to npm via
the repo's Trusted Publisher (OIDC — no `NPM_TOKEN`).

## Commits and pull requests

- Conventional Commits: `feat:`, `fix:`, `docs:`, optionally scoped.
- Imperative subject; the body explains why.
- Don't open a PR unless asked to.
