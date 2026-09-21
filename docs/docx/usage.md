# DOCX usage and availability

Verified 2026-09-21 against the local workspace. The utility is a bounded OOXML
editor, not a Word renderer or a complete document object model. The durable
[format contract](../specs/docx.md), [shared CLI](../specs/office-cli.md) and
[shared SDK](../specs/office-sdk.md) remain proposed beyond qualified subsets.
[Acceptance](acceptance-matrix.md) distinguishes evidence from declarations.

## Imports and execution

The private `docx@0.0.1` workspace is TypeScript ESM, with `dist/index.js` and
`dist/index.d.ts`. The root manifest does not export `poe-code/docx`; that import rejects with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. There is no
standalone `docx` bin in either manifest and no public installation promise.
The root Node engine is >=18.18; this verification ran Node 22.22.2. Browser/worker
bundling has bounded evidence in [whole API acceptance](whole-api-acceptance.md);
it is not a runtime or Word application qualification.

```js
import { parseDocxArguments, getDocxDiscovery, createDocxInspectionCommandEngine } from "docx";

const bytes = (value) => new TextEncoder().encode(value);
const invocation = parseDocxArguments(["schema", "text", "replace"].map(bytes));
const discovery = getDocxDiscovery(invocation);
console.log(discovery.data);
```

`parseDocxArguments` takes `readonly Uint8Array[]`, not strings.
`getDocxDiscovery` is synchronous for no-input discovery. Input capability
inspection, admission, image factories, utility edits and publication are async.
Admitted immutable values and live document-owned models have synchronous access.
The [verification manifest](usage-verification.json) lists checked named exports.
Imports were resolved from the built workspace; no registry install was performed.

`createDocxInspectionCommandEngine({limits, documentLimits?})` requires explicit
ArchiveLimits. Its async `execute(request)` takes byte args, cwd, supplied VFS,
stdin/stdout/stderr capabilities, AbortSignal and optional cleanup registration.
`createDocxCommand({engine, replace?})` and `docxCommands({engine, replace?})`
come from `@poe-platform/safe-bash/commands/docx`; replace defaults false and only
controls command registration collision handling. The caller must inject the
engine into a Shell. This adapter import was resolved from the current local
workspace; its package manifest includes unrelated working-tree changes. The old
`poe-code/safe-bash/commands/docx` root subpath is not exported. Neither import
check qualifies a packed install or root CLI integration. A command declaration does not grant filesystem access.

These command paths were parsed successfully through the public parser; they
are examples for an explicitly registered shell, not a host-installed binary:

```sh
docx inspect draft.docx --json
docx text replace draft.docx --find Draft --with Final --first --dry-run
docx images list draft.docx
docx tables list draft.docx
docx properties list draft.docx
docx schema text replace
docx help images add
```

Table selectors and structural indexes are 1-based: `--table 1 --cell B2`
selects the second column of the second row. `tables set --text VALUE` replaces
that cell's value and runs; formatting-only `tables set` retains its text.
Use `text replace` for preserving replacement within existing runs. Setting a
cell never grows a table. `tables rows add --index N` and `tables columns add
--index N` insert blank rows/columns before N; count+1 appends, as does an omitted
insertion index. The corresponding `remove` commands require an existing index.
All edits require `--output` or `--in-place`, except `--dry-run`.
Whole-cell replacement rejects fields, nested tables and removal of annotated
later paragraphs, including note/comment references. Location tokens supplied
with `--select` must belong to the current input; ambiguous or missing anchors
and out-of-bounds coordinates fail before publication.

## Live model and utility SDK

The following original memory-only example was executed through the built `docx`
export and independently checked after reload:

```js
import { Document } from "docx";

const document = await Document(undefined, {
  timestamp: new Date("2026-09-21T12:00:00Z"),
  author: "Surveyor"
});
document.add_paragraph("Harbor notes").add_run(" — checked").bold = false;
let saved;
await document.save({
  write: async (bytes) => {
    saved = bytes.slice();
  }
});
const reopened = await Document(saved);
console.log(reopened.paragraphs.at(-1).text);
```

`Document(input?, context?)` is always async. Null/undefined creates the original
package; input admits owned Uint8Array, explicit byte sources or matching
`{path, capability}` VFS tokens. Raw host strings grant no access.
`DocumentModelContext` accepts optional `limits`, `signal`, `budget`, `timestamp`,
`author`, `initials`, `metrics`, `vfs`, `binaryResolver` and `registerCleanup`.
Omitted model time is fixed at 1980-01-01T00:00:00Z; author/initials are empty
strings. Utility operations requiring identity/time still require their explicit
options. These model defaults do not inspect the clock or current user.
`metrics.measure(text, font, points)` is an explicit trusted capability;
`fonts` and `template` context overrides are proposed, not admitted API promises.
VFS uses `{capability: string, filesystem}` and binaryResolver uses
`{capability: string, open(path, {signal, maxBytes})}`. Model default archive
ceilings differ from the low-level reader's required explicit ArchiveLimits.

`save(output)` returns Promise<void> and admits a staged byte sink
`{stage(signal?)}` returning `{write, commit, abort}`, an explicit archive sink
`{write}`, or matching VFS token. A direct sink has no transport rollback; use
staging when the caller needs transactional publication. Model factories, save
and add_picture are async even for memory bytes; admitted properties remain
synchronous. Utility SDK entry points include executeDocumentBatch,
applyStyleModelBatch and the declared inspect/edit functions exported by `docx`.
Discover their exact typed arguments and CLI batch routes with schema/help;
`engine.execute` is the byte-argument command surface, not arbitrary SDK calls.

The current public map has 1,338 rows. NumberingPart.new throws
UnsupportedEditError (`unsupported-edit`) and remains a public blocking gap.
Returned comments/settings parts are CommentsPartView/SettingsPartView. Run inner
text iteration yields primitive strings; the proposed \_Text interface and
ProvidesStoryPart/ProvidesXmlPart exports remain unqualified. These obligations
are retained, including inherited/underscore-prefixed members, rather than
renamed or hidden. All 21 rejected command routes are listed in
[the verification manifest](usage-verification.json); an export or schema alone
is not complete behavioral evidence.

## Every option and schema

[The exhaustive option register](usage-contracts.json) captures all 1,518 operation
declarations: IDs, command paths, support, feature IDs, required field types,
SDK fields, batch fields/receivers, result handles, input arity, transport,
mutation intent and allowed common options. Unsupported declarations remain
visible with reject support. Typed-batch declarations use `batch`, not a literal
member path on the CLI. Declaration coverage does not qualify execution.

Use `schema` for versioned JSON Schema inputs/results, `schema COMMAND PATH` for
a single operation, and `help COMMAND PATH` for generated option details. Nested
values, enums, units and closed record structures must match those schemas;
unknown fields, accessors and dangerous prototype keys reject. CLI flags are
mechanical kebab-case operation fields; SDK/JSON operation fields are camelCase.
Neutral model members retain their documented snake_case spelling.

Common options are listed below; each operation permits only its own subset.

| SDK option / CLI flag                           | Type                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `json` / `--json`                               | boolean                                                                                                    |
| `limit` / `--limit`                             | ReadonlyArray<{name: LimitName; value: nonnegative safe integer}>                                          |
| `output` / `--output`                           | VfsDestination                                                                                             |
| `outputDir` / `--output-dir`                    | VfsDirectory                                                                                               |
| `inPlace` / `--in-place`                        | boolean                                                                                                    |
| `force` / `--force`                             | boolean                                                                                                    |
| `dryRun` / `--dry-run`                          | boolean                                                                                                    |
| `allowEmpty` / `--allow-empty`                  | boolean                                                                                                    |
| `allowPartialOutput` / `--allow-partial-output` | boolean                                                                                                    |
| `select` / `--select`                           | LocationToken                                                                                              |
| `scope` / `--scope`                             | body&#124;headers&#124;footers&#124;footnotes&#124;endnotes&#124;comments&#124;text-boxes&#124;all-stories |
| `first` / `--first`                             | boolean                                                                                                    |
| `all` / `--all`                                 | boolean                                                                                                    |
| `occurrence` / `--occurrence`                   | positive integer                                                                                           |
| `timestamp` / `--timestamp`                     | UTC instant                                                                                                |
| `author` / `--author`                           | string                                                                                                     |
| `paragraph` / `--paragraph`                     | positive integer                                                                                           |
| `run` / `--run`                                 | positive integer                                                                                           |
| `table` / `--table`                             | positive integer                                                                                           |
| `image` / `--image`                             | positive integer                                                                                           |
| `section` / `--section`                         | positive integer                                                                                           |
| `comment` / `--comment`                         | positive integer                                                                                           |
| `note` / `--note`                               | positive integer                                                                                           |
| `link` / `--link`                               | positive integer                                                                                           |
| `control` / `--control`                         | positive integer                                                                                           |
| `revision` / `--revision`                       | positive integer                                                                                           |
| `shape` / `--shape`                             | positive integer                                                                                           |
| `field` / `--field`                             | positive integer                                                                                           |
| `bookmark` / `--bookmark`                       | positive integer                                                                                           |
| `cell` / `--cell`                               | logical cell coordinate                                                                                    |

`-o` aliases output; `--` ends option parsing. Text replacement is literal and
requires exactly one of first/all/occurrence. CLI owner indexes are one-based
and scoped; model sequences are zero-based. Fingerprinted locations reject stale
or ambiguous selection. No unrestricted member evaluation or callback execution.
JSON argument sources use explicit declared source acquisition. Only one diff
input may use stdin. Input/JSON schema checks precede input acquisition.

## Limits, environments and safety

There are no product environment variables or config files. The optional native
research check `npm run test:schemas --workspace=docx` requires test-only
`DOCX_SCHEMA_ROOT` and pinned `/usr/bin/xmllint`; these are not product runtime
requirements. Missing prerequisites fail qualification, not silently pass. Trusted host options
are ArchiveContext `{limits, signal, budget?}` and engine `{limits,
documentLimits?}`; I/O cleanup additionally accepts `registerCleanup`.
All ArchiveLimits are explicit: maxArchiveBytes, maxEntryBytes, maxTotalBytes,
maxMembers, maxPathBytes, maxDepth, maxExtraBytes, maxCommentBytes,
maxRetainedBytes and chunkSize. The [README draft](package-readme-draft.md)
retains their meanings and validation. [Resource accounting](resource-limits.md)
details ledger charging; current effective defaults are captured in
`usage-contracts.json.capabilities.limits` and listed below. `--limit NAME=VALUE` lowers host
ceilings only; duplicates, unknown names, invalid numbers and increases reject.
Conservative cumulative counters are not process memory isolation or hard latency
limits. Record templates allow four repeat levels and 1,000 items per region.

| Document limit       | Default ceiling |
| -------------------- | --------------: |
| `compressedInput`    |      67,108,864 |
| `expandedPackage`    |     268,435,456 |
| `zipEntries`         |          10,000 |
| `xmlPartBytes`       |      33,554,432 |
| `xmlNodes`           |       2,000,000 |
| `xmlDepth`           |             256 |
| `embeddedMediaBytes` |      67,108,864 |
| `retainedBytes`      |     536,870,912 |
| `serializedOutput`   |     268,435,456 |
| `batchOperations`    |           1,000 |
| `matches`            |         100,000 |
| `insertedNodes`      |       1,000,000 |
| `tableCells`         |         100,000 |
| `tableRows`          |          10,000 |
| `tableColumns`       |           1,024 |
| `diagnosticBytes`    |          65,536 |
| `work`               |     536,870,912 |

No ambient filesystem, network, fonts, clock, identity, native Office process,
macro activation or embedded executable execution is acquired. Paths require
explicit VFS grants; linked content stays inert. Async cleanup and cooperative
cancellation cannot forcibly stop an arbitrary trusted host callback.

Mutations require output or in-place unless dry-run. Existing destinations need
force; input aliases need in-place. Force does not bypass safety. Validation and
serialization precede conditional staged publication; missing atomic authority
rejects rather than falling back to destructive replacement. Dry-run publishes
nothing. Binary `--output -` contains only package bytes and conflicts with JSON
except dry-run. Multi-file extraction requires explicit partial-output consent;
receipts preserve completed publications and possible partial stdout failures.
See [publication](file-publication.md) and [archive extraction](archive-extraction.md).

Version-1 JSON contains version, operation, ok, data, warnings, errors, affected
and locations. Diagnostics go to stderr; human content is terminal-escaped.
Ordinary exits: 0 success, 1 document/edit/selection failure, 2 usage, 3 I/O,
4 limit, 130 cancellation. Diff uses 0 equal, 1 different, 2 failure, 130 cancellation.

## Cached content and protected structures

Fields, TOC, sequence counters, chart caches, stored page counts and page numbers
are cached data. Inspection does not calculate freshness. Supported field edits
retain instructions and omitted flags; no field evaluation, pagination, chart
formula execution or document rendering occurs. Page settings edit stored values,
not rendered pages. Notes retain numbering/restart settings without layout.

Ordinary edits reject signed baselines. Signature inventory reports verified null;
separate explicit removal strips only an admitted complete graph. No cryptographic
verification or signing. Protection/write-protection/control locks conservatively
reject affected or publication-unsafe edits; no password unlock or bypass. Presence
and absence of markers are not a security certificate.

Utility `images add` directly inserts PNG/JPEG. Model `add_picture` admits
PNG/JPEG/GIF/BMP/TIFF with original five-format workflow evidence in
[the current API audit](whole-api-acceptance-20260921.md). This distinction is
not a promise that the utility insertion route admits all five. All five formats
have immutable header reads and utility occurrence replacement. TIFF supports both byte orders. Static bounded SVG
insertion requires an explicit validated raster fallback. External acquisition,
pixel decoding, rasterization, floating authoring and fallback replacement are
unsupported. DPI is per-axis with independent 72 fallback. Existing coherent
anchor layout edits retain original media; rendering fidelity is unqualified.

## Language mappings and remaining obligations

The full audited inventory remains 920 records, including 417 inherited records
and 185 records whose qualified path includes a public underscore-prefixed owner.
No underscore naming rule removes public APIs. Enums, collections, helpers,
returned interfaces and APIs without source tests remain acceptance obligations.
The inventory is historical; supported discovery rows do not rewrite its status.

Undefined/omission uses documented defaults; null is admitted only by a declared
parameter/reset. False and zero are values, not omission. Integers are checked JS
safe integers, reals finite numbers, bytes owned Uint8Array. Lengths use checked
integer EMU and shared half-away rounding. Tri-state flags retain boolean/null.
Dates normalize UTC with whole-second XML precision; utility metadata snapshots
use stored strings while live timestamp properties use copied Date values.
Sequences map to length/iterator/at and only declared slices; keyed collections
use keys and nullable lookups where specified. Live ownership, deterministic stale
handles and cross-document import remain mandatory beyond bounded owners.
Canonical enum symbols and from_xml/to_xml helpers are exported; their presence
does not qualify every enum member contract. BoundsError and MissingKeyError
extend RangeError with missing-selection; StaleHandleError extends RangeError
with stale-selection. Invalid argument types and numeric domains retain neutral
usage errors, while unsupported mutation uses unsupported-edit.

Documentary corrections retain comment_id, paragraph-owned add_run,
table_direction, priority, aliases, exact per-axis DPI, UTC serialization and
current/stale tab views; typo spellings create no aliases. Destructive model text
setters differ from format-preserving utility text replace. The async Document factory and bounded document/table/section/review/settings/
drawing owners are available. Whole-member acceptance remains blocked, as recorded
in [the current API audit](whole-api-acceptance-20260921.md).
Reference research identifiers and corpus provenance are not user-facing API names.
Package README application remains pending explicit permission. No full OOXML,
Word compatibility, complete model API or renderer claim is made.
