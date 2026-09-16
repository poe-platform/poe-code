# Table creation model receipt

`SlideShapes.add_table` now inserts a live table through the existing table codec
and shape-owner append path. This closes one neutral public method; it does not
complete the presentation creation object graph.

## Exact API mapping

Inventory source ID: `pptx.shapes.shapetree.SlideShapes.add_table` in
`upstream-api-inventory.json`; documented source signature:
`(self, rows: int, cols: int, left: Length, top: Length, width: Length, height: Length) -> GraphicFrame`.

Target signature:
`SlideShapes.add_table(rows: number, cols: number, left: Length, top: Length,
width: Length, height: Length): GraphicFrame`. All six arguments are required;
there are no defaults. It returns synchronously and mutates the owning slide XML.
The returned frame/table/cells stay live; group owners also recompute their bounds.
IDs are unique within the owning slide, including nested groups.

The method retains neutral spelling and typed lengths. At the runtime boundary,
the shared codec also admits a closed stored `{ value, unit }` object with units
`emu`, `in`, `cm`, `mm`, `pt`. Bare numeric geometry is rejected. Rows and columns
must be safe integers in 1..250000, with at most 250000 cells total. Geometry uses
bounded safe-integer EMUs (absolute maximum 27273042316900); total width/height
must be positive. Invalid arguments throw a synchronous typed `OfficeError` with
code `invalid-value`; tested invalid counts and zero extents leave owner XML
unchanged. Other existing owner/resource checks remain effective.

CLI mapping: `pptx tables add input.pptx --slide 1 --rows 2 --columns 2 --left 1in
--top 2in --width 3in --height 1in --output output.pptx`, using the same table codec.
The CLI cell selector is one-based; the model `table.cell(row, column)` is
zero-based. Saving/loading remains asynchronous with explicit byte/capability I/O.
No host I/O, font discovery, native process or network behavior was introduced.

## Independent original assertions

`packages/pptx/src/slide-creation-workflows.test.ts` covers synchronous returned
frame identity, 9x7-EMU 2x2 remainder distribution, saved XML text through a
namespace-aware independent Saxes parser, retained live cell edits, invalid row
and column counts, zero dimensions, slide-wide group IDs and recalculated bounds,
Strict namespaces, and full Presentation save/reopen.

Exact workflow source: `upstream-test-inventory.json#/bdd_cases/688`,
`features/shp-shapes.feature:296`. Its source step payload is a 2x2 table at
x=1 inch, y=2 inches, width=3 inches, height=1 inch. The original new test
`saves a newly inserted table through its presentation owner` retains these
boundaries. The source final step reopens and checks `has_table`; it is not a
renderer assertion. Additional original text and geometry assertions strengthen
that semantic workflow. No external source fixture or implementation was copied.

## Open boundaries

`Slides.add_slide` remains absent, because the loaded slide collection currently
holds a fixed owner graph. The test initializes its blank slide with the existing
`createPresentation` byte API; it does not claim the factory/add_slide guide is
fully supported.

At this insertion checkpoint, the shared table codec admits a positive total extent smaller than the
cell count and divides it into zero-sized trailing cells. This is an existing
contract gap against `docs/specs/pptx.md` §6.3's positive row/column requirement,
not a new intended guarantee. It was concretely observed for a 1-EMU total extent
and two cells during this review; the add_table slice does not change that shared
behavior. Renderer QA remains unrun and no visual fidelity claim is made.

Maintained checks and paired CLI evidence are recorded in the
[insertion plan](../plans/pptx-slide-creation-workflows.md) and
[CLI receipt](../plans/pptx-table-creation-cli.md).

The later [positive-dimension correction](../plans/pptx-table-dimension-boundaries.md)
resolves the zero-cell admission gap above without rejecting unrelated edits to
imported zero-size grids. Its explicit stricter language mapping and regressions
are recorded separately from the insertion checkpoint.
