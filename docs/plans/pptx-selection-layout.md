# PPTX selection layout

## Scope and ownership

Implement the bounded F25 selection operations: sibling order, union alignment,
edge-gap distribution and explicit-offset duplication. Domain logic belongs to
`packages/pptx`; safe-bash remains an adapter. No root editing logic, host I/O,
network, native runtime, README edits, pipeline execution, push or release.

Delegated ownership is disjoint: the domain agent owns new selection engine and
unit test files; the command agent owns command/option wiring and new command
acceptance tests; the research agent owns this plan, `selection-case-map.json`,
`selection-api-map.json` and `selection-usage.md` under `docs/pptx`. The parent
owns integration, independent review, QA, maintained checks and the local commit.
Other work in the checkout is preserved.

## Contract and research reconciliation

Read root instructions, the PPTX format specification, shared office CLI/SDK
contracts, both upstream audits and inventories, language mappings and the
corpus manifest. The research receipt retains 220 exact source case identities
(173 unit variants and 47 expanded BDD scenarios) and 233 relevant public API
records. Existing geometry/group receipts are referenced without upgrading their
claims. Neighboring live-model obligations remain explicit gaps. This is bounded
F25 work, not whole-public-API completion.

The pinned baseline has no direct selection layout operation. New original
operation tests must assert exact sibling order, integer arithmetic and clone
references. Inherited geometry, ordered collections, connector endpoints and
identity allocation remain separately accounted for. Public underscore-prefixed
records are not hidden. Source identities stay in research; original product
wording/assets introduce no new copied implementation. Existing standalone legal
notices remain required and unchanged.

Command JSON uses camelCase, model spellings remain neutral snake_case, and
selection tokens are owned/fingerprinted. Coordinate space must be explicit.
Sibling-only selections reject mixed slides, groups, parents and ancestor/child
combinations. Lock/visibility policy, stable tie breaking, rounding, clone ID
allocation and connector/timing handling must be visible in usage/schema.

## TDD and independent assertions

1. Add small original in-memory package tests that fail on the missing behavior.
2. Verify all order modes using literal full sibling-ID arrays, including
   noncontiguous selections and reversed selector order.
3. Check all six alignments and both distribution axes with literal expected
   integer coordinates. Include tied coordinates, overlap/negative gaps,
   endpoint preservation, fractional rounding and large safe coordinates.
4. Check explicit parent space, mixed-owner rejection, lock/hidden policy and
   no publication on failure.
5. Duplicate original XML in memory; assert all resulting IDs, nested IDs,
   internal/external connector targets, relationship IDs and timing behavior.
   Original objects remain unchanged and IDs cannot collide.
6. Execute identical operations through the SDK and CLI against memfs. Compare
   output package structure independently; exercise generated schema/help,
   usage errors, JSON, explicit output, dry-run and batch publication.
7. Run maintained focused package checks, the selected build dependency closure,
   and registered safe-bash acceptance tests. The parent records exact results.

## Disposable QA procedure

Use only manifest-listed local cache inputs, verifying byte length and SHA-256
before admission. Never make unit tests download or depend on these assets.
The manifest entry `.cache/pptx-corpus/CERN-job-opp-250925.pptx` is available at
43,231 bytes with SHA-256
`85cc7b338a11b9d1a9dfcaaaa504bf21ab643e4c30004a478152f390ee9f5f1d`.
The parent inspected slide 1: sibling IDs are `[7,4,2]`, with boxes respectively
`(0,6315998,12192000,542002)`, `(11340644,6398390,559676,365125)` and
`(2950683,2644170,6849054,2800767)`, all stored in slide coordinates.
These explicit boxes support exact order/alignment/distribution QA.

Load verified bytes into caller-provided memory storage. Run each operation into
a disposable output. Reopen and inspect exact order, boxes and references; do not
infer correctness from rendered appearance. Keep fixture bytes and outputs out
of Git. If meaningful discrepancies appear, reproduce them with a small original
in-memory regression before fixing them.

For terminal visual QA, use the maintained `npm run screenshot` route hosting
an inline TypeScript-enabled Node Shell/MemoryFileSystem invocation, as in the
existing group QA plan. Capture operation help and success/error output, inspect
the PNG and record its path and conclusion. The standalone Shell command `pptx`
is not a root poe-code subcommand. Do not add screenshot unit tests.

## Validation and delivery

Pending parent integration evidence. Only explicitly owned files and this plan
are staged after relevant checks. Commit the atomic feature locally on main
with a Conventional Commit and report its hash separately. No push or release.

## Independent review findings

The review reproduced a numeric identity mismatch using original XML: a shape
stored as ID `001` and connector target `1` were copied together, but the cloned
connector still targeted the original. The domain owner added
`maps connector targets by numeric identity when source lexical forms differ`
and normalized mapping keys numerically. The owner reports this regression and
the focused 32-case domain suite passing; final maintained evidence belongs below.

The corpus inspection exposed unrelated `noGrp` metadata. The lock policy was
narrowed to `noSelect` for every action, `noMove` for order/layout actions and
`noCopy` for duplication, including relevant ancestors/descendants. The original
regression `preserves unrelated grouping size and rotation locks during alignment`
asserts exact alignment and unchanged metadata. The domain owner reports it
passing. Foreign connector lookalikes and opaque copied attributes now have
separate rejection regressions; supported relationship IDs remain preserved.

Research validation parsed both new JSON receipts, checked 220 distinct case IDs
and 233 distinct public API IDs, and resolved every API-register link. Receipt
rows reference existing exact parameter evidence rather than copying fixture or
mock descriptions. Seven allocator rows have bounded original numeric/security
equivalence; the empty-collection helper remains a visible adjacent gap because
duplication requires an existing object. No count is presented as full parity.

## Coordinator QA receipt

The manifest-listed 43,231-byte fixture above was hashed before admission and
after QA; its hash remained unchanged. SDK and CLI with memfs produced identical
bytes for three independent edits of its original slide 1:

- Move picture ID 7 to front: exact sibling order `[4,2,7]`.
- Align left: IDs `[7,4,2]` all have x=0; y remains respectively
  `[6315998,6398390,2644170]`.
- Distribute horizontally: IDs `[7,4,2]` have x respectively
  `[0,11340644,8341795]`. Endpoint boxes are unchanged and the equal edge gap is
  -3,850,205 EMUs. The drawing order and y coordinates are unchanged.

For every successful operation, comparison of decoded member names and bytes
found only `/ppt/slides/slide1.xml` changed; relationship parts and other members
were identical. ZIP member ordering is canonicalized by the existing writer;
QA compares member identity sets, not input archive entry order. The first QA
attempt assumed a package-reader index export that does not exist; corrected
QA uses the internal reader only for independent package comparison. Mutation
and command execution use public exports.

Duplicating the fixture's existing text box with offsets 7/-3 EMUs rejects its
opaque extension metadata with `unsupported-edit` in both SDK and CLI. CLI
status is 1 and publication count is zero. This is preservation evidence, not
a successful duplicate of opaque metadata. Original unit assets separately
prove successful plain/group/connector duplication and reference remapping.

The first alignment attempt reproduced the grouping-only `noGrp` lock defect.
The original regression preserves `noGrp`, `noResize` and `noRot` while aligning;
only the action-relevant locks block selection edits. Foreign namespace lock
lookalikes likewise retain their unrelated meaning. No corpus bytes enter tests.

`npm run screenshot` captured actual registered Shell help, all four successful
operations and a missing-coordinate error in
`/tmp/pptx-selection-layout-verified.png`. Visual inspection found legible output,
help/success status 0 and usage-error status 2, without clipping. The initial
`/tmp/pptx-selection-layout.png` capture used the plugin factory without invoking
it and therefore showed setup errors; the corrected capture supplies an explicit
engine to `pptxCommands`. No screenshots are committed.

The full maintained package unit route passed 2,455 tests in 85 files before the
final additional admission/public-SDK regressions. The selected workspace build
closure passed all three declared builds. Package lint passed. The registered
safe-bash create/selectors/inventory/fields cohort passed 92 tests; the added
Shell test then passed again with its test-local cooperative scheduler, taking
163ms. Final post-review checks are recorded below.

## Final verification

- Final maintained `npm run test:unit --workspace=pptx` route (with additional
  test-path arguments) still selected the whole package: 86 files and 2,463
  tests passed. The feature contributes 39 pure original cases, one public SDK
  memfs workflow and six command cases. No downloads or native document runtime.
- Final `npm run build:workspaces -- --workspace=pptx` passed its three-build
  maintained dependency closure. No full pipeline ran.
- Final `npm run lint --workspace=pptx` passed ESLint and both TypeScript checks.
  One earlier lint attempt overlapped a dependency build's dist replacement and
  reported missing schema declarations; rerunning after build completion passed,
  without a source workaround or suppressed diagnostic.
- `npx eslint packages/safe-bash/tests/commands/pptx/selectors.test.ts` passed.
  After the final rebuild, the actual registered Shell selection test passed
  again (one test, zero skipped) in 234ms through the node:test name filter.
- The specification checker passed with zero warnings; `git diff --check`
  passed. All 220 unique case references and 233 API rows were checked against
  their exact inventory identities. Product files contain no reference-project
  identity; existing required standalone legal notices are retained.

This delivers the bounded F25 selection operation surface. Live collection and
other inherited model obligations remain recorded in research; no whole-API,
opaque-duplication, batch, rendering-fidelity or release claim is made.
