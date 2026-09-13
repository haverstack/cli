# @haverstack/cli

## 0.3.0

### Minor Changes

- [`4ee536b`](https://github.com/haverstack/cli/commit/4ee536b7d85f616f1b3867415272f84568d99c96) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Attachment associations now name the specific upload they came from
  (`attachmentRecordId`, added in `@haverstack/core@0.32.0`), fixing a real bug: two
  records referencing byte-identical content uploaded under different filenames used to
  both show whichever name was uploaded first, everywhere — in `hstack edit`'s downloaded
  working-dir filename and in `_readonly`'s attachment associations (which now also show a
  resolved `filename` for the first time). Each record now correctly shows its own name.
  Requires `@haverstack/core@^0.32.0` and `adapter-local`/`adapter-api@^0.31.0`.

## 0.2.0

### Minor Changes

- [`29924dd`](https://github.com/haverstack/cli/commit/29924dd5fe409c40ed494308f9c936889fce08ed) Thanks [@cuibonobo](https://github.com/cuibonobo)! - `--explorer`/`config.toml`'s `explorer = true` now open the file manager _before_ the
  editor, not after — previously, with a blocking (`-c`, or an auto-waited terminal)
  editor, the folder didn't appear until you'd already closed the editor you wanted it
  open alongside. Also fixes `-c`/`--commit` never opening it at all.

- [`5c1c95e`](https://github.com/haverstack/cli/commit/5c1c95e6ac9d57a8b80860d1580b95144a37daa8) Thanks [@cuibonobo](https://github.com/cuibonobo)! - `hstack new`/`hstack edit` gained `--explorer`, opening a file manager on the working
  directory for just that call (e.g. to drop an attachment before committing). Replaces
  `--no-explorer`, which negated a default that was already off unless `config.toml` set
  `explorer = true` — there was no way to ask for the folder without setting that
  persistently.

- [`9f42543`](https://github.com/haverstack/cli/commit/9f42543e69466761c56c7b797424cff634963e7a) Thanks [@cuibonobo](https://github.com/cuibonobo)! - `hstack new`/`hstack edit` now wait for a terminal editor (`nano`, `vim`, ...) to exit
  before returning, so it actually gets a controlling terminal to run in — previously it
  was launched detached like a GUI editor and silently did nothing. The wait only happens
  when `hstack` itself has a real terminal attached, so a script or agent driving it as a
  subprocess is unaffected either way. Waiting does not commit; that stays `-c`/`--commit`'s
  job. Added `--wait`/`--no-wait` to override the guess explicitly in either direction.

## 0.1.0

### Minor Changes

- [`4f171fe`](https://github.com/haverstack/cli/commit/4f171fec47dee64ff5c47da0007b4cfcb985855b) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Initial release: `hstack`/`haverstack`, a type-agnostic terminal tool for editing a
  Haverstack stack. Connect to a local SQLite file or a remote stack server; scaffold,
  edit, and validate records against their type's schema in your own editor; manage
  tags, relationships, permissions, type-level grants, and attachments; register new
  types from a schema file.
