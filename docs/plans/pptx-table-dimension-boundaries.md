# Positive table dimension boundaries

Specification `docs/specs/pptx.md` §6.3 requires positive row/column sizes. The
shared table codec concretely admitted a 1-EMU width divided across two columns,
producing a zero-width trailing cell. Zero explicit row/column sizes and zero
whole-table updates also succeeded. Reading and preserving imported grids must
remain possible, including unrelated text/style edits to legacy zero-size cells.

## TDD

- Red: `table-dimension-boundaries.test.ts` initially ran 13 cases: 11 failed,
  2 passed. Failed scenarios directly demonstrate creation and mutation admission
  gaps; passing controls establish the minimum valid cells and imported-zero
  preservation behavior.
- Implementation: validate explicitly requested positive dimensions, validate
  creation total extent against grid count before building cells, and validate
  requested update extents against the existing grid before distributing sizes.
  Do not tighten read-time validation or reject unchanged imported sizes.
- Green: pending focused rerun; parent runs maintained checks after final files.

## Language/security mapping

Rows/columns remain bounded integers and geometry remains explicit typed lengths
or the existing closed unit records. Invalid requests throw synchronous
`invalid-value` through live models and reject asynchronously through byte
operations; CLI must map the same validation to exit 2 with no publication.
This is a deliberate stricter dimension rule than any source runtime that permits
zero-sized cells. It is required by the utility specification, not literal runtime
parity. No reference-project identity belongs in product code or fixtures.

## QA

No renderer run in this task. Unit assertions concern numeric admission,
unchanged XML/package bytes, positive grid extents and preservation of imported
zero-size cells. Future rendering QA follows the disposable corpus manifest;
keep fixtures ignored and reduce meaningful findings into original memory tests.
Do not run the whole pipeline.

Focused green: six files, 108 tests passed (1.56 seconds), including all 13 new
regressions and existing table/spans/model/workflow tests. New validation does not
reject imported zero entries unless their dimension is explicitly rewritten;
a positive write to one imported row/column also leaves another zero entry intact.
Creation validation happens before table XML generation; update validation happens
before any owner write. Final maintained checks are coordinated by the parent.

Pinned research confirms the source mapping difference: `_Column.width` and
`_Row.height` delegate to `CT_TableCol.w` / `CT_TableRow.h`, both using
`ST_Coordinate` (`src/pptx/oxml/table.py:400,434`). That coordinate type's signed
range admits zero (`src/pptx/oxml/simpletypes.py:300-345`). The stricter positive
setter rule here intentionally follows §6.3. Existing positive setter variants
`upstream-test-inventory.json#/unit_cases/2411`, `/2412`, `/2425`, `/2426` retain
their behavior; original zero-boundary regressions supplement those source cases.
Final preservation assertion also passes: 13 focused tests, 159ms.

## Final maintained verification

- `npm run test --workspace=pptx`: 257 files, 6,789 tests passed (60.18s).
- `npm run lint --workspace=pptx`: ESLint and both typechecks passed.
- `npm run build:workspaces -- --workspace=pptx`: three declared builds passed.
- Four focused safe-bash table suites: 30 tests passed, including all six new
  rejection/nonpublication cases; maintained source/test typecheck passed.
- CLI error and minimum-valid-size screenshot inspected; see the
  [CLI receipt](pptx-table-dimension-cli.md). Presentation rendering remains unrun.
- Scoped formatting and whitespace checks passed. No push or release.
