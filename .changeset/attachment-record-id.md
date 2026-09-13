---
'@haverstack/cli': minor
---

Attachment associations now name the specific upload they came from
(`attachmentRecordId`, added in `@haverstack/core@0.32.0`), fixing a real bug: two
records referencing byte-identical content uploaded under different filenames used to
both show whichever name was uploaded first, everywhere — in `hstack edit`'s downloaded
working-dir filename and in `_readonly`'s attachment associations (which now also show a
resolved `filename` for the first time). Each record now correctly shows its own name.
Requires `@haverstack/core@^0.32.0` and `adapter-local`/`adapter-api@^0.31.0`.
