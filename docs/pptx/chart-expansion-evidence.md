# Chart expansion research and validation receipt

The pinned writer dispatch and specification Appendix B both enumerate 29
creatable types. The previous 19-type receipt is a historical implementation
checkpoint, not a reason to drop area, doughnut, radar or bubble tests.

The [case map](chart-expansion-case-map.json) retains all 1,407 prior chart rows
(995 unit variants and 412 expanded scenarios) with exact inventory, parameter
and scenario pointers. Its separate 29-row variant register specifies independent
XML obligations without equating factory dispatch with writer behavior. The
[API map](chart-expansion-api-map.json) retains all 784 chart-related declarations,
including inherited members, enum aliases, constructors/helpers, collections,
underscore-prefixed public types and members without upstream tests. No complete
live-model parity is claimed by these bounded operations.

## Pinned behavioral findings

Source: `src/pptx/chart/xmlwriter.py` and `tests/chart/test_xmlwriter.py` in the
research checkout at commit `278b47b1dedd5b46ee84c286e77cdfb0bf4594be`.
The writer hash is retained in the case map. Existing pinned provenance and the
required MIT notice remain in [the audit](upstream-test-audit.md) and
[standalone notice](upstream-license-notice.txt). No source snippets or binary
fixtures were copied into product tests by this accounting work.

Area, bar and line have distinct date and numeric category writer examples.
Hierarchical bar categories include missing values in two series: flattening them
into ordinary labels would lose category level order, parent boundaries, workbook
column offsets and sparse cache indices. Category hierarchy must therefore remain
a distinct obligation. Date-system tests must distinguish 1900 leap-day
compatibility and the 1904 epoch; radar's writer retains a category axis while
area/bar/line select a date axis for dates.

The writer routes radar filled and radar markers even though the dedicated full
radar XML test only covers plain radar. Those variants require original assertions
rather than being excluded for lack of upstream tests. Plain radar uses marker
radar style plus per-series symbol `none`; filled uses `filled`; marked radar uses
`marker` without suppressing the series marker. Bubble's 3D effect is a per-series
boolean decoration, not permission to construct general 3D charts.

The two doughnut writer examples each use two series. Section 6.6 of the current
format contract requires exactly one series for pie/doughnut. The integration
scope retains that contract: the two multi-ring cases remain explicitly
unsupported, not relabeled as covered by one-ring assertions. The exact case IDs
are recorded in the map. Combination, chartEx, general 3D, trendline, error-bar,
external workbook and unknown-extension reconstruction retain preservation and
explicit rejection requirements.

## Shared behavior and JavaScript mappings

The [counterpart test audit](../docx/upstream-test-audit.md) and
[counterpart API audit](../docx/upstream-api-audit.md) confirm shared OPC/XML/image
obligations: deterministic part/relationship ownership, content-type correctness,
namespace-preserving structural edits, bounded original in-memory inputs and
unchanged unrelated parts. Their reference-runtime passes provide no evidence for
this product's chart behavior. Embedded workbook ZIP/XML is admitted through the
same bounded package mechanisms; formulas and external links stay inert.

Neutral snake_case model properties/methods remain the primary model contract;
operation JSON independently uses camelCase. Admission/save are always async;
admitted in-memory model builders and scalar operations are synchronous. Direct
operation results are detached bytes/snapshots, not live model objects. Model
collections use checked zero-based positions, iterator/length and only explicitly
supported slicing; CLI selectors are one-based and owner-scoped. Chart points
reject negative positions. Absence/inherited null is distinct from false, zero
and empty text. Typed UTC Date values belong to the model; direct operation data
uses explicit UTC-Z strings and no ambient clock. Creating title/text getters
remain live-model side effects; inspection never creates XML.

Public `element`/`part` and inherited XML helpers remain bounded public view
obligations, not private exclusions or unrestricted host/XPath access. No implicit
host paths, external fetch, workbook calculation, embedded activation or accessors
on untrusted input objects are authorized. The per-member map retains exact
target signatures, defaults, return values, error profiles, ownership, side
effects, enum XML values and J01–J10 rules from the reconciled baseline.

Documentation drift is explicit: insertion returns GraphicFrame, not the incorrect
source Chart annotation; published/source versions differ; old audits describe
checkpoints; expanding direct operations does not implement Categories/Category
builders or complete the public API. CLI remains plural `charts`, backed by SDK
operations with shared schema/capabilities, selectors, flags, envelopes and exit
statuses. Common resources remain `images`, `tables`, `properties`, and literal
format-preserving replacement remains `text replace`.

## Execution status

Research/accounting files were generated from the existing parsed JSON registers
and inspected pinned writer/test source. Final maintained checks and visual
receipts appear below, after the chronological focused results. No upstream count has been
reported as a new product pass. No temporary fixtures were deleted or shipped by
this accounting task. QA procedures are in
[the plan](../plans/pptx-chart-expansion.md), not in executable QA scripts.

The workbook owner reports seven new original memfs cases in
`chart-data-expansion.test.ts` passing alongside ten existing workbook cases
(914 ms suite). The first six new cases failed before implementation: hierarchy
was not iterable, bubble size cells were missing, and number-format styles were
absent. The seventh additionally verifies linked styles creation. These assertions
cover outer-before-leaf worksheet columns, sparse values, adjacent bubble triples,
zero sizes, series length differences, inherited/overridden formats and both date
systems during style-preserving replacement. This is focused owner-reported
evidence preceding the maintained integration gate below.

Accounting verification resolved 6,201 JSON pointers and confirmed unique totals
of 29 variants, 1,407 cases and 784 API records. This checks reference integrity
only; it does not upgrade any source row to full parity.

Exact number-format reconciliation: the pinned workbook writer uses the dataset
format for XY x and bubble size cells, and the series override for y. Its cache
writer instead uses the series format for all x/y/size caches. The direct
operation deliberately uses dataset x/size and series y consistently in both
workbook and cache. This resolves an internal source discrepancy but is a scoped
behavioral divergence, not exact parity for override cases. Per-point model
format inheritance remains outstanding. Marked series similarly select an
explicit circle where the source leaves the marker symbol to defaults; visible
markers are supported without claiming theme-selected marker equality.

The revised operation contract admits outer-to-inner `categoryLevels`, bounded
to 64 levels and 250,000 slots. Full adjacent parent paths define category spans,
including a fresh boundary when an ancestor changes. XML levels are leaf-first;
workbook columns remain outer-first. This operation representation does not
implement the documented owner-bound Category/Categories constructors and
protocols. The format and shared SDK specifications remain proposed authority.

A subsequent workbook regression reproduced General-formatted values inheriting
an imported custom percent default style. Explicit numFmtId 0 cell formatting
fixed it. The workbook owner reports eight new plus ten existing workbook cases
passing in 724 ms after that fix. Earlier seven-case counts are chronological
focused receipts, not the final gate count.

The domain owner reports 92 `chart-family-expansion.test.ts` cases passing in
722 ms. Its initial run failed 18 and passed 10: all ten missing variants plus
hierarchy, global formats and date metadata supplied concrete failure evidence.
Subsequent original regressions separately reproduced execution of an untrusted
hierarchy length accessor, cache/workbook date-epoch disagreement, and loss of
bubble 3D decoration when replacement grows the series. Each passed after its
corresponding fix. The combined four focused chart files passed 178 cases in
2.11 seconds. The family file includes independent numeric/hierarchy and both
1900/1904 assertions for all 22 category variants, ten new plot-style cases and
ten create/set/workbook integration variants. The older independent variant file
covers the remaining 19 symbols, giving explicit assertions for every one of the
29 creatable types. Factory rows link these bounded assertions without upgrading
full source writer or live-model parity. Maintained integration remains the
integrating owner's separate receipt.

## Final integration verification

`npm test --workspace=pptx` passed 3,552 tests in 125 files (42.77 seconds).
This was followed by two new original regressions for imported cell styles with
`applyNumberFormat` set to `0` and `false`. Both initially failed; replacement
now avoids disabled or incompatible styles and appends an enabled plain style,
preserving the imported definitions. The final focused five-file run passed
145 tests, including all ten workbook-expansion cases, ten existing workbook
cases, 92 family cases, 18 preservation cases and 15 command-editing cases.
The full-package count predates those final two cases; it is not presented as a
post-fix full-suite run.

After the final fix, `npm run lint --workspace=pptx` passed ESLint and both
TypeScript checks, and `npm run build:workspaces -- --workspace=pptx` passed the
three builds in the maintained selected closure. The maintained safe-bash
reporter route passed all six chart editing/inventory shell cases against the
rebuilt package, with zero skips or failures. No safe-bash source was changed.
The specification checker passed with zero warnings. Shared command schemas,
help and capabilities advertise the expanded variants and data fields; the
eleven new command assertions initially failed before the implementation.

The maintained generic terminal screenshot route captured and the integrating
owner visually inspected `charts add --help`: all 29 types, geometry/output
requirements, category/scatter/bubble examples and hierarchical/format/date
options are readable. An initial capture used an invalid empty QA context and
was corrected to supply explicit limits; this was a QA invocation error, not a
product defect. The disposable screenshot remains under `.cache/pptx-corpus`.
No slide renderer was used, so this is terminal-output review, not rendering
fidelity evidence. No downloaded or cloned binary became a test dependency.

Post-rebuild public SDK QA created and replaced all 29 variants (58 operations)
with original in-memory data. Independent nested ZIP/XML assertions checked
chart caches and workbook cells, hierarchy ordering, sparse y positions, number
formats and bubble zero sizes. This used the built package exports, wrote no QA
files and introduced no publisher or cloned fixture dependency.

Only chart-owned paths and chart hunks in shared command wiring are included in
the local delivery. Existing image work, unrelated plans and disposable files
remain outside it. No README edit, push or release was performed.
