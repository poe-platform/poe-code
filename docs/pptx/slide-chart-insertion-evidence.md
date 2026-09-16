# Slide chart insertion contract

The public `SlideShapes.add_chart` inventory record declares positional chart
type, x/y/cx/cy `Length` geometry and chart-data builder input. The reconciled D02
return is `GraphicFrame`, correcting the source annotation. The implementation
retains that neutral spelling and positional order and returns synchronously.
`CategoryChartData`, `XyChartData` and `BubbleChartData` flow through the existing
`toChartData` conversion and chart validator; no second chart writer is added.
The existing accepted named chart-type union is also an explicit JS convenience.

The presentation owner calls `insertChartIntoState`, the same engine used by
`addChart` and `charts add`. That helper stages validated chart/package changes
before applying them. Workbook members stay in the explicit pending registry
until async save serializes them. The owner's revision advances after successful
insertion, preserving publication race protection. Unsupported inputs fail
before committing package state.

Original `slide-chart-insertion-contract.test.ts` cases cover synchronous live
frame identity, category caches, a live legend edit, `replace_data` before the
first save, successful workbook-backed reload, two pending chart allocations,
invalid geometry rollback and grouped rejection. It invokes the existing CLI
route with memfs reads/writes:

`pptx charts add INPUT --slide 1 --type COLUMN_CLUSTERED --data JSON --left 1in --top 1in --width 4in --height 3in --output OUTPUT --json`

CLI one-based slide selection maps to the selected SDK collection's zero-based
owner; geometry is explicitly converted from `Length` to EMU once. Both surfaces
create the same chart cache values using original content. Public factory/save
remain async; no ambient I/O or native runtime is introduced.

Explicit limitation: `group.shapes.add_chart` fails with `unsupported-edit`
before mutation. The existing live chart owner resolves top-level frames, so
claiming grouped parity would be false. All inherited `_BaseGroupShapes`
obligations remain in the denominator. Unsupported chart variants retain existing
validation limits. No whole-chart/public-API coverage claim is made.

Red evidence: missing-method failures before implementation. First focused green
run: 2 original tests passed in 210 ms; expanded checks recorded below when done.

Validation: expanded insertion suite passed 3 tests in 221 ms. The combined
seven-file run passed 35 tests (chart insertion, shape/slide ownership, rich
placeholders, chart builders, replacement and command contracts).
`npm run lint --workspace=pptx` passed ESLint and production TypeScript; test
TypeScript remained blocked only by another worker's concurrent red layout and
add-slide tests. No full lint pass is claimed at this checkpoint. `git diff
--check` passed.

Argument refinement: an additional original red/green case proves non-Length
geometry, a non-number/string chart type and missing/plain-object chart data
raise neutral `TypeError` / `invalid-type`, while an unsupported enum number
raises `ValueError` / `invalid-value`. Raw data records belong to the operation
API, not this builder-only model method. All failures preserve the saved package.
The final focused insertion suite passed 4 tests in 214 ms.

Final integration supersedes the temporary test-type blocker: the root owner
reported passing package lint/build and 6,871 maintained package tests, plus
16 final focused and 239 safe-bash integration cases. No grouped chart or full
public API claim follows.
