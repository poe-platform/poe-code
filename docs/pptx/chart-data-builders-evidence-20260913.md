# Chart data builders: evidence and language mapping

This receipt supersedes historical statements that detached data builders are absent.
The [API ledger](chart-data-builder-api-map-20260913.json) enumerates all 189
`chart.data` inventory records, including inherited members, constructors and
sequence protocols. The [source-case ledger](chart-data-builder-case-map-20260913.json)
retains all 88 test-data source cases. The source-case ledger records traceability;
it is not a claim that source mock implementations were ported verbatim.

Original behavior is exercised in `chart-data-model.test.ts` and
`chart-builder-insertion.test.ts`: categories with hierarchy, uneven-depth errors,
leaf positions and levels; homogeneous numeric and UTC date labels; date epoch
leap discontinuity; point/series/data number format inheritance; independent XY
and bubble lengths; zero/null values; workbook coordinates and escaped cell
content; point-specific worksheet styles; ownership errors; numeric access,
negative indexes, membership/count, reverse traversal, directional stepped slices,
and input/output ownership. Workbook writes in tests use memfs or isolated bytes.

`CategoryChartData`, its documented `ChartData` alias, `XyChartData`, and
`BubbleChartData` retain their neutral names. Constructors default number format
to `General`. Series/point `null` formats inherit from their owner; explicit
strings override that default. `Categories.number_format = null` clears its
local override; dates default to `yyyy\-mm\-dd`, other labels to `General`.
Readonly member assignments do not mutate live storage. Sequence array storage
is private in a WeakMap, hierarchy and builder selection state use private fields,
and data points are immutable values with a readonly owner.

Source dates become defensively copied UTC `Date` values. Invalid dates and
nonfinite numbers fail with typed value errors; incompatible input types fail
with typed type errors. Excel serial conversion uses UTC calendar days, ignores
time-of-day, includes the 1900 leap discontinuity, and supports the explicit 1904
epoch. Date category intent remains ISO UTC text in operation records so the
shared chart writer selects a date axis; workbook output contains numeric serials.
Hierarchy labels must be strings, with uniform depth checked on hierarchical
queries and serialization. Returned levels are leaf-first readonly arrays of
`[leafIndex, label]`; worksheet levels are outer-first with null continuation cells.

Source byte/property I/O maps deliberately to `await data.xlsx_blob(context,
date1904 = false)`: the explicit trusted context supplies archive, XML and byte
limits, cancellation and no ambient filesystem. `xml_bytes(chart_type)` remains
synchronous and returns fresh `Uint8Array`; accepted enum values and symbolic
creation names route through the shared chart serializer. It rejects unsupported
chart variants using the shared declared creation coverage. Detached builders do
not expand the chart writer's variant subset. The current writer admits all 29
previously recorded supported variants; remaining enum variants remain visible
in the chart variant ledger and cannot be counted as whole-API conformance.

`to_chart_data()` emits a detached typed operation snapshot, and `toChartData()`
normalizes a builder or an already typed operation record. Placeholder
`insert_chart` uses this bridge and the existing insertion engine. CLI JSON uses
the same record fields, including `pointNumberFormats`, with schema validation.
The XML and workbook writers share data semantics and preserve explicit point
formats; no second chart editor, native runtime or implicit network is introduced.

`chart-replacement-model.test.ts` additionally proves synchronous live
`Chart.replace_data`, bounded `Chart.part`, repeated replacement before and after
save, preservation of chart style, and workbook/cache agreement after reopen.
The asynchronous presentation boundary admits owned chart workbook bytes once;
replacement uses the shared preserving data mutation helper, prepares workbook
members synchronously, and defers ZIP encoding to save. Failed admission remains
an explicit replacement error. Cancellation/resource limits are never hidden.

## Pinned-source drift reconciliation

[Data-model source](https://raw.githubusercontent.com/scanny/python-pptx/278b47b1dedd5b46ee84c286e77cdfb0bf4594be/src/pptx/chart/data.py)
confirms that inherited category X/Y access attempts missing point coordinates.
These getters return an empty array for empty series and a typed
`PropertyAccessError` otherwise. Category values remain available through
`values`; labels through `categories`. Null series names/category labels read as
empty strings. `numeric_str_val` returns date serials with one decimal; its null
spelling maps to JavaScript `"null"`. The exact date format default is
`yyyy\-mm\-dd`. Subcategory `index` returns the global leaf offset. Original tests
cover each correction; the missing-coordinate members remain public and are
classified as documentation errors with explicit equivalent APIs.

[Workbook source](https://raw.githubusercontent.com/scanny/python-pptx/278b47b1dedd5b46ee84c286e77cdfb0bf4594be/src/pptx/chart/xlsx.py)
confirms no category `x_values_ref`/`y_values_ref` methods. Their inherited calls
map to `PropertyAccessError`; use `categories_ref`/`values_ref`. Source XY/bubble
series use vertical worksheet tables. The shared target writer uses adjacent
column pairs/triples; all public reference helpers, XML formulas and workbook
cells agree on this deliberate storage mapping. Imported vertical layouts remain
supported by the existing ownership/range admission and replacement engine.

Replacement admission shares one aggregate expanded-byte/member budget across
all embedded chart workbooks. An original compressed-workbook case first exposed
per-workbook-only budget reuse, then passed after aggregate enforcement. Opaque
workbooks still round-trip unchanged unless replacement is requested.
