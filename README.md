# @haverstack/cli

A type-agnostic tool for editing a [Haverstack](https://github.com/haverstack) stack from
a terminal — against a local SQLite file or a remote stack server, using your own editor.

It knows nothing about notes, articles, or sites. It fetches a type's schema, turns it
into an editable file, validates what comes back, and writes it. Every type in a stack is
editable by the same tool on the day it is registered.

See [`docs/design.md`](./docs/design.md) for the full design.

## Install

```sh
npm install -g @haverstack/cli
```

Installs two bins: `haverstack` (canonical) and `hstack` (short alias, used below).

## Connecting to a stack

```sh
hstack stack add mine --path ./my-stack.db          # a local SQLite file
hstack stack add prod --url https://stack.example.com  # a remote server (generates + stores a key)
hstack stack use mine                                # sets the default
```

`hstack stack ls` lists profiles; `hstack stack rm <name>` removes one. Without a saved
profile, pass `--stack <path|url|name>` per command, or set `$HAVERSTACK_STACK`.
Authentication to a server is a DID challenge-response handshake, not a shared token —
`stack add --url` generates a keypair on first use.

## The editing loop

```sh
hstack types                       # what's registered
hstack new com.example/note@1      # scaffolds record.md and opens your editor, then exits
# ...edit record.md in your editor, save, close it...
hstack commit                      # validates and writes back
```

`hstack edit <id>` reopens an existing record the same way. Nothing is written until
`commit` — closing the editor, even killing it, leaves the working copy untouched.
`hstack status` lists open edits; `hstack discard [<id>]` abandons one. A commit is
fenced by the version you started from; a conflict keeps your working copy and tells you
to review it or `--force`.

## Everyday commands

```sh
hstack ls <typeId>                 # list records of a type
hstack show <id>                   # render one record
hstack rm <id>                     # soft-delete; hstack restore <id> to undo
hstack tag add <id> <label>        # tag a record outside an edit session
hstack link add <id> --label <l> --to record:<otherId>
hstack perm add <id> --to <did> --read --write
hstack perm ls <id>                # who reaches this record
hstack grant add <typeId> --to <did> read-any
hstack attach add <id> --label <l> --file <path>
hstack types define <schema.json>  # register { id, name, schema, migratesFrom? }
```

### Naming a target

`link`, `perm` and `grant` all say who or what they mean with one `--to`:

```
anyone                     the world, anonymous requesters included   (perm)
authenticated              any entity holding a DID                   (grant)
did:key:z6Mk…              an identity                                (all three)
group:<id>/<member|admin>  a group's roster at one role               (perm, grant)
record:<id>[@<stackUrl>]   a record, here or in another stack         (link)
external:<ns>/<id>         something outside any stack                (link)
```

One grammar, parsed in one place, narrowed per command — a target the command cannot name
is refused by name rather than quietly misread. `perm ls` and `grant ls` print targets in
the same grammar, unelided, so a listing row pastes straight back into a command.

Tagging, linking, attaching, sharing and moving a record are **no-bump** writes in core:
they leave `version` and `updatedAt` where they stand, so these commands report what the
record now says rather than a version number that did not move. Record permissions are
associations — one element per bit per grantee — so `perm add`/`perm rm` write exactly the
element you name and never restate the rest of the ACL over someone else's change.

Every read command takes `--json` and loops the result cursor to exhaustion (or an
explicit `--limit`), so it's a client to build on, not just one to sit in front of:

```sh
hstack ls com.example/note@1 --json | jq '.[] | select(.content.pinned) | .id'
hstack show "$id" --json | jq .content
```

## Development

```sh
pnpm install
pnpm test
pnpm run build
```

See [`AGENTS.md`](./AGENTS.md) for the full check list and conventions.

## License

MIT
