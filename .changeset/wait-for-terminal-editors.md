---
'@haverstack/cli': minor
---

`hstack new`/`hstack edit` now wait for a terminal editor (`nano`, `vim`, ...) to exit
before returning, so it actually gets a controlling terminal to run in — previously it
was launched detached like a GUI editor and silently did nothing. The wait only happens
when `hstack` itself has a real terminal attached, so a script or agent driving it as a
subprocess is unaffected either way. Waiting does not commit; that stays `-c`/`--commit`'s
job. Added `--wait`/`--no-wait` to override the guess explicitly in either direction.
