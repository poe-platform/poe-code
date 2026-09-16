# Bounded live Chart handle receipt

The rich-content insertion task requires GraphicFrame.chart to return a live
model. chart-model.ts now accepts explicit XML owner read/write capabilities;
no ambient I/O or network is used. Original chart-model.test.ts failed on the
missing module before implementation.

| Public target | Mapping and tests |
| --- | --- |
| `chart_type: XL_CHART_TYPE` | Readonly; first plot classifier from chart-editing; known creation families preserve enum identities, including exploded pie/doughnut variants |
| `chart_style: number \| null` | Read/write integer 1..48; null removes the direct style; tests preserve date-system and other chart XML |
| `has_legend: boolean` | Read/write; true creates only when missing, repeated true preserves exact existing legend XML; false removes |
| `element: XmlElementView` | Existing bounded XML view; stale XML views and invalidated owner handles fail deterministically |

Model appearance mutations and `setCharts` share `applyChartAppearance`; model
classification and chart data editing share `readChartType`. Combination chart
model reads select the first plot; existing data reconstruction still rejects
combination charts. Input and owner validation happens before state writes.

This is deliberately partial chart-model coverage. Titles, plots/series/axes,
legend object, format, font, part and replace_data remain visible obligations in
the overall API inventory; this handle is not whole-chart API completion.
The root's integration receipt records maintained checks and public exports.

Four original model cases pass, including runtime authority reflection. Owner
read/write capabilities use ECMAScript private fields; undefined assignment is
rejected rather than interpreted as an omitted operation option.

## Synchronous chart insertion

`SlidePlaceholder.insert_chart` is synchronous, as required by the shared SDK
contract. Only chart workbook ZIP serialization is deferred until async save;
chart, shape, relationship and content-type XML are prepared synchronously through
`insertChartIntoState`, also reused by asynchronous direct chart insertion.
`prepareChartWorkbookMembers` prepares original worksheet and related XML without
network, filesystem, compression or source-runtime calls. Existing workbook
replacement still admits existing bytes asynchronously, then uses the same pure
member preparation and archive writer.

A pending workbook part has reserved identity; its raw archive bytes are not yet
available until async serialization. Save and async image-insertion snapshots
flush deferred members first. This is a serialization lifecycle mapping, not an
async return mapping for model insertion. Whole workbook-part byte inspection
before serialization remains an explicit limitation.

Six original preparation tests verify synchronous values, eventual admitted
workbook serialization, cancellation, XML limits, archive bytes, individual member
bytes, total member bytes and member counts. The budget tests failed before
validation was added. Path/depth checks use the same explicit archive limits.
Chart XML parses under the current XML limits before staged insertion is committed.
Thirty-seven preparation/workbook/chart preservation cases passed after extraction;
root records the final integrated maintained checks and publication-free commits.
