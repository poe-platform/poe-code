# Chart inspection draft usage

`pptx charts list deck.pptx --json` enumerates existing charts. Narrow the result
with `--slide 1`; `pptx charts get deck.pptx --slide 1 --shape 'Activity chart'
--json` requires one chart. Shape selection uses an exact case-sensitive name,
not a shape ordinal. The shared `--select` token is an alternative to explicit
scope/slide/shape selectors. Only slide scope is currently supported.
`--limit maxBytes=65536` lowers a trusted byte ceiling; it is not pagination.

`pptx schema charts list` and `pptx capabilities` describe the supported command
surface. The read result uses the common structured envelope, reports no affected
objects, and includes chart location and selection token.

Each chart includes plot kinds, series and category data sources, axes, titles,
labels, point formatting, markers, legends, style metadata and relationships.
Classic combinations retain multiple plots. XML details preserve qualified
names, attributes, children and raw markup. Modern and unrecognized structures
remain available with unsupported metadata.

Data sources distinguish literal values from referenced cached values and expose
formula strings, cache format, declared point count, explicit point indices and
hierarchical category levels. Missing indices are retained as gaps. A reference
cache is an observation; it does not establish that the workbook still agrees.
Links identify workbook/style/color-style targets and whether they are external.
No workbook opens, calculations, external refresh or network access occur.

This is read-only inventory. It reports existing XML rather than materializing
model defaults or editing chart data. Full live chart model APIs and chart data
replacement remain separate capabilities. Input bytes or paths need the normal
explicit SDK byte/VFS context; a path does not grant host filesystem authority.

The package also exposes the same inventory directly:

```ts
import { readCharts } from "pptx";

const charts = await readCharts(inputBytes, { slide: 1 }, context);
```

`context` supplies the explicit byte, archive, XML, relationship and selection
capabilities/limits. The result is a readonly array of chart records. The SDK
operation is `readCharts`; it does not claim a live `Chart` object model.

`inspectChart(xmlPart)` is the synchronous lower-level parser for an already
admitted `XmlPart`. It returns the same chart content fields without presentation
locations or resolved relationships. Use `readCharts` or `charts list/get` when
package ownership and relationship metadata are needed. The exported record
interfaces describe snapshots, not live mutable chart objects.
