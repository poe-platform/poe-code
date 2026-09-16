# Revision read views

Supplemental verification recovery is recorded in
[the requalification record](docx-revision-read-requalification.md). It preserves
the historical evidence below and qualifies row visibility, story-level range
safety and the supported direct-property snapshot boundary separately.

Status: implemented and verified on 2026-09-14.
Scope: only `revision-read-views`. Tracked change creation, acceptance/rejection,
review-model owners and later pipeline tasks remain pending. The pre-existing
pipeline-plan changes are unrelated and remain unstaged.

## Contract and implementation

Read `docs/specs/docx.md`, `office-cli.md`, `office-sdk.md`, the root instructions,
the scoped safe-bash instructions, and the public API audit/inventory. Changes
are confined to the original DOCX engine; the existing safe-bash adapter already
calls that engine. No new adapter, root product logic, networking, ambient I/O,
clock access, downloads or reference runtime is introduced.

- `text.get` retains final as its default. Final omits deleted/move-from text;
  original omits inserted/move-to text; all retains XML order. Nested ancestors,
  split runs, deleted paragraphs, paragraph marks and rows retain their existing
  view rules. Field instructions and deleted instructions never become prose.
- Original direct run and paragraph properties come from supported `rPrChange`
  and `pPrChange` snapshots, without merging current properties into the old
  snapshot. All uses current `formatting` and exposes `originalFormatting`;
  the latter is null in other views. This is direct context, not a style cascade.
- Segment `revisions` records enclosing text/property changes. Paragraph separator
  segments include their revised paragraph-mark identity. Top-level `revisions`
  inventories selected review metadata independently of text visibility; `warnings`
  discloses opaque content. Plain text receives no annotation labels.
- `inspectDocumentRevisions(bytes, options, context)` and `revisions list` use one
  engine with all as the default view. Returned `RevisionListData` contains view
  and ordered items with fingerprinted annotation locations. Selections support
  scope, section, note/comment, paragraph/run, table/cell, whole annotation tokens,
  and one-based revision positions after scoping/view filtering. Unknown or
  unavailable selectors are not advertised as supported.
- IDs, authors and stored date strings remain separate from location generations.
  Items expose the XML local name/namespace, move range name, semantic type and
  `supported` versus `opaque` **read** interpretation. This does not grant edit,
  accept or reject support. Move pairs retain their separate range IDs and shared
  names; XML identity is never reassigned.
- Unknown revision wrappers do not flatten into visible text. Ignorable revision
  extensions remain inventoried; inactive compatibility alternatives do not enter
  the active read view. Malformed property snapshots, table/section revisions,
  custom-XML/conflict revisions and unverified families remain opaque.
- Ordinary unrelated edits preserve review bytes. Literal replacement rejects
  affected move/custom-XML ranges, including ranges spanning paragraphs, and
  changed property boundaries. Whole-paragraph text replacement cannot erase
  run/property/paragraph-mark history or operate inside an enclosing review range.
  Inactive alternatives cannot falsely block unrelated replacement. Existing
  simple revision-contained replacement behavior and original tests are retained.

Standards basis: existing pinned coverage F26/F27, ECMA-376 Part 1 §17.13.5,
`CT_RunTrackChange`, `CT_RPrChange`, `CT_PPrChange`, `CT_MoveBookmark`, and opaque
`CT_TblPrChange`/`CT_SectPrChange`. Transitional and Strict namespace tests share
original data. This is no full schema or rendering conformance claim.

## Exact JS/security mappings and documentation drift

| Surface | Mapping and disposition |
| --- | --- |
| Revision IDs | Nullable stored strings retain lexical representation and absent metadata; unlike the full proposed numeric ResourceDetails, this bounded snapshot never coerces XML identity. Existing package validation still rejects invalid/duplicate supported IDs. |
| Authors/times | Nullable decoded author and stored `date` string; no inferred author, timezone, clock or Date conversion. Live Date-valued model contracts remain unchanged. |
| Utility entry | Async owned Uint8Array admission, injected limits/cancellation and VFS-only CLI reads; readonly metadata snapshots, no creating getters. |
| Positions and locations | One-based scoped/view-filtered CLI ordinals; fingerprinted annotation tokens reject stale input. Model sequences retain their separately documented zero-based rules. |
| Formatting | Missing direct values remain null; explicit false stays false. Old snapshots replace current direct properties in original view. Opaque history is disclosed and never represented as a supported rollback. |
| Errors and output | Common usage exit 2; missing/stale/unsafe selections use existing typed codes and operational exit 1; successful reads affect zero. JSON uses the version-1 envelope; human metadata is terminal-escaped. |
| Model inventory | No revision-specific live owner is present in the pinned 920-record public inventory. `CoreProperties.revision` is document metadata, not tracked changes. Document/Paragraph/Run traversal and text members, inherited owners, enums, helpers, collections and all public underscore-prefixed types retain their existing obligations/statuses. No row is hidden or promoted by this utility milestone. |
| Scope drift | The earlier text-extraction evidence excluded original property rollback; this task supersedes that statement only for verified direct run/paragraph snapshots. `RevisionListData` and additive text metadata are bounded executed results, not the complete proposed ResourceDetails or model graph. Accept/reject, tracked creation and batch execution remain pending. |

The historical public API inventory, reconciliation discrepancies and case
crosswalk remain research evidence. No reference-project identifiers or assets
were copied into product code, comments, test identifiers, fixtures or CLI text.
No substantive derived material or new legal notice is involved.

## Failing-test evidence

Original in-memory regressions are in `packages/docx/src/revisions.test.ts`.
The initial fixture setup accidentally reused supported IDs and referenced
undefined styles; these were corrected before verifying the concrete baseline.
`/tmp/docx-revisions-validated-red.log` reran the corrected tests against the
original owned product files: eight failures, one existing safety pass. Saved
implementation files were restored afterward; unrelated files were untouched.

Additional failures before their fixes:

- `/tmp/docx-revisions-edges-red.log`: three failures for ignored extension
  inventory, paragraph-mark identity and cross-paragraph range removal.
- `/tmp/docx-revisions-order-red.log`: mixed opaque/supported encounter ordering
  and inherited view visibility.
- `/tmp/docx-revisions-format-red.log`: original property context in all view.
- `/tmp/docx-revisions-inactive-red.log`: inactive range falsely blocking removal.
- `/tmp/docx-revisions-annotation-red.log`: original annotation ordinals reordered
  by the newly added raw inventory; the completed index restores XML encounter
  order while retaining opaque metadata.
- `/tmp/docx-revisions-owner-red.log`: revision locations lost inherited paragraph/
  section positions; the completed inventory retains nearest owner positions.

The malformed/opaque history case passed on first execution and is supplemental
coverage, not claimed as a pre-code failure. Original text, mutation and discovery
tests remain; discovery expectations add only the implemented read operation and
read capabilities. Mutating fixtures and outputs use memfs.

## QA procedure

1. Execute the real command engine for revision list help, a mixed revision list,
   final/original/all text and an unsafe replacement dry-run, using original
   in-memory bytes and supplied output sinks.
2. Render captured terminal output with the maintained terminal-png renderer.
   Inspect readability, line wrapping, escaped metadata, clean plain text and
   the unsupported-edit diagnostic. DOCX is an optional safe-bash plugin, not a
   root poe-code route; do not invent a root command to take a screenshot.
3. Run maintained DOCX workspace unit/lint checks and its selected workspace build
   closure, plus existing safe-bash DOCX and portable export integration checks.
4. Review owned diffs and explicitly stage only owned source/tests and this plan.
   Commit on main, without push or release. Keep all disposable logs/images out
   of the commit. Later tasks remain pending.

## Final verification

Visual QA completed: `/tmp/docx-revisions-cli.png` was inspected. Help, IDs,
authors/times, supported/opaque labels, all three plain text views, opaque
warnings and the unsafe-edit exit-1 diagnostic are readable and unclipped.
No reference/native document renderer was used.

Final maintained checks passed on the completed product files:

- `npm test --workspace=docx`: 76 files, 1,883 tests, including 17 revision
  regressions. `/tmp/docx-revisions-delivery-test.log`.
- `npm run lint --workspace=docx`: ESLint and source/test TypeScript checks.
  `/tmp/docx-revisions-delivery-lint.log`.
- `npm run build:workspaces -- --workspace=docx`: selected five-workspace build
  closure, including declared postbuild hooks. `/tmp/docx-revisions-delivery-build.log`.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts`:
  42 passed, none skipped. `/tmp/docx-revisions-delivery-shell.log`.
- Portable exports and text command integration: seven tests passed through
  `npx vitest run scripts/docx-exports.test.ts packages/docx/src/text-command.test.ts`.
  `/tmp/docx-revisions-delivery-exports.log`.
- CLI screenshot inspected and `git diff --check` passed.

Earlier package runs that overlapped addition of new failing regressions remain
failure evidence; they are not claimed as passing final checks. All original
unit tests remain present. No full-root suite, native renderer, networking,
whole-public-API completion, remote delivery or release is claimed.

This bounded implementation, its original regressions, discovery updates and
research/specification drift record form one atomic commit on main. Only owned
files are staged. The unrelated pipeline-plan edits and later tasks are preserved.
