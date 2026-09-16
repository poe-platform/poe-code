# Chart inventory evidence and boundaries

This receipt covers the bounded F36 inspection operation. It does not complete
chart creation, workbook-backed replacement, local model setters, or the full
chart/axis/series/point/legend object API required by the specification.

The [case ledger](chart-inventory-case-map.json) retains 1,407 individual source
rows: 995 unit variants and 412 expanded BDD scenarios. Selection includes all
955 `tests/chart` variants, nine chart-part variants, 31 adjacent chart-format or
chart-bearing shape variants, 363 chart-specific BDD rows and 49 adjacent BDD rows.
Exact original fixture bindings and assertion/exception evidence remain linked;
source identities are research only. A linked inspection assertion is partial
observable behavior unless every source outcome is independently established.
Deferred rows are outstanding obligations, never counted as passing parity.

The [API ledger](chart-inventory-api-map.json) retains 784 chart-related records,
including inherited members, underscored types, constructors, collections,
helpers and enum symbols. It preserves target signatures/defaults, errors,
side effects and JS mappings from the reconciled public register. Full chart model
APIs remain explicitly deferred; flat inspection does not replace them. Shared
returned formatting/text interfaces remain obligations in the full register.

Raw numerical strings preserve precision, point indices and error text. Literal
chart data is authoritative local content. Referenced data names its formula and
carries cached observations that may be stale; inventory does not open embedded
workbooks, evaluate formulas or prove cache/workbook consistency. External links
are inert relationship metadata. Displayed defaults and theme inheritance are
not inferred from absent XML.

Source getter review found important non-equivalences: title, label, font and
point-format access may create nodes; inventory reads must not. Series caches can
have absent containers, zero point count, gaps and reversed XML point order.
Legend overlay absent/empty defaults true and position absent/empty defaults
right in the live model. Axis tick marks absent/empty default cross and label
position defaults next-to-axis. Data-label boolean empty elements default true,
while an absent show-value/category flag defaults false. Those model defaults
remain obligations unless explicitly implemented and independently tested.

Published documentation/version drift and erroneous chart insertion return
annotations are resolved in the API receipt: insertion returns GraphicFrame,
not Chart; model collections have their documented index/slice rules, not generic
Array semantics. Historical audit statuses describe their checkpoint and are not
current operation capability declarations.

Original TS tests use independently authored in-memory markup. Existing standalone
MIT notices remain retained; no copied chart fixture or reference branding is
introduced in product assets. Procedures and QA instructions are confined to
[the plan](../plans/pptx-chart-inventory.md).

Original characterization suite `chart-inventory-values.test.ts` passed 49 cases
in 16 ms using an explicit isolated Vitest invocation. Cases cover all nine
category-series cache shapes, three axis kinds, absent/empty/explicit tick fields,
scale values, orientation, gridlines, five label flags across six lexical states,
number formats, legend position/overlay/offset, and point-label presence. These
assert raw observations; model enum/default/numeric/collection semantics remain
deferred. Integrating owner records broader maintained checks and corpus QA.
No release or push is authorized.

## Verified integration

Maintained `npm test --workspace=pptx` passed 3,337 tests across 118 files.
The new slice contains 31 parser/SDK cases, 49 characterization cases, one
preservation case and ten command admission/discovery cases. Five registered
safe-bash memfs tests cover actual shell dispatch, SDK/CLI equality, schema
validation, successful empty reads, token replay, missing/ambiguous selection
with candidate locations, lowered limits and readable human output.
Maintained package lint and the selected `pptx` workspace build closure passed.
The exact safe-bash integration discovery registration check passed.

The independent ZIP/XML census of the manifest-authenticated
`data-visualization-course.pptx` found eight chart parts: seven classic charts and
one modern chart. SDK and CLI JSON agreed on eight records, 18 classic series,
12 axes, 54 formulas, 160 indexed cached points and eight authoritative workbook
relationships. The original SHA-256 stayed
`ce874bc9782258175b84f5e438123552b78c993e0add9015f35d8ca2dd5c45d2`.
Workbook content was not evaluated or opened. Modern chart contents stayed opaque
with explicit unsupported metadata. This census is not a rendering-fidelity test.

QA exposed a missing style fallback: the first classic chart initially reported
null despite an explicit fallback style 2. A tiny original case with unsupported
style 110 and fallback 10 reproduced the issue before the correction; corpus
reinspection now reports 2. Visual QA also exposed a megabyte-scale human JSON
dump. An original shell assertion now requires concise readable output without
chart XML; complete metadata remains in `--json`.

The original memfs preservation case performs an unrelated text replacement.
An independent ZIP reader verifies every other part byte-for-byte, including
opaque chart extension whitespace/comments, the embedded workbook payload and
external relationship targets. Chart XML and links match on reinspection and
the caller's original input hash stays unchanged. No publisher asset is used by
these unit tests.
