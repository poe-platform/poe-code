# Active DOCX table grid inspection

Task: `adapt-upstream-tables-bdd`, one validated atomic correction only.
The complete adaptation task and every later task remain pending.
Baseline: main at `b3288827342d27d7cf37a6d4ecb3efb1609f5cb0`, empty index.
Preserve the preexisting modified specification, audit, pipeline plan, packing,
archive extraction, equation and registration work; none belongs to this commit.

Root owns `packages/docx/src/table-read.ts`, `table-active-grid.test.ts`, this
plan and its evidence under `docs/docx/table-bdd-evidence`. Delegated integration
owns only `packages/safe-bash/tests/commands/docx/tables.test.ts`; root coordinates
Git. Separate read-only reviewers inspect BDD/public-surface gaps and table cases.
No README, registration, source adapter, export or historical seal edits.

## Validated defect and test-first correction

The document selection engine follows selected compatibility branches, but table
inspection previously read raw `tblGrid`, `gridCol`, `trPr`, `gridBefore` and
`gridAfter` children. A valid grid inside a selected branch therefore appeared
to have zero columns. Wrapped omission properties could instead cause inspection
to query an omitted cell, or report an incorrect span. Unsupported choices must
use the selected fallback, without counting dormant representations.

Seven original memfs regressions failed before source changes: selected grid,
fallback grid, selected column declarations, three omission-property wrappers,
and a renamed Word namespace. The initial six-case run mistakenly declared an
unsupported choice namespace in five fixtures; that initial failure is retained
as test-authoring evidence, not seven product reproductions. Correcting `Requires`
to a declared understood Word namespace produced six product failures, then
adding the independent column-declaration case produced seven product failures.

Inspection now reads these children from its already-admitted active compatibility
view. Expanded names preserve prefix independence. Property lookup charges actual
work and retains the prior duplicate-property rejection class. No new editor,
host decoder, model alias, ambient I/O or networking is introduced.

The final test file also contains 27 original combinations: leading omissions
0/1/3, trailing omissions 0/1/2 and horizontal spans 1/2/4, each continued over
two rows. Every populated coordinate resolves to its owner; every omitted slot
rejects as missing selection. Exact spaced Unicode/numeric-looking text and
caller bytes remain unchanged. These supplement format/security coverage rather
than substituting for unrelated source/API rows.

Two new Shell tests contain six independent fixtures. They verify binary stdin,
JSON operation/results, active grids, omissions, owner location tokens, exact
literal text, source byte preservation and absence of publication. Existing
integration membership already names this exact test file; no registration
change is necessary. Shell fixtures first ran after the source correction;
their green execution is not independent historical red evidence.

## Verification and QA procedure

1. Run the corrected new original tests before changing inspection; retain the
   observed failures and fixture-authoring correction separately.
2. Correct only active child traversal. Run final focused tests and maintained
   DOCX unit, lint and selected workspace build closure.
3. Run the owned real Shell integration file, maintained runner, guarded root
   lint and maintained source/test/strict-consumer typechecking.
4. Use the maintained screenshot command to capture actual command-engine
   `tables get --help` and `tables get - --table 1` for an original selected
   three-column grid with one populated middle cell. Inspect the PNG.
5. Review explicit ownership, index and whitespace; commit only verified owned
   files on main. Never push or release.

Executed on 2026-09-15:

- Corrected red: seven failures in `table-active-grid.test.ts` before source edits.
- Focused final green: 34 tests passed; original fixtures remain entirely memfs.
- `npm test --workspace=docx`: 163 files, 3,279 tests passed, including the final
  34-case file. This run uses the shared working tree, including preserved
  unrelated edits; it is not an immutable committed-archive qualification.
- `npm run lint --workspace=docx`: ESLint and source/test TypeScript passed.
  One existing type-only unused-variable warning in `operation-types.test.ts`.
- `npm run build:workspaces -- --workspace=docx`: uncached declared five-workspace
  build dependency closure and native suffix/export checks passed.
- `TSX_DISABLE_CACHE=1 node --import tsx --test
  packages/safe-bash/tests/commands/docx/tables.test.ts`: 15 tests passed; the
  two additions contain six fixture executions.
- `npm run test:runner --workspace=virtual-bash`: 522 passed.
- `npm run lint:eslint`: maintained guarded root route passed, complete true,
  zero errors/13 warnings outside the owned test; 15,397 configured/linted subjects.
  No direct lint API run supplies maintained clearance.
- `npm run typecheck --workspace=virtual-bash`: maintained source-and-tests and
  26 current consumer groups passed. Expected negative consumers exit 2; historical
  compile-only models are not runtime qualification.
- `npm run screenshot -- -o /tmp/docx-active-grid-cli.png --no-header -- node
  --import tsx --input-type=module -e <ad-hoc invocation>`: captured actual help
  and human read output. Visually inspected dimensions, logical middle-cell
  position, readable flags and exit 0. The terminal font lacks the CJK glyph;
  exact Unicode remains independently verified through SDK/Shell byte assertions.
- `git diff --check`: passed.

No downloaded document or cloned binary fixture was used, changed or deleted;
cleanup count is zero. No document-page renderer was executed. This correction
does not qualify live table owners, whole public APIs, all expanded workflows,
corpus round-trips, complete safe-bash unit execution, remote main or releases.
Evidence and provenance belong in `docs/docx/table-bdd-evidence`; temporary
screenshots and generated QA inputs are not staged or shipped.
