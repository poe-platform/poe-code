# Independent merged AW-001 / AW-002 validation

Date: August 29, 2026. Delegated independent reviewer, not author Ptolemy or prior validator Nash.

## Scope

Frozen base `87f65dc26cdbdf28500e836204d2b205caaf8b80` includes ARRAY/IP.
Verify the exact eleven-file NUM prerequisite and seven-file AW-only delta; preserve
Nash’s previous report and every author file. No production edits, other-clone
writes, Git mutations or publication authorization.

Before original payload access, read inventory-verification metadata, assert all
38 exclusions and deny the whole security subtree. Read only the thirteen exact
ordinary original-source paths recorded in the reviewer intake manifest. No
recursive audit search, excluded reads/hashes/execution, security research, LLMs
or guest real IO.

## Procedure

1. Verify immutable manifest, source bytes, prerequisite postimages and exact
   post-NUM AW preimages, then inspect the source exception/coercion delta.
2. Run native originals first; compare complete current values and tick logs.
3. Run unchanged 195 author/Nash tests, forty newly captured restore cases, NUM
   and prior published controls. Preserve RED sensitivity evidence separately.
4. Run full build with TERM unset; record executed versus cache-replayed tasks,
   then configured source/new-test types, lint and all-publishable formatting.
5. Record exact AW production preimage paths for CTX/CBI/AR ordering, bounded
   AR-001 limitations, verdict and read-only AW-only/prerequisite capture.

## Verdict

**READY for the exact merged base-plus-NUM-plus-AW candidate. No author repair is
required.** This is a new independent merged review, not a replay of Ptolemy's or
Nash's prior verdict. Both frozen test sets and Nash's report remain unchanged.
No new unit file was needed: the unchanged 195 tests cover the required boundaries,
and eighteen additional bounded native/public-run probes check the NUM/AW
bind/call/apply interaction without changing the tests or runtime.

The supplied integration manifest remains SHA-256
`76cdfa9e6187df1ac3c2f48c9beb4f7f4e789e711cb6a17b0928ce14401acdec`.
All 108 artifacts listed by its evidence manifest were verified, as were all
18 working postimages. The eleven NUM paths are byte-exact approved postimages.
The seven AW paths remain exactly the integrated author's candidate. Forward and
inverse read-only three-way merge calculations on both AW production files
reproduce the frozen postimage and post-NUM preimage byte-for-byte, with zero
conflicts or semantic repairs. The other 296 tracked SafeJS paths retain their
protected hashes. ARRAY/IP and the other selected published controls pass again.

## Source and contract review

- `exceptions.ts:156` carries a source/sandbox provenance flag in captured
  exceptions, defaulting to false for existing host callers. At
  `exceptions.ts:175`, existing subset-error handling and actual host Error
  conversion still precede the new source-value identity-preserving branch.
  Ordinary source records are not rewritten into native Error instances.
- `interpreter.ts:446` propagates captured provenance into coercion. Interpreted
  source closures and callback-capable string/array/map/set/number method paths
  retain source values; invoking a closure uses `callee.sandbox === true`,
  rather than assuming every host rejection is a source value.
- `interpreter.ts:3633` preserves already captured exceptions through rejected
  promises and nested calls. Existing fatal budget/reentry and interpreter-error
  handling remains outside normal source catch coercion. The public
  `surfaceThrownValue` normalization is not changed by AW.
- NUM's changes remain separate: function arity in interpreted/generator closures,
  bound function length, value/member metadata, parameter analysis and snapshot
  restoration. Eighteen new native-first public-run cases combine sync/async
  source throws, bind/call/apply, ordinary DomainFailure-/TypeError-shaped records
  and genuine TypeError. Every complete returned value matches native, including
  original length 1, bound length 0, source/caught/closure identity, context/cause
  aliasing, visible annotation, metadata and the supported Error brand.
- Host controls still copy registered TypeError metadata and its nested graph,
  normalize ordinary host rejection records on sync/async paths, and preserve
  source-local aliases after a host result has already been copied into the guest.
  Public unhandled values retain the existing normalized error/diagnostic envelope.

No new claim is made about private Error representation or native descriptors.
Nash's preserved initial 72-pass/25-fail attempt had twenty unsupported active-host
current captures and five native Error own-key assumptions. Its corrected test
requires exact ordinary-record own keys and supported genuine Error metadata/brand,
not identical built-in enumerability. That distinction remains unchanged and was
reviewed against `exceptions.ts:307` and the current source tests, not inferred
from a raw error representation.

## Fresh RED and GREEN

A reviewer-owned in-memory Vite loader overlays **only** the two exact post-NUM AW
production preimages and verifies their SHA-256 and byte counts before loading.
No checkout, working-file swap, production adapter, marker rewrite or private
Promise substitution is used. The unmodified suites independently reproduce:

| Test file                              | Post-NUM pass | Post-NUM fail | Integrated pass | Integrated fail |
| -------------------------------------- | ------------: | ------------: | --------------: | --------------: |
| `source-exceptions.test.ts`            |             3 |            10 |              13 |               0 |
| `source-exceptions.boundaries.test.ts` |            65 |            19 |              84 |               0 |
| `source-exceptions-validation.test.ts` |            80 |            18 |              98 |               0 |
| Total                                  |           148 |            47 |             195 |               0 |

All 47 exact failed IDs and full assertion output remain in
`red-green-adjudication.json` and `aw-post-num-red-independent.json` under
`out/safejs-remediation/source-exceptions-integrated-validation/`.
The eighteen Nash failures comprise ten originals, three plain-record propagation
paths, four plain-record capture cases and the copied-host-result source-local
identity control. This is genuine sensitivity to AW, not a waived baseline defect.

## Thirteen unchanged originals

Native execution occurred first. All thirteen sources are byte-identical to their
explicitly allowlisted audit originals, including final newlines. Both embedded
author/Nash source arrays were independently AST-extracted and compared: 26 exact
source copies. No original was replaced with an Error rewrite or smaller example.

Each row below compares the **entire** result envelope, complete return value and
ordered tick log. The full expected/native, independent post-NUM and integrated
actual values are retained in `original-three-state-adjudication.json`; sources,
inputs and exact bounded commands are retained in the fresh command records.

| Original ID                     | Post-NUM versus native | Integrated versus native |
| ------------------------------- | ---------------------- | ------------------------ |
| `01-waterfall-identity`         | MISMATCH               | MATCH                    |
| `02-auto-dependency-closures`   | MATCH                  | MATCH                    |
| `03-maplimit-lexical-state`     | MATCH                  | MATCH                    |
| `04-nested-finally-precedence`  | MISMATCH               | MATCH                    |
| `05-saga-delegation-cleanup`    | MISMATCH               | MATCH                    |
| `06-scan-reduce-state`          | MISMATCH               | MATCH                    |
| `07-forkjoin-last-values`       | MISMATCH               | MATCH                    |
| `08-plain-thenable-combinators` | MISMATCH               | MATCH                    |
| `09-rejection-identity-matrix`  | MISMATCH               | MATCH                    |
| `10-recovery-annotation`        | MISMATCH               | MATCH                    |
| `11-waterfall-error-instance`   | MATCH                  | MATCH                    |
| `12-finally-domain-records`     | MISMATCH               | MATCH                    |
| `13-domain-error-metadata`      | MISMATCH               | MATCH                    |

The post-NUM full-value observation uses the same hash-checked in-memory overlay.
Its first JSON-reporter attempt ran thirteen observational tests but suppressed
console records, so the parent correctly rejected the missing observations. The
attempt and parser diagnostic are preserved. The verbose repeat captures all
thirteen full records: three matches and ten mismatches before AW, thirteen full
matches after AW. The 98 tests filtered only for that diagnostic are not counted
as passing coverage; all 195 unchanged tests pass separately.

## Forty fresh captures and AR-001 boundary

The native case generator and current capture program are executed anew, not read
as cached outcomes. All forty fresh serialized snapshots are retained with source,
complete native value, uninterrupted result, restored result, SHA-256 and bytes
in `fresh-capture-comparisons.json` and the command records. All forty complete
uninterrupted outputs and all forty complete restored outputs match native.

The ten value kinds are checked before catch and after catch mutation, with next
and current capture: 10 × 2 × 2 = 40. This covers closure readers, original/caught
reason, context/cause/array aliases, bidirectional mutation and supported metadata.
The four post-NUM plain-record capture failures also recur in the unmodified RED
suite and pass after AW. All envelopes retain current format version **1** and
execution semantics **jobs-v6**; nothing rewrites either marker.

Twenty next-yield cases use a declared pure host operation with re-issue recovery.
The twenty current cases retain Nash's existing finite low-level closure/promise
gate **outside** an active injected host call. This is a bounded low-level capture
control, not a private adapter added by this review or a public host-call workaround.
The independent public guard test still requires
`Sandbox object is already running.` when `dumpCurrent` is called during an
active injected host operation. That negative assertion passes in RED and GREEN.
**AR-001 remains separate and unsupported at that boundary.** No arbitrary
historical snapshot recovery, all-external exactly-once behavior or retained-host
callback lifetime is certified.

## Fresh gates and cache accounting

All commands run only in this clone with `env -u TERM`. Exact argument arrays,
stdin inputs, full stdout/stderr, exit status and timestamps are stored in reviewer
JSON records. There are no weakened assertions, changed timeouts, new skipped
tests, altered configs or production changes.

| Evidence record                               | Actual command or exact scope                                                                                                               | Result                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `aw-unchanged-195-fresh.json`                 | `env -u TERM ./node_modules/.bin/vitest run` with the three unchanged AW targets, `--reporter=json`                                         | 195 pass, 0 fail                                                                             |
| `num-and-prior-published-controls-fresh.json` | Same runner with 26 explicit targets in command record                                                                                      | 1,510 pass, 0 fail                                                                           |
| `broad-relevant-fresh.json`                   | `env -u TERM ./node_modules/.bin/vitest run packages/safejs/src packages/agent-harness/src packages/toolcraft-codemode/src --reporter=json` | 5,085 pass, 34 existing skips, 0 fail; 175 files                                             |
| `full-build-force-fresh.json`                 | `env -u TERM TURBO_FORCE=true npm run build`                                                                                                | PASS: 67 workspace tasks execute, 0 cached; root codegen, TypeScript and bundle also execute |
| `configured-new-test-types-fresh.json`        | Parse `packages/safejs/tsconfig.json`; compile its options with only `noEmit:true` overriding, five explicit new NUM/AW test roots          | PASS, 0 diagnostics                                                                          |
| `safejs-source-types-fresh.json`              | `env -u TERM ./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`                                                             | PASS                                                                                         |
| `root-types-fresh.json`                       | `env -u TERM npm run lint:types`                                                                                                            | PASS                                                                                         |
| `configured-root-eslint-fresh.json`           | `env -u TERM npm run lint:eslint -- --max-warnings=0`                                                                                       | PASS                                                                                         |
| `configured-package-lint-fresh.json`          | `env -u TERM npm run lint:packages`                                                                                                         | PASS, 17 rules / 68 packages                                                                 |
| `post-build-num-aw-317-fresh.json`            | Same Vitest runner, seven explicit NUM/AW targets, `--reporter=json`                                                                        | 317 pass, 0 fail                                                                             |
| `all-publishable-format.json`                 | `env -u TERM ./node_modules/.bin/prettier --check` on all 18 publishables plus this reviewer report                                         | PASS                                                                                         |
| `final-diff-check.json`                       | `env -u TERM git diff --check`                                                                                                              | PASS                                                                                         |

`build-cache-classification.json` records all 67 explicit cache-bypass lines and
zero cache hits. These are fresh workspace builds, not replayed Turbo log/cache
results. Root compilation/codegen/bundling ran after them. Every reported test
result is a fresh invocation; old manifest outcomes are used for comparison only.
Counts overlap: the 195 and NUM tests are contained in the 317 combined gate, and
these overlap the 1,510/5,085 controls. They must not be added as unique coverage.
The eighteen extra public-run/native interaction cases are diagnostic cases, not
additional Vitest test files. All host stubs are bounded and in memory, with no
LLM requests or guest real IO; no unit filesystem writes were introduced.

## Exact ordering and preimage metadata

Apply the eleven-file NUM prerequisite first, then the seven-file AW delta as a
separate unit. Their path sets are disjoint. AW changes only these two production
paths; the other five AW files are three unchanged tests and two preserved plans.
The merged author plan's existing append-only integration section stays frozen.

| AW production path                          | Required post-NUM preimage SHA-256                                 | Bytes | AW postimage SHA-256                                               | Bytes |
| ------------------------------------------- | ------------------------------------------------------------------ | ----: | ------------------------------------------------------------------ | ----: |
| `packages/safejs/src/interp/exceptions.ts`  | `5ed3c8b300df2eb36d8e51afa8cfe6ae9bbe82b7c1c9586d16d9eff4abcdecbf` | 18994 | `079e267b3c55d4f3dac843c3d70faea15e2fe7cb352ba734b532b8bdbbf89127` | 19131 |
| `packages/safejs/src/interp/interpreter.ts` | `50175cb793ecf85ce80cf0e7f0d2667680090eed8c70c20c1f9158e6cab8cbdb` | 99219 | `f3b7c19f4ef98ec757e40d8a8c8a6d372329f80c5a12f8617b41ea198b01b132` | 99431 |

Exact current AW production preimage artifact paths:

- `out/safejs-remediation/source-exceptions-integration/aw-delta/preimages/packages/safejs/src/interp/exceptions.ts`
- `out/safejs-remediation/source-exceptions-integration/aw-delta/preimages/packages/safejs/src/interp/interpreter.ts`

For interpreter.ts, **do not use the isolated old AW base preimage**
`bcf749b3e19160ac30d7448fc03f2b65e85bef9b2cb217952badea504a161e61`.
The required current/post-NUM preimage is the 99,219-byte
`50175cb793ecf85ce80cf0e7f0d2667680090eed8c70c20c1f9158e6cab8cbdb`,
which retains the current upstream interpreter work. The exceptions.ts preimage
is unchanged from its isolated old AW base, but its hash must still be checked.

`ordering-overlap-metadata.json` additionally lists NUM production paths:
`interp/async.ts`, `interp/methods/function.ts`, `interp/values.ts`,
`parse/bindings.ts` and `snapshot/restore.ts`, each with exact pre/post hashes.
The root can compare those paths and the two AW paths against future CTX/CBI/AR
manifests. This is metadata for ordering, **not** a claim about those candidates'
contents, an additional repair assignment, or validation of another clone.
An overlapping future edit requires a new three-way integration and validation;
blind replacement with either old or currently frozen interpreter bytes is unsafe.

## Immutable capture and limits

The reviewer capture is
`out/safejs-remediation/source-exceptions-integrated-validation/candidate/manifest.json`.
It contains the seven AW-only publishables, the separate eleven-file NUM prerequisite,
exact base/post-NUM/old-approved preimages and postimages, SHA-256 and byte lengths.
Content-addressed read-only blobs preserve exact author bytes. This new report is
separate validation evidence, not an eighth AW implementation publishable. Nash's
old report and test remain immutable inputs, not replaced by the review report.

No production edit, semantic repair, README change, other-clone write, Git
index/branch/commit change, push or publication occurs. Build-generated terminal
font assets remain nonpublishable. Reviewer writes are confined to this report and
its dedicated evidence directory; all evidence and failed attempts are preserved.

READY certifies only this exact integrated tree and the bounded tests described
here. It does not certify arbitrary Error descriptors, active-host current capture,
all historical snapshots, a future actual-main tree, the entire repository test
suite, release readiness or live providers. The publisher must verify actual-main
and post-NUM preimages again and run fresh full gates after final ordering/merges.
**No publication authorization is granted.**
