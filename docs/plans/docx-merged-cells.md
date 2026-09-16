# Bounded DOCX merged cells

Scope: F20 logical ownership, explicit rectangular merge/split and row deletion
through spans. Main only; owned local commit, no push or release. Preserve the
preexisting pipeline-plan edit and every historical artifact. Later tasks,
including full live table owners, remain pending.

## Decisions and exact JS/security mappings

- Utility coordinates are uppercase, one-based A1 coordinates. Horizontal
  gridSpan slots and vMerge continuations identify the same owner token. Reads
  deduplicate owners. `tables.set` through a covered coordinate rejects with
  `ambiguous-selection` unless `covered: "owner"` / `--covered owner` is explicit.
  The owner coordinate or its fingerprinted token is already explicit intent.
- `tables.merge` selects a table with top-left `from` and bottom-right `to`.
  Every intersecting owner must fit wholly inside the rectangle. `join` is
  required: `paragraphs` moves rich blocks in physical row order, preserving
  paragraphs, nested tables, namespace context and lexical comments; `reject`
  accepts only structurally empty cells. Formatting comes from the leading
  physical cell in each row. Defined grid widths are summed; absent grid widths
  fall back to stored dxa cell widths when integral subdivision is possible. No text flattening,
  resource fetching, field evaluation or native runtime is involved.
- `tables.split` selects one logical owner, including a covered coordinate.
  Positive `rows`/`cols` must divide its existing spans exactly; no grid growth.
  Required `distribute: "anchor"` puts all content into the first resulting cell;
  `"paragraphs"` requires precisely one paragraph per resulting logical cell and
  rejects other block kinds or lexical annotations between paragraphs. Partial
  subdivisions retain appropriate gridSpan/vMerge markers. Recomputed widths
  use the unchanged grid. Blank continuation paragraphs are structural only;
  formatted/annotated empty paragraphs are preserved as content.
- Row removal retains at least one row. Removing an owner, middle continuation,
  or final continuation shrinks the span and promotes the next owner as needed.
  Crossing vertical spans require `join: "paragraphs"`; all their nonempty
  physical content survives on the remaining owner. Ordinary deleted cells are
  deliberately removed. Range-marker/complex-field deletions remain rejected.
- Merge/split reject range-marker/complex-field movement, partial overlaps,
  legacy horizontal markers, wrapped/omitted grids and malformed continuations.
  Span-aware row/column insertion and column removal remain unsupported. Input
  and resulting grids are checked before the existing validated publication.
- `editDocumentTables` remains always async, receives owned bytes and explicit
  context, and uses the same engine as direct plural CLI commands. Typed options,
  common flags, version-1 JSON, binary stdout, dry-run and failure publication
  guarantees remain shared. No new ambient I/O, networking, clocks or identity.

Read the root/scoped instructions, DOCX and shared CLI/SDK contracts, pinned
API audit and table records in the 920-record research inventory. The QA reduction
register's merged/omitted-cell case is reduced to tiny original North/East/South/
West grids, a nested Inner/Pair table, orphan/mismatched/duplicate markers and
partial-overlap boundaries. No download or native reference execution was needed.

| Public obligation | Exact mapping and disposition |
| --- | --- |
| Table.cell, row_cells, column_cells; _Row.cells; _Column.cells | Model zero-based indexing and repeated owner/node identity remain planned. Current one-based utility reads resolve all covered slots to the same token; no Python wrapper allocation identity claim. |
| _Cell.merge(other_cell), grid_span | Utility rectangle join is implemented; live same-document cell arguments, returned _Cell and grid_span property remain pending. Merge content follows row order. Split is additive and not inferred from source merge tests. |
| _Cell.text/paragraphs/tables/iter_inner_content/add_table/add_paragraph | Retain neutral spellings, nested block order and terminal paragraphs. This utility does not implement the complete destructive model setter or live content collections. |
| Table.table_direction, alignment/autofit/style; _Cell.width/vertical_alignment; _Row.height/height_rule/omissions; _Column.width | Existing utility formatting and new span widths are bounded evidence. D03 remains a documentation error: no model direction alias. Null/false/zero and tagged enum/Length contracts remain unchanged. |
| _Rows/_Columns and inherited part/table | Public despite underscore names. Planned .at(index), .length, Symbol.iterator and supported .slice(start,end) remain explicit; owner-scoped part capabilities never imply ambient files. |
| Enums, inherited members, helpers and APIs without source tests | Original inventory obligations stay visible and pending unless separately evidenced. No historical row is promoted by utility success; no blanket full-public-API claim. |

Documentation drift: the spec formerly allowed implicit scalar writes through
covered coordinates, described first-cell split distribution as automatic, and
called merge/split pending. This milestone makes content/write intent explicit,
adds the actual supported utility subset and retains live-owner gaps. Earlier
plans and pinned inventory are historical, not rewritten as current evidence.

## Test-first record and maintained checks

Original red phase: 9 of 16 new regressions failed before product edits; 7 existing
rejection behaviors already passed. A corrected CLI harness was rerun before
implementation. Logs: `/tmp/docx-merged-cells-red-20260914.log` and
`/tmp/docx-merged-cells-red-corrected-20260914.log`.
Additional red phases reproduced duplicate-span reads, effectless policy flags,
complex-field movement, discovery drift and valid partial subdivisions. The
original cell-write test retains its name/data/assertions, adding explicit owner
intent required by the new contract. Existing capability assertions change only
the supported F20 level. All unit mutations use memfs.

Final maintained checks, 2026-09-14:

- `npm test --workspace=docx`: 61 files, 1,567 tests passed, including 25 new
  merged-cell regressions. The intermediate discovery-list failures were fixed
  by adding the two newly implemented paths to the original expectations.
- `npm run lint --workspace=docx`: ESLint, source TypeScript and test TypeScript
  passed. Scoped ESLint on the changed safe-bash table test also passed.
- `npm run build:workspaces -- --workspace=docx`: all five declared dependency
  builds and native postbuild checks passed, uncached.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts
  packages/safe-bash/tests/commands/docx-registration.test.ts`: 47 passed,
  zero skipped. The added memfs shell case verifies merge/publication, exit-1
  covered-write rejection with unchanged bytes, and exact split text recovery.
- `npm run test:runner --workspace=virtual-bash`: 515 passed, zero skipped;
  the existing table integration file remains explicitly registered.
- `npx vitest run scripts/docx-exports.test.ts`: both export checks passed.
- `git diff --check`: passed.

Final logs use `/tmp/docx-merged-cells-*-complete-20260914.log`; the runner log is
`/tmp/docx-merged-cells-runner-20260914.log`. Red/intermediate logs remain separate.
No full-repository/full-safe-bash gate, native reference build or downloaded
fixture execution is claimed.

Executed the manual steps below. Fresh `npm run screenshot` captures were
visually inspected at `/tmp/docx-merged-cells-cli-final-20260914.png` and
`/tmp/docx-split-cells-cli-final-20260914.png`: required policy flags are readable,
inapplicable merge cell/all selectors are absent, dry-run succeeds with exit 0,
and missing coordinates fail with exit 1. The earlier screenshot exposed the
inapplicable help flags and remains separately preserved. This is terminal and
structural verification, not rendered Word-page validation.

The standards basis remains T20 in the retained standards audit: P1 §17.4,
CT_TcPr/CT_VMerge/CT_TblGrid and the pinned Strict/Transitional namespaces. No
new unverified section numbers or full format-conformance claim are introduced.
Implementation, tests and this plan form one owned atomic feature commit.
No push/release; later tasks remain pending.

## Manual QA steps

1. Inspect generated merge and split help through the command engine; confirm
   required content policies, one-based coordinates and supported subdivisions.
2. Through safe-bash, create a 2x2 original table, merge A1:B2, reject a covered
   scalar write with exit 1 and unchanged destination, then split and inspect
   original numeric-looking text. Confirm dry-run JSON and binary stdout remain
   separate. Run the existing registered table integration file.
3. Capture and visually inspect terminal help/success/error output using the
   repository screenshot route. Keep PNGs/logs disposable and outside commits.
4. Inspect owned diff and checks; commit explicit owned files with this plan.
   Do not push, release, change README or advance subsequent tasks.
