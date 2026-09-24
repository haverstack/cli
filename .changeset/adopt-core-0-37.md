---
'@haverstack/cli': minor
---

Adopt core 0.37: record permissions are associations, and six operations no longer bump a version

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
