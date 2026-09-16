# DOCX usage and availability

Verified 2026-09-15 against the local workspace. The utility is a bounded OOXML
editor, not a Word renderer or a complete document object model. The durable
[format contract](../specs/docx.md), [shared CLI](../specs/office-cli.md) and
[shared SDK](../specs/office-sdk.md) remain proposed beyond qualified subsets.
[Acceptance](acceptance-matrix.md) distinguishes evidence from declarations.

## Imports and execution

The private `docx@0.0.1` workspace is TypeScript ESM, with `dist/index.js` and
`dist/index.d.ts`. The root package also declares `poe-code/docx`. There is no
standalone `docx` bin in either manifest and no public installation promise.
The root Node engine is >=18.18; this verification ran Node 22.23.2. Browser/worker
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
Admitted immutable values and the bounded style model have synchronous access.
The [verification manifest](usage-verification.json) lists checked named exports.
Imports were resolved from the built workspace; no registry install was performed.

`createDocxInspectionCommandEngine({limits, documentLimits?})` requires explicit
ArchiveLimits. Its async `execute(request)` takes byte args, cwd, supplied VFS,
stdin/stdout/stderr capabilities, AbortSignal and optional cleanup registration.
`createDocxCommand({engine, replace?})` and `docxCommands({engine, replace?})`
come from `poe-code/safe-bash/commands/docx`; replace defaults false and only
controls command registration collision handling. The caller must inject the
engine into a Shell. A command declaration does not grant filesystem access.

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

## Every option and schema

[The exhaustive option register](usage-contracts.json) captures all 1,517 operation
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
`usage-contracts.json.capabilities.limits`. `--limit NAME=VALUE` lowers host
ceilings only; duplicates, unknown names, invalid numbers and increases reject.
Conservative cumulative counters are not process memory isolation or hard latency
limits. Record templates allow four repeat levels and 1,000 items per region.

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

PNG/JPEG insertion is distinct from PNG/JPEG/GIF/BMP/TIFF immutable header reads
and occurrence replacement. TIFF supports both byte orders. Static bounded SVG
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
use stored strings while proposed live timestamp properties use Date.
Sequences map to length/iterator/at and only declared slices; keyed collections
use keys and nullable lookups where specified. Live ownership, deterministic stale
handles and cross-document import remain mandatory beyond bounded owners.
Frozen enum symbols and helper lookups do not qualify proposed direct enum methods.

Documentary corrections retain comment_id, paragraph-owned add_run,
table_direction, priority, aliases, exact per-axis DPI, UTC serialization and
current/stale tab views; typo spellings create no aliases. Destructive model text
setters differ from format-preserving utility text replace. The required Document
factory and many owners are absent, as recorded in whole API acceptance.
Reference research identifiers and corpus provenance are not user-facing API names.
Package README application remains pending explicit permission. No full OOXML,
Word compatibility, complete model API or renderer claim is made.
