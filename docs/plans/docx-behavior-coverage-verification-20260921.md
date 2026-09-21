# DOCX behavior and coverage audit verification, 2026-09-21

## Scope and acceptance decision

Verify only `behavior-and-coverage-audit` against the DOCX and shared office
contracts, root instructions and safe-bash instructions. Baseline:
`33da1bd584cd7184cb2cd4ee8b4b25bc449b85f6`, on local `main`. Relevant product,
codec and adapter paths were clean at entry; unrelated work is outside this
qualification. The preexisting pipeline-plan edit is preserved.

The [historical audit](../docx/behavior-coverage-audit.json) remains historical
evidence. Its candidate, test catalog, hashes, check totals, coverage and gaps
describe the earlier worktree. This dated supplement resolves their temporal
ambiguity without replacing historical results. Acceptance remains partial:
static crosslinks and passing suites do not close independent per-operation
supported-edit, preservation, rejection and failure obligations.

## Feature and operation accounting

All 50 historical feature rows F01–F50 have existing original scenario files:
113 file crosslinks, of which 90 still match their historical catalog hashes.
The original catalog contains 167 files; current DOCX `.test.ts` discovery has
252 files, including 85 additions and 32 changed catalog files. This census is
not a pass count or a claim that each historical title proves every variant.

Actual SDK schema discovery returns 1,517 distinct operation IDs, identical to
the audit's operation set. It declares 363 edit, 1,133 read and 21 reject rows.
Actual capabilities discovery contains every F01–F50 ID. These support labels
are declarations requiring behavioral evidence, not independent acceptance.
The historical audit leaves 1,396 model obligations and 121 utility scenario
reviews unclosed; 1,347 rows have no exact operation literal file crosslink.
Absence of that literal does not establish absence of an indirect original test.
Every operation has a historical feature mapping; no ID was dropped to improve
the denominator. The nine additive style operations retain their explicit
historical register-drift disposition.

The pinned public inventory still has 920 records: 410 planned, 378
security-mapped, 124 language-mapped and eight documentation errors. Those are
research dispositions, not current implementation counts. Its 1,337-row public
map, including 417 inherited rows, remains an additional evidence denominator.
Public underscore-prefixed types, enums/aliases, collections, helpers and APIs
without source tests are not excluded. The dated neighboring model records
supersede only their scoped obligations; whole-public-API closure remains open.

## Original behavior and historical red/green review

Inspected the retained seven-failure table log, 34-pass focused green log and
receipt. The failures include active-grid dimensions and omitted-slot selection;
the receipt distinguishes an earlier wrong-namespace fixture failure and says
the original red source was not separately archived. Neither discovery-era
findings nor historical native-source summaries were relabeled current failures.
No native reference build was run.

Inspected original assertions in archive, hostile-input, mixed-structure corpus
regression, formatting/value, collection, package-view and publication tests.
They include independent wire expectations, exact unaffected payloads, memfs
publication, coercion/null/zero boundaries, async owned-byte admission, invalid
XML, duplicate parts, stale owners and failed-output preservation. These sampled
assertions do not close all 1,517 operation obligations. No new concrete product
defect was reproduced, so no product correction or invented red test is claimed.

The retained inline-picture terminal screenshot was visually inspected: its
actual successful batch JSON and failed ambiguous-selection JSON are readable.
This is historical CLI evidence only. No fresh visual CLI or document-renderer
qualification is claimed by this documentation-only verification.

## Exact JS/security mappings and documentation drift

Retain neutral snake_case model members and camelCase operation options with
mechanical kebab-case flags, plural resources and `text.replace`. Public factory,
input-admission and save boundaries are always async; admitted model access is
synchronous. Bytes are owned `Uint8Array`; paths need explicit VFS capabilities.
Model sequences use zero-based lookup, iteration and documented signed `.at`/
slice protocols; CLI selectors are one-based and fingerprinted. Keyed styles,
comments and relationships retain key semantics. Null inheritance differs from
false/zero, and destructive model text assignment differs from preserving
literal replacement. Safe integer EMU values use halfway-away-from-zero
rounding; enums retain documented symbols/aliases. UTC dates are copied and
serialized at whole-second precision. Type/value/index/key errors map to neutral
typed errors and operation-context codes. Owner-bound XML/package views grant
bounded mutation without arbitrary evaluation, XPath, host authority or network
dereference. These are the shared contract mappings, not newly established
whole-model passes.

Ordinary exit statuses remain 0/1/2/3/4/130; diff uses 0 equal, 1 different,
2 failure and 130 cancellation. The version-1 result envelope remains unchanged.
The inventory's eight documentation-error dispositions and original spellings
are preserved. Historical packing/discovery-absent-from-HEAD statements do not
describe this baseline, whose existing maintained build includes those sources.

## Fresh maintained scoped checks and coverage

All listed executions completed successfully against the existing product:

| Route | Inspected result |
| --- | --- |
| `npm run test:unit --workspace=docx -- --no-cache --coverage` | 252 files, 5,191 passing tests; no skipped/pending tests in the result; 241.62 seconds with instrumentation |
| `npm run test:unit --workspace=@poe-code/office-package -- --no-cache --coverage` | Two files, 46 passing tests |
| `npm run lint --workspace=docx` | Exit 0; ESLint and both TypeScript configurations pass; one type-only unused-variable warning in `operation-types.test.ts` |
| `npm run lint --workspace=@poe-code/office-package` | Exit 0; ESLint and both TypeScript configurations pass |
| `npm run build:workspaces -- --workspace=docx --no-cache` | Exit 0; five declared dependency-closure builds and native npm lifecycle stages, including portable safe-fs build |
| Safe-bash maintained `scripts/test-reporting.mjs`, explicit DOCX registration and `tests/commands/docx/*.test.ts` files | 171 passes, zero failures/skips/TODOs; `TSX_DISABLE_CACHE=1`; Node coverage and spec/LCOV reporters |

The adapter route is the existing focused reporting wrapper, not a full
safe-bash unit gate. Root-wide checks are outside this documentation-only scope.
The DOCX factory/codec unit tasks use their maintained package scripts; the
selected build uses declared workspace dependencies instead of a handwritten
build list. The portable filesystem stage is not a native reference build.

Vitest V8 includes all `packages/docx/src/**/*.ts` and
`packages/office-package/src/**/*.ts`, excluding only `**/*.test.ts`. DOCX and
codec coverage maps are merged with Istanbul by source identity, unioning hits
and counting denominators once. Adapter Node V8 LCOV includes
`src/commands/docx/**/*.ts`; its line/branch definitions differ and are reported
separately. No product source path is omitted to improve coverage.

| Domain | Covered / total lines | Covered / total branches |
| --- | --- | --- |
| DOCX | 16,629 / 17,116 (97.15%) | 21,509 / 24,822 (86.65%) |
| Shared office codec | 603 / 655 (92.06%) | 518 / 615 (84.22%) |
| Safe-bash DOCX adapters | 95 / 95 (100%) | 24 / 26 (92.31%) |

DOCX and adapters exceed the 90%/85% targets. The codec branch target remains
unmet: at least 523/615 covered branches are needed, five more than measured.
No platform exception, TODO, skipped case or unsupported API is counted passed.
Coverage alone establishes neither OOXML conformance nor whole API acceptance.

Inspected these actual uncovered mutation/error paths against current source:

- `document-session.ts`: lines 52/54/61/66 reject malformed snapshots, metadata
  limits, member types and duplicate names; line 77 guards generation overflow.
- `table-insertion.ts`: lines 45–49 handle explicit multi-column widths;
  lines 58–66 handle nested cell-width/margin geometry. Refusal boundaries remain
  undercovered, not platform exceptions.
- `xml-write.ts`: lines 329/357 remove staged patches and rethrow validation
  errors; lines 440/441 guard incompatible attributes and lines 455/456 allocate
  collision-free namespace prefixes. Rollback and lexical preservation require
  independent assertions, not implementation-shaped expected patches.
- `pack.ts`: uncovered source-error/cancellation paths at 66/91–93 and forced
  output admission at 106. Existing memfs alias tests do not prove every error arm.
- `compression.ts`: chunk-size/init/reset failure, delayed-input partial-output,
  concatenated gzip member/padding and truncated-stream handling remain partly
  uncovered. Library-status failures need deterministic fault evidence before a
  correction; ordinary platform availability is not a waiver.
- `zip.ts`: retained filename/timestamp/attribute mismatch rejections at
  890/896/922/935 remain uncovered; their absence from coverage establishes no
  product defect. Other malformed-header/metadata branches remain acceptance gaps.
- Adapter `index.ts`: LCOV reports two uncovered generated-code branches
  starting at lines 30/34. Its function locations show transpiled-code numbering,
  so those are not asserted as original TypeScript line numbers. Inspected the
  original optional `stdinIsDefault`/cleanup forwarding and replacement-option
  branches; exact uncovered-branch source attribution remains an evidence gap.

No newly reproduced defect justified a product fix. Per-operation independent
acceptance and shared-codec branch coverage remain concrete blocking gaps.

## Unavailable and separate QA

No downloads, large-document campaigns, product network calls or renderer runs
were executed. The separate dated independent-schema receipt records its earlier
10-case execution and subsequent fixture cleanup. `DOCX_SCHEMA_ROOT` is not
supplied for this run; fresh schema QA is unavailable and is not counted passed.
Strict grammar compilation, raw extension-profile limits and renderer/repair
warnings retain their recorded limitations. Packaged consumers and paired PPTX
runtime QA were not executed by this bounded audit verification.

Temporary run output is isolated in the repository's `out/` directory because
filesystem-root `/out` is read-only. Only this invocation's evidence is removed
after inspection; unrelated output and historical evidence remain intact.

## Delivery

Documentation corrections only, staged by exact owned paths after verification.
Local atomic Conventional Commit; no push or release. This record does not mark
the pipeline task or whole-format/public-API acceptance complete.
