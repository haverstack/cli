---
'@haverstack/cli': minor
---

`hstack new`/`hstack edit` gained `--explorer`, opening a file manager on the working
directory for just that call (e.g. to drop an attachment before committing). Replaces
`--no-explorer`, which negated a default that was already off unless `config.toml` set
`explorer = true` — there was no way to ask for the folder without setting that
persistently.
