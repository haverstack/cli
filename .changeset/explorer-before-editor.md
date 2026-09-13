---
'@haverstack/cli': minor
---

`--explorer`/`config.toml`'s `explorer = true` now open the file manager _before_ the
editor, not after — previously, with a blocking (`-c`, or an auto-waited terminal)
editor, the folder didn't appear until you'd already closed the editor you wanted it
open alongside. Also fixes `-c`/`--commit` never opening it at all.
