# PPTX command coverage register

Status: Proposed command design; no product implementation or executed product tests.

[command-coverage.json](command-coverage.json) maps F01–F60 and all 2,424 rows of
the existing [public API map](public-api-map.json): the 2,407 reconciled upstream
records plus 17 bounded XML/package-view members. It declares 1,933 operations
and 6,321 planned acceptance cases. These are mixed bookkeeping counts, not an
implemented coverage percentage. The register preserves inherited members,
underscore-prefixed returned interfaces, enum symbols/aliases, constructors,
protocols, helpers and APIs without reference tests.

The shared [CLI](../specs/office-cli.md) and [SDK](../specs/office-sdk.md)
contracts govern naming, selection, options, JSON, errors and publication. The
[PPTX spec](../specs/pptx.md) governs format scope. Input hashes pin the exact
local documents reviewed, including the existing API/test audits and inventories.
No fresh published-site review or reference runtime execution is claimed.

## How to read a mapping

`features` gives each feature's required subset, operation IDs, noncreating
inspection route and original behavior/retention case IDs. `sdk` contains one
row per target API record, with exact target signatures and JSON pointers to
arguments/defaults, separate read/write/call effects, ownership, errors, upstream
test leads and original acceptance cases. Those pointers resolve into the pinned
public API map; they are not links to supposed product implementations.

`operations` is keyed by the exact operation ID. Each entry declares its logical
path, direct or typed-batch transport, input arity, closed argument schema,
applicable common options, help/schema route, result contract and tests. Direct
flags map to camelCase operation fields. Common option definitions live in
`commonOptions`; the per-operation list is authoritative for applicability.
`commonProfile` is descriptive, not permission to accept every flag in that group.
CLI geometry uses suffixed quantities; the JSON representation names value/unit.
A CLI file argument is a VFS path string; its JSON representation is an admitted
input descriptor. Capability objects are supplied explicitly by the adapter.

For example, `images.replace` exposes `pptx images replace INPUT --slide 3
--image 1 --file logo.png --in-place`. Its file/size/fit arguments and common
options are explicit. `_Cell.text` also has a typed assignment route, while
`tables set INPUT --slide 3 --table 1 --cell B2 --text 'Coastal survey'
--in-place` provides the ordinary edit. Whole-text assignment retains its
documented destructive scope. `text replace` remains the preserving literal
replacement operation with exactly one match cardinality.

Advanced model operation IDs retain the earlier public API map's proposed
spelling. They are literal tags in a closed union, not expressions. Their logical
paths are discoverable with `pptx schema PATH` and `pptx help PATH`; execution is
through `pptx batch INPUT --ops-file OPERATIONS.json`. Each typed item has
`operation`, `arguments`, an owner-checked `receiver` when required, and an
optional `resultHandle`. A receiver may refer only to an inspected live handle or
an earlier result in this batch. No operation accepts an arbitrary member name,
property path, JavaScript expression or extension dispatch name.

`$defs.BatchEnvelope` and `BatchItem` describe the closed envelope and operation
union using local JSON Schema 2020-12 references. `x-modelType` requires semantic
interface/ownership validation beyond JSON shape checking. Defaults, bounds,
selection, capabilities, cross-field rules and publication requirements also
remain semantic requirements; merely accepting a JSON Schema is insufficient.
Model result schemas describe the envelope's `data`; direct format reports now have closed `resultSchema` definitions, with exact
wire projections and semantic constraints in spec sections 6.1–6.8 and appendices
A–C. Runtime schema/export verification remains implementation work. This research
file is not a runtime schema bundle.

## Effects, preservation and rejected behavior

Creating model getters use their recorded effect contracts. Read-only `inspect`
uses noncreating queries. A batch that only reads values needs no output;
creating notes/titles/format definitions requires isolated mutation and one
validated publication, just like assignment. Bytes/dates are copies, returned
objects remain owned live handles, and rich placeholder replacement invalidates
the old handle. Deferred effects must not escape after a failure or cancellation.

`preservationOnlySubsets` explicitly maps opaque/unsupported content to inspection
and retention tests with a null editing operation. There is no SmartArt layout,
Morph, modern-thread, chartEx or font-editing command invented for preservation.
Documented scalar properties on an existing chart graph remain public API
obligations; they do not imply construction or rewriting of its unsupported
3D/combination substructures. Feature-level retention and SDK property-edit tests
must establish that distinction before implementation claims.

The chart-creation subset lists 29 exact enum symbols, statically checked against
`ChartXmlWriter` in the pinned research source. Its source span/hash is recorded.
All enum values remain discoverable, but values outside this creation subset fail
as unsupported edits. The bubble three-dimensional-effect variant is an existing
bubble decoration, not general 3D chart support. Source dispatch is evidence of
the reference subset, not evidence that target chart creation works.

No native renderer, host filesystem/font/time discovery, implicit network or
active media/action execution is part of these operations. All resource use is
bounded and charged cumulatively. Downloads and cloned binaries remain disposable
QA inputs, never canonical unit fixtures; meaningful cases must first become
small original in-memory tests before cleanup.

## Reconciliation decisions

D01–D18 from the earlier research remain visible through the API pointers and
additional drift records. In particular, chart/movie returns are corrected;
`PERCENT_40` and `SLIDE_IMAGE` remain available; cell coordinate and freeform
`close()` mistakes map to corrected recipes; and the source-absent documented
`follow_master_background` setter has a real proposed typed assignment route.
No unsupported API is hidden by a leading underscore.

The later public API map elaborates details left open by the earlier language
notes: supported slices include an explicit nonzero integer step; reserved
positional `default` binds as `default_value`; color/fill absence and notes
placeholder lookup use the D16–D18 corrections. The command register adopts these
exact mappings rather than reverting to the earlier incomplete signatures.

One earlier operation proposal needed separation: the asynchronous `Presentation`
factory's admitted input/context schema cannot overload the direct `create`
command's output/template schema. Its typed factory route is `presentations.open`
(with omitted input creating the original model), and direct `create` keeps the
shared CLI contract. This is a refinement of proposed routes, not a released
compatibility alias. Both must use the same model factory and publication engine.

The earlier map also retained a fictitious `.close` command for its corrected
freeform recipe, used `commandPath` fields inconsistent with the shared schema
command, and left the documented `PERCENT_40` case expecting null XML metadata.
C02–C04 in this register resolve those command-design defects: use the existing
`addLineSegments` operation with `close: true`, use schema path/type/member
discovery, report cell coordinates through `tables get`, and expect XML `pct40`.
The pinned earlier records remain historical evidence; these explicit corrections
govern the command bindings and case expectations.

## Evidence status

`tests` contains proposed command-contract cases and exact pointers to the
existing original SDK case descriptions. `implementationTest` is null and every
case is `planned_not_run`. Class/workflow references into the 2,700 unit variants
and 973 expanded BDD examples remain research leads, not reviewed equivalence or
new target passes. No source inventory was changed or test absence used to waive
an API obligation.

Agent verification procedures and actual documentation check results belong in
[the command coverage plan](../plans/pptx-command-coverage.md). No product code,
README, publisher document or cloned binary was edited or cleaned up.

## Format contract completion

The format specification now enumerates every direct operation, argument, option,
input cardinality, scope and publication class. The register adds exact direct
SDK option schemas and result schemas, diagnostic contexts, millisecond bounds,
conditional instant-effect defaults, chart-data cardinality requirements, local
EMU path rules and supplied SVG fallback admission. Shared names and flags remain
unchanged. The direct CLI admits the shared five length units; centipoints remain
a typed model helper. `images add --shared` was removed from the proposed register
because it has no insertion meaning; existing-resource shared replacement remains
explicit. Media insertion now requires its previously underspecified MIME type.

Twenty original TypeScript regression designs (`format.*`) describe independent
arrange/action/expected cases for these documentation findings. All are
`planned_not_run`; none is an implementation or source-test equivalence claim.
The complete original source-row ledger remains unchanged: every parameter and
BDD example is individually accounted for, including its visible unfinished work.
Required standalone notices are retained. No original assets were taken from
disposable corpus documents.

Current verification and input hashes are recorded in
[the format contract plan](../plans/pptx-format-contract.md) and
[the documentation receipt](format-contract-evidence.json). Historical checks
above remain historical; expanded signatures and schemas do not turn prior
research counts into product passes.
