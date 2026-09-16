# Bounded DOCX logical text extraction

Scope: implement only story text reading for the original TypeScript utility.
Later editing, model API, rendering and release tasks remain pending. Work stays
on main; stage owned paths explicitly and commit locally without pushing.

Read the root instructions, applicable safe-bash instructions, DOCX specification,
shared CLI/SDK contracts, API audit, inventory and reconciliation decisions.
No reference runtime, native reference build, downloaded fixture or network access
is needed. All new documents are original authored XML packaged in memfs.

## Implementation and regression sequence

- Added eight failing extraction cases before product code: absent public API.
- Implemented logical traversal in packages/docx, reusing revision-bound locations
  and the common text.get schema/selectors. SDK and CLI share the extractor.
- Added failing CLI/discovery, legacy/modern text-box and zero-ID note cases.
  Implemented read-only shape-wrapper traversal, inherited review state and
  canonical note-part ordering. An initial global compatibility expansion made
  the original opaque-edit rejection test fail; moved that expansion into the
  read-only location index and retained the original editing test unchanged.
- Added failing selected-row and paragraph-mark/row review cases, then fixed
  separators and revision selection. Existing tests remain, with discovery
  expectations expanded only for the newly implemented read operation/features.
- Manual Shell QA found invalid-view JSON errors depended on flag order. Added a
  failing original regression, then used the existing grammar to identify error
  transport before interpreting option values (respecting values and `--`).

## Defined behavior and mappings

See [text extraction evidence](../docx/text-extraction.md) for exact ordering,
separators, hidden-text policy, direct formatting and language/security mappings.
The additive utility API does not implement or rename the documented object
model. No inventory member is promoted, including inherited members,
underscore-prefixed public types, enums, collections or helpers. Historical audit
evidence and the independently modified pipeline plan remain untouched.

## Checks and manual QA

Run the maintained DOCX workspace tests, lint and selected build closure. Run the
existing safe-bash DOCX registration suite and root export checks. Exercise the
actual command engine on original in-memory bytes, including body/all-story,
revision views, Unicode, stdin and selectors. Compare JSON data with the SDK and
inspect a terminal screenshot of real help/extraction output. This is manual QA,
not a QA script, screenshot unit test or document layout claim. Keep generated
screenshots disposable and unstaged.

Final maintained results on 2026-09-14:

- `npm run test --workspace=docx`: 774/774 tests, 29 files.
- `npm run lint --workspace=docx`: ESLint and production/test TypeScript passed.
- `npm run build:workspaces -- --workspace=docx`: all five declared dependency
  closure build tasks passed, including native npm lifecycle checks.
- Existing safe-bash reporting route for `docx-registration.test.ts`: 10/10,
  no skips. Root `scripts/docx-exports.test.ts`: 2/2.
- Manual QA through the actual Shell/adapter and built DOCX package: 15 calls.
  Body/all-stories in final/original/all, plain/JSON, binary stdin, selected cell,
  help and invalid-view JSON failure all passed. JSON data equaled SDK data and
  original MemoryFileSystem input bytes stayed unchanged. The first QA attempt
  exposed the flag-order regression above; only the corrected complete run is
  counted as passing evidence.
- Inspected `/tmp/docx-logical-text-20260914.png`: readable policy help,
  paragraph/cell/story separators and revision output. The bundled capture font
  shows missing CJK/Hebrew glyphs; exact Unicode output assertions pass. This is
  a capture-font limitation, not evidence of text loss or multilingual rendering
  conformance. The screenshot remains disposable and unstaged.

Delivery is one atomic local feature commit with its regression tests and this
plan. No push or release is authorized; subsequent tasks remain pending. The
commit hash is reported separately after Git creates it.
