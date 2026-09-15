# DOCX lifecycle adversarial verification

Date: 2026-09-15. Task: `lifecycle-adversarial-review` only.

Acceptance remains open. This record verifies a bounded correction and existing
evidence; it does not certify the full requested phase/adapter matrix or whole
public model. The dirty master plan and all preexisting source/index entries are
outside this correction. No downloads, README changes, native reference build,
ambient product I/O, networking, push or release are authorized or performed.

## Reviewed evidence and contracts

Read root and safe-bash AGENTS.md, the relevant DOCX command, resource,
publication, security and acceptance contracts, shared Office CLI/SDK contracts,
API audit and schema-2 API inventory. The historical stream, invocation-budget,
safe-publication and semantic-comparison records retain their red/green accounts.
Their intermediate revisions were not replayed; historical narratives without
raw red transcripts are recorded evidence, not newly reproduced red runs.

Current original tests cover source opening/iteration/finalization, chunk reuse,
borrowed cancellation precedence, parsing checkpoints, retained fragment limits,
sink backpressure, late failures, repeated/reentrant cleanup, sibling isolation,
protected baselines, unknown identities/capabilities, read-only mount forwarding,
conditional output races, postcommit receipts and owned staging cleanup.
Batch tests assert later semantic failure discards earlier changes and preserves
both source and forced output. Resource tests cover actual XML/media/editor copies
and output limits as well as ledger boundaries. Those ledger tests alone do not
establish each actual operation's exact boundary behavior.

## Newly reproduced defect and correction

Before product edits, four original memfs cases reused both input buffers
immediately after calling `compareDocument`. All four modes rejected with
`invalid-container` instead of returning equality. The maintained filtered red
run exited 1: four failures, 3,338 filtered cases. The left copy was taken before
suspension, but the right copy was deferred until left admission completed.

Two further memfs red cases exceeded the left or right compressed-input ceiling
by one byte. They rejected with the correct resource category but had retained
3,146 or 217,968 bytes, respectively, instead of refusing input retention first.
Both assertions failed before product edits. A first green attempt exposed a
test assumption: invocation-schema admission legitimately charges 12 bytes.
The final assertions compare with an independent invocation-admission ledger,
and require zero document compressed-input acquisition on this refusal.

`diff.ts` now admits both per-document byte ceilings and aggregate retention
before taking either copy, owns both buffers before its first suspension, and
uses those owned inputs during admission/comparison. The two existing snapshot
charges move to the common boundary; successful total copy accounting is unchanged.
Original tests, method names, command IDs, schemas and output formats remain.

Six additional original memfs cases admit both inputs at exact compressed,
expanded, entry, retained-copy, XML-node and work ceilings, then reject one less
capacity. Per-document resources and cumulative invocation resources are tested
separately. All assert unchanged source and preexisting output.

## Exact JavaScript/security mappings

| Surface | Mapping verified by this correction |
| --- | --- |
| Comparison | `compareDocument(left: Uint8Array, right: Uint8Array, context: ArchiveContext, options: DocumentDiffOptions): Promise<DocumentDiffData>`; both buffers owned before suspension; equality remains data |
| Limits | Explicit trusted context and lower-only typed options; compressed/expanded/entries per document; retention/nodes/work cumulative across both inputs; resource refusal remains `limit-exceeded` |
| CLI | Existing `diff` path invokes the same utility; mode/scope flags and JSON spellings unchanged; equal returns 0, invalid-container comparison returns 2 with a version-1 failed envelope |
| Authority | Explicit bytes/VFS capabilities and borrowed signals only; no path, credential, network, clock or font discovery added |
| Model coverage | This utility is not a live Document/Part/XmlPart/save implementation; inherited members, collections, helpers, enums and public underscore-prefixed types retain explicit inventory obligations |
| Drift | Historical infrastructure records describe their original milestone. Current utility comparison evidence supersedes their then-pending diff status only; comment_id/timestamp, table_direction, nullable setters and per-axis DPI research decisions are unchanged |

The inventory's 920 records and nested enum accounting are research coverage,
not passes. No public member is hidden or promoted by this utility correction.

## Maintained checks and actual output inspection

- Initial `npm test --workspace=docx`: exit 0, 165 files / 3,336 tests, no skips.
- Focused maintained ownership/admission/boundary run: exit 0, 12 passed;
  3,336 unrelated cases filtered, not counted as passes.
- `npm run build:workspaces -- --workspace=docx`: exit 0, declared portable
  dependency closure, including native-free safe-fs assets and built export smoke.
- `npm test --workspace=virtual-bash -- --test-shard=172/1152
  --test-name-pattern='^document (byte adapters|source|adapters|sink|adapter|output)'`:
  exit 0, 11 passed, no skips. The shard position/denominator came from current
  `discoverTests`/`loadBoundaries`, not historical fixed membership.
- Final `npm run lint --workspace=docx`: exit 0, ESLint and both TypeScript
  routes against all 12 added cases, with one warning in untouched
  `operation-types.test.ts`.
- Built ESM SDK comparison returned equality after both caller buffers were
  overwritten. Actual Shell with the explicit DOCX plugin returned JSON status 0
  for equality and status 2 / `invalid-container` for the original invalid input.
  The maintained generic screenshot route captured these actual outputs at
  `/tmp/docx-lifecycle-comparison.png`; inspected text is legible and envelopes
  retain `affected: 0`, with `data: null` on failure. No root DOCX command exists,
  so `screenshot-poe-code` would exercise unrelated root behavior.

Postcorrection `npm test --workspace=docx` exited 0: 166 files / 3,342 tests,
no skips. It loaded the six ownership/admission cases before the six additional
boundary cases were added; the subsequent maintained focused run executed all
12 against the final file. This is not a full 3,348-test run. The initial/final
logs are disposable evidence; no historical capture was overwritten.

`git diff --check` passed. The index was empty on entry and final review confirmed
no preexisting entries. Only the three paths in this correction are staged.
Disposable logs/captures remain under `/tmp`; none is staged.

## Gaps preventing exhaustive acceptance

- No independent exhaustive abort/error injection table was executed at every
  acquisition/read/parse/edit/serialize/publish subphase. Existing representative
  tests and their historical records do not justify that exhaustive claim.
- Actual mounted read-only behavior and same/unknown identities are tested, but
  every cross-mount alias composition and unknown backing identity is not qualified.
- Exact diff resource boundaries are now exercised. Exact and one-over real
  operation boundaries for every match/batch/output/media-copy route still require
  a complete operation-level crosswalk; generic ledger tests cannot substitute.
- No deployed S3/WebDAV publication or cancellation was exercised. Transport
  mocks and memfs conditional-write fixtures do not prove service enforcement,
  transaction guarantees or deployed cleanup behavior.
- Whole public API, renderer/corpus qualification, packed/browser consumers and
  broad integration/release gates are not certified by these scoped checks.

Only the newly reproduced comparison correction is eligible for an atomic local
commit. Keep the master task's verification open; do not create an empty commit
for read-only findings or claim unavailable QA passed.
