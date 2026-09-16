# Table insertion model workflow

The public `SlideShapes.add_table(rows, cols, left, top, width, height)` method was
absent. It now synchronously returns a live `GraphicFrame`, using the existing
table codec and shape allocator/append path. This also retains group bounds and
unique IDs. No separate package editor or implicit I/O was added.

## Validation

- Red: all six initial original tests failed on the absent `add_table` method.
- Green: seven original tests pass, covering 2x2 grid remainder distribution,
  returned frame/cell liveness, invalid row counts (0, -1, 1.5, NaN) with unchanged
  XML, group insertion/bounds/IDs, and presentation-owner save/reopen.
- An initial literal namespace-prefix assertion was corrected to use an independent
  namespace-aware Saxes parser: XML prefix spelling is not semantic behavior.
- The presentation workflow preserves exact source dimensions: x=1 inch,
  y=2 inches, width=3 inches, height=1 inch, two rows and two columns. Independent
  serialized package text and reopened grid dimensions are asserted.

## Research accounting and language mapping

Research row `upstream-test-inventory.json#/bdd_cases/688`,
`features/shp-shapes.feature:296`, expands `SlideShapes.add_table()` with those
2x2/dimension values. The source terminal step reopens the archive and checks
`has_table`; it does not invoke a renderer. New original test:
`packages/pptx/src/slide-creation-workflows.test.ts`,
`saves a newly inserted table through its presentation owner`.

The API inventory source ID `pptx.shapes.shapetree.SlideShapes.add_table` maps to
`SlideShapes.add_table(rows: number, cols: number, left: Length, top: Length,
width: Length, height: Length): GraphicFrame`. Numbers must be bounded positive
integers; geometry validation reuses the existing table codec. The model mutation
is synchronous, while Presentation loading/saving remains asynchronous. Array-like
collections retain their documented JS adapters. No reference assets or source
implementation text were copied; required standalone legal notices remain intact.

`Slides.add_slide` is still absent: the current `Slides` collection is initialized
from a fixed loaded slide list, while creation requires layout/owner-graph support
not supplied by this bounded table change. It remains an unsupported public API.
The authored setup uses `createPresentation` to provide its initial blank slide,
which does not establish a complete factory/add_slide guide workflow.

## QA

Renderer inspection not run; no visual fidelity claim is made. Future disposable
QA follows `docs/pptx/corpus-manifest.json`: inspect a newly inserted 2x2 table at
1/2/3/1-inch geometry and grouped table bounds. Keep inputs in the ignored owned
cache, record actual renderer/status here, and reduce meaningful findings into
small original regressions. Do not execute the whole pipeline.

Final focused scope adds Strict namespace assertions, invalid column counts and
zero-extent rejection. The original invalid-subcell expectation exposed an existing
shared-codec gap: positive totals can divide into zero-width/height cells, contrary
to §6.3. This is recorded in the [API receipt](../pptx/table-creation-model-evidence.md),
not counted as a passing conformance assertion. No shared codec change is included.
Root runs final maintained package checks after the 13 focused tests pass.

## Maintained verification receipt

- `npm run test --workspace=pptx`: 256 files, 6,776 tests passed (67.91s).
- `npm run lint --workspace=pptx`: ESLint and both typechecks passed.
- `npm run build:workspaces -- --workspace=pptx`: all three declared closure builds passed.
- Two paired safe-bash creation cases passed after the build; final runtime 0.740s.
  The maintained source/test typecheck passed after correcting nullable test assertions;
  all 26 consumer groups passed. See [CLI receipt](pptx-table-creation-cli.md).
- Scoped Prettier and whitespace checks passed. No push, release or renderer run.
