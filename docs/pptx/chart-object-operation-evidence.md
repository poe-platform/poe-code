# Chart objects: SDK and command integration

The format package owns the live graph, builders and shared drawing/text behavior.
The existing `charts set` SDK/command operation now accepts `objects`, an ordered,
bounded array of discriminated records. `--objects JSON` uses the same schema and
validation. There is no arbitrary method evaluation or property-path dispatcher.

Targets enumerate chart appearance, chart/axis titles, legend, category/value axes,
tick labels, plots, series, points through marker/data-label/format selectors,
data-label collections, fonts and drawing format owners. Model methods retain
neutral snake_case names. Operation fields are camelCase; enum assignments use
registered symbolic names. Typed format operations share fill/color/line/shadow
serialization. Font operations share the existing Font and FillFormat models.

`--slide` retains one-based display positions and existing scoped shape/token
selection. The `objects` records explicitly use zero-based model plot/series/point
indexes, as documented in generated help/schema. Unknown fields, sparse/accessor
arrays, hidden fields, invalid values, unsupported subtype assignments and missing
owners fail. Data-only validation occurs before document admission. The SDK
returns new bytes; commands publish only after every edit and package validation
succeed. A later failed object edit leaves inputs and destinations unchanged.
Read-only `charts list/get` keeps its noncreating XML inspection path.

Public exports include CategoryChartData, ChartData, XyChartData and BubbleChartData.
The operation-record type is ChartDataInput. The `chartData` and `chart` namespaces
retain both distinct Category/Categories interfaces without inventing conflicting
root aliases. ChartObjectUpdate is a typed discriminated union. Every graph member,
constructor mapping and variant is accounted for by the linked ledgers rather
than by a claim that the historical test count establishes JavaScript parity.

- [Live graph member ledger](chart-live-graph-api-20260913.json)
- [Graph case traceability](chart-live-graph-cases-20260913.json)
- [Builder and workbook mappings](chart-data-builders-evidence-20260913.md)
- [42 shared drawing member dispositions](drawing-chart-api-dispositions.json)
- [All 73 imported chart variants](imported-chart-type-map.json)
- [Inherited font operation evidence](chart-font-operation-evidence.md)
- [Independent adversarial graph review](chart-model-independent-review.md)

Original `command-charts-editing.test.ts` failed on the absent object schema before
implementation, then passed legend, font, scale, gridline, plot and label edits,
plus later-failure atomicity. Schema/security and public-export tests likewise
failed before their implementation. The full chart data replacement editor was
extracted as a synchronous domain operation, preserving its existing formula,
workbook, namespace, series identity and unsupported-content checks. The command
and live model both reuse it; ZIP encoding remains at asynchronous save/publication.

No downloaded deck, publisher document, reference binary or cloned runtime was
used as a product fixture. No corpus cleanup was performed. Original tests use
explicit memory bytes and memfs. No product host I/O, native runtime, clock,
implicit network, renderer or formula evaluator was introduced. Read-only imported
classification does not expand the specification's 29 creatable variants.
Historical fixture IDs lacking payload evidence remain explicitly unverified;
this receipt does not claim literal source-runtime or whole-format parity.

Agent QA procedure and final maintained-check results belong in
[the integration plan](../plans/pptx-chart-object-completion.md). The maintained
generic screenshot route captured actual `charts set --help` output; the inspected
PNG at `.cache/pptx-chart-object-help.png` is legible, names the new flag and index
contract, and is disposable rather than a committed screenshot test.
