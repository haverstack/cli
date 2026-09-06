# @haverstack/cli

A type-agnostic tool for editing a [Haverstack](https://github.com/haverstack) stack from
a terminal — against a local SQLite file or a remote stack server, using your own editor.

It knows nothing about notes, articles, or sites. It fetches a type's schema, turns it
into an editable file, validates what comes back, and writes it. Every type in a stack is
editable by the same tool on the day it is registered.

> **Status: early.** Phase 0 of the [build plan](./docs/plan.md) — scaffold plus a single
> `types` command. The [design doc](./docs/design.md) describes the intended whole.

## Install

```sh
npm install -g @haverstack/cli
```

Installs two bins: `haverstack` (canonical) and `hstack` (short alias).

## Usage so far

```sh
hstack types --stack ./my-stack.db          # list the types in a local stack
hstack types --stack ./my-stack.db --json   # same, as JSON for jq
```

`$HAVERSTACK_STACK` is read when `--stack` is omitted.

## Development

```sh
pnpm install
pnpm test
pnpm run build
```

See [`AGENTS.md`](./AGENTS.md) for the full check list and conventions.

## License

MIT
