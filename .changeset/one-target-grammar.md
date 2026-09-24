---
'@haverstack/cli': minor
---

Name every association target the same way: one `--to`, parsed once, narrowed per command

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
