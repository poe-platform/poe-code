# Diff-patch test cohort: decisions and qualification

## Subsequent parent authorization

After reviewing the no-ship inspection, the parent explicitly authorized renaming
the CURRENT 25 diff-patch test entry files and adding a current static aggregate.
All 1,128 cases and test/helper bodies must remain byte-identical. All 13 existing
helper/reference/history files, including verifier and manifest bytes, remain
untouched. No compatibility wrappers, runner exclusions, or concurrency changes
are authorized.

The parent clarified that historical filename references alone do not block this
current-family change: the original verifier binds its recorded dependency
revision, not moving HEAD. Eleven current hashes already differ from that
snapshot. Preserve the original protocol for its recorded revision; do not
reseal it, rewrite its evidence, or claim its old gate passes on the new layout.

This subsequent decision supersedes the initial no-ship decision below without
erasing its discovery, source-binding findings, baseline measurements, or exact
name inventory. Current old/new path hashes and completed independent
aggregation qualification follow.

## Current-family implementation and qualification

Qualified on September 1, 2026 under the subsequent parent authorization.
Keep the current aggregate for parent review: all 25 case modules are
byte-identical to their original current test bodies, all 1,128 names/assertions
remain, and every one of the 13 helper/reference/history files retains its
original bytes and path. Their hashes remain recorded below. The old historical
verifier was not executed, modified, resealed, or claimed to pass on this layout.
Its protocol remains unchanged for the dependency revision it recorded.

### Current changes and isolation boundary

Added `packages/safe-bash/tests/commands/diff-patch/diff-patch.test.ts`: exactly
25 static side-effect imports of the renamed `.cases.js` modules, in original
lexical discovery order. Aggregate SHA-256:
`f55498442dda943d10967b819b816caa1e353496ac0c74f6644f0dbc4ad17189`.
No helper abstraction, factory, reset hook, duplicate compatibility entrypoint,
runner change, discovery exclusion, or concurrency change was introduced.

Per-file process isolation deliberately becomes per-family process isolation:
25 entrypoint processes become one for this family. Other families retain their
normal isolation. Case-local filesystems, command instances, buffers, streams,
controllers, and timers retain their existing construction and cleanup. A
catastrophic child-process failure could affect the family instead of just one
former file; ordinary assertion failures were checked not to suppress sibling
cases. Module startup is shared, not per-case mutable execution state.

The single-entrypoint discovery assertion failed against the original 25 paths
and passed after aggregation. At that checkpoint, authenticated total discovery
changed from 599 to 575, with the exact non-family list unchanged. All 1,128
family cases remain; only 24 redundant entrypoints disappear. The latest audit
visited 1,355 active dependency paths and seven package JSON configurations,
with no old-path consumers and no omitted queued paths. Historical filename
references remain deliberately unchanged, as explicitly authorized.

### Current old/new paths and body hashes

All paths in this table are relative to
`packages/safe-bash/tests/commands/diff-patch/`. The single SHA-256 in each row
matches the original current `.test.ts` body and final `.cases.ts` body,
including every assertion, fixture literal, loop, timeout, import, and line.

| Previous current path | New current path | Tests | Identical body SHA-256 |
| --- | --- | ---: | --- |
| `cancellation.test.ts` | `cancellation.cases.ts` | 9 | `a89c8ff6695cbaf04a367da0f99af8f456fe062ab6871b165b9c8d7e8f9f3ae0` |
| `diff-formats.test.ts` | `diff-formats.cases.ts` | 365 | `399a924c28f6881a4cba3b038b574bfce32ffeacb105d2bd33fffb5ab563e310` |
| `diff-gnu-options.test.ts` | `diff-gnu-options.cases.ts` | 185 | `b57fa31f8ccc7f6e5b4fb471d0d36b8d9e3aaee5839788f186cca9632223ed62` |
| `diff.test.ts` | `diff.cases.ts` | 38 | `951b9d9617ca18832fd3e92d299bc34285216c44b03dfd410af0131eda7a0a30` |
| `hunk-regressions.test.ts` | `hunk-regressions.cases.ts` | 27 | `ad32bd4dfa169b260dfe3d6843e1f26d6e47442000534caf2912a924fa250cd6` |
| `options-regressions.test.ts` | `options-regressions.cases.ts` | 30 | `efdf8195cd39783916b3a070746102f1253606fed801d3f4ba8c1d56a6f6497d` |
| `patch-absolute.test.ts` | `patch-absolute.cases.ts` | 11 | `5f4f3ff1337cddbd99dd0b878e306221406b97be1c391fef99b668ae309ef46f` |
| `patch-authorization-followup.test.ts` | `patch-authorization-followup.cases.ts` | 7 | `ff631df5c0f1a6b2dadbc0b35266e39c95fe6f8d99db4cc8cdb7eeaf59dc22a5` |
| `patch-candidate-errors-followup.test.ts` | `patch-candidate-errors-followup.cases.ts` | 13 | `6cce68187f8871c28908788cde48d8fb530be8b2deee459171b1f57dd3cf2c12` |
| `patch-commit-followup.test.ts` | `patch-commit-followup.cases.ts` | 3 | `fb13bc9e57fd28a57f2f5b24d9ea8ca6012149bc238e6e13f55297c7e25e7b33` |
| `patch-editflows.test.ts` | `patch-editflows.cases.ts` | 56 | `2cf78494ab4bc246cf1fd16351e3299cb6285a8095e75e847437ce1237a11696` |
| `patch-empty.test.ts` | `patch-empty.cases.ts` | 16 | `61025c5581605cfad4d57187b0faf9d38a938fad4a516ed1bd07f12220736874` |
| `patch-epoch.test.ts` | `patch-epoch.cases.ts` | 44 | `722a21bde6b3c88feada4f1ecbabca66808918abc4f994ca1d059e243bc177a1` |
| `patch-formats.test.ts` | `patch-formats.cases.ts` | 56 | `ebb0f8a075139c8eb10d756d52ac75ac679a7a9ee6b9b5081e5254917e8b05d8` |
| `patch-gnu-publication.test.ts` | `patch-gnu-publication.cases.ts` | 12 | `a70d6cbfc3edf4da637424575d53c402ac8d32746209cfd1ce57ca501c124b5a` |
| `patch-interstitial-followup.test.ts` | `patch-interstitial-followup.cases.ts` | 16 | `b844a42627990b4334a86bfc377539b0b53267558b0e210f178226e6a44c2075` |
| `patch-metadata-boundary-followup.test.ts` | `patch-metadata-boundary-followup.cases.ts` | 1 | `d4107b47ccfc59e8e8f846fd013861d334693aff1ea3837b19ff18a7145b7d85` |
| `patch-namespace-followup.test.ts` | `patch-namespace-followup.cases.ts` | 28 | `32820f48cbb3af6df4036a5dd9e9a9ec0c1df21efb5087f148a49a2c9d1d2d8b` |
| `patch-parser.test.ts` | `patch-parser.cases.ts` | 53 | `9c2fd583cba0d57c29fb0f4bac869f03c13befd2a277226245cef2d50022a3b5` |
| `patch-quiet.test.ts` | `patch-quiet.cases.ts` | 40 | `0ef016022ea3242badc0d8add5641ddd03b545ecc7a8e12006ffd666a604b269` |
| `patch-reject-orientation-followup.test.ts` | `patch-reject-orientation-followup.cases.ts` | 43 | `0039c924cba1af3c2af869195054a7e875e35bc72155cea535b663c686d7fd70` |
| `patch-strip-followup.test.ts` | `patch-strip-followup.cases.ts` | 3 | `ddde0dec49d3eab1e0ca2ef8767b8900cda957de2f9a12ee29bcd0afe7ecf9b6` |
| `patch.test.ts` | `patch.cases.ts` | 39 | `de57cc58089746aeec3a6755c60fadf3f441c25f0ee95c699d74cbc066211cca` |
| `safety.test.ts` | `safety.cases.ts` | 28 | `ca3bc6adadf3ad8d17714e7ecfbb69f5e90810c4fe56f9de7a80f3eda83e15cd` |
| `shell.test.ts` | `shell.cases.ts` | 5 | `8a3e90195ae0f9044d3d9bb052dbde1014065f0f54900c3580b2e730c8ae11f9` |

The exact full-family name arrays retained later in this document still apply
without a single name change; map each historical `.test.ts` section label
through this table. Compact JSON of the ordered 1,128 emitted TAP names retains
SHA-256 `83e2a6181ba242af2aeccfa865b3a20b79b25caf4cf47f66279799a55b2c3cc8`.

### Counterbalanced serial timing

Six runs per layout, in new/old/old/new order repeated three times. Each child
finishes before the next starts. Both layouts use the existing serial setting
`--test-concurrency=1`; normal Node process isolation stays enabled.

Old-layout comparisons explicitly pass the 25 byte-identical `.cases.ts`
files as separate Node entrypoints. New-layout comparisons pass the single
aggregate. Thus both layouts use identical current case filenames and bodies,
avoiding a filename/transform-cache confound. No cache clearing or cohost-load
control was imposed. These are live local family measurements, not full-workspace
or release-performance claims. Darwin arm64, Node v22.22.2, package-local tsx 4.23.12.

Before this series, an original-path baseline passed 1128/1128 in
13564.816 ms wall time, and the first aggregate
passed 1128/1128 in 2131.109 ms. Those warm-up
observations are not included in the counterbalanced medians.

| Counterbalanced sweep | Wall ms | Node TAP duration ms | Pass / tests |
| --- | ---: | ---: | ---: |
| diff-patch-balanced-1-new | 2407.466 | 2358.840 | 1128 / 1128 |
| diff-patch-balanced-2-old | 12150.632 | 12092.707 | 1128 / 1128 |
| diff-patch-balanced-3-old | 10861.243 | 10811.420 | 1128 / 1128 |
| diff-patch-balanced-4-new | 2206.479 | 2158.337 | 1128 / 1128 |
| diff-patch-balanced-5-new | 2241.895 | 2195.638 | 1128 / 1128 |
| diff-patch-balanced-6-old | 12220.558 | 12166.708 | 1128 / 1128 |
| diff-patch-balanced-7-old | 10618.173 | 10549.823 | 1128 / 1128 |
| diff-patch-balanced-8-new | 2191.163 | 2143.526 | 1128 / 1128 |
| diff-patch-balanced-9-new | 2294.330 | 2246.514 | 1128 / 1128 |
| diff-patch-balanced-10-old | 12505.547 | 12446.571 | 1128 / 1128 |
| diff-patch-balanced-11-old | 10011.416 | 9962.405 | 1128 / 1128 |
| diff-patch-balanced-12-new | 1848.267 | 1803.178 | 1128 / 1128 |

Median wall time: **11.506 s old → 2.224 s new**;
**80.67% less wall time**, **5.17x faster**,
**9.282 s saved** per family run. Every measured
run exits 0 with all 1,128 exact names in the same order, no stderr, and zero
failures/cancellations/skips/TODOs. Wall time includes child startup and exit;
Node duration is its TAP summary, not summed per-case durations.

The 248 admitted production TypeScript files were hashed immediately before
and after the counterbalanced series and again after final verification.
Sorted compact-JSON `[relativePath, sha256]` inventory digest remained
`23c44178009dddc3c7e2741b4b331004fab44379b25b68abfa3477899abcd2a1`.
Existing held-source/evidence/fixture boundaries were respected. This is source
stability over the measured checks, not whole-commit or service qualification.

### Shared-process and failure qualification

Three temporary same-process probes imported all unchanged cases forward,
reverse-by-module, then forward again. Distinct module URL queries force each
case module to register again while sharing normal helper/product imports.
Within each module the original registration order remains intact. Each probe
passed **3384/3384**, with the exact forward/reverse/forward name sequence,
no stderr, and zero failures/cancellations/skips/TODOs. Wall times were
4704.771, 4626.247, 5323.933 ms.
No state leakage was observed in these repeated/order checks; this does not
prove every possible future module-global mutation is safe. The temporary
entrypoint was removed.

For meaningful negative checks, insert one temporary `assert.fail` at the
first registered test callback in each of the 25 modules. Parameterized loops
produce **411 intentional failures and 717 passes**, retaining all **1128**
names. Both old-layout and aggregate TAP runs exit 1 and produce identical
failure-name sequences and totals, with zero cancellations/skips/TODOs. Every
module's exact injected assertion file/line appears in its failure stack.

The maintained concise reporter also exits 1, retains all 411 failing names,
reports the same 1128/717/411 totals, and attributes assertions to the correct
`.cases.ts` file/line in all 25 modules rather than only to the aggregate.
The ad-hoc comparison initially treated TAP-doubled backslashes as literal
concise-rendered names; that checker mismatch was corrected by decoding those
TAP escapes and repeating the maintained-reporter probe. Neither case bodies
nor reporter behavior was changed to accommodate it. These are intentional
negative runs, not production regressions or passing-case counts.

All injected assertions were removed, and all 25 original body hashes plus all
13 helper/history hashes were rechecked. Final inventory is exactly 39 files:
25 renamed cases, the aggregate, and the original 13 preserved files. No
compatibility wrapper, temporary probe, or extra duplicate test remains.

### Final scoped validation and reproduction

After restoring all bodies, the aggregate passes **1128/1128** under TAP and
separately **1128/1128** under the maintained concise reporter, with zero
failures/cancellations/skips/TODOs and no stderr. The maintained discovery and
reporter regression files pass **106/106** with the same zero-failure/skip
conditions. Their Node duration was 20319.039 ms. None of these results claims
the historical original70 verifier passes against moving HEAD.

Run from `packages/safe-bash`:

```sh
node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/commands/diff-patch/*.cases.ts
node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/commands/diff-patch/diff-patch.test.ts
node --import tsx --test --test-concurrency=1 --test-reporter=./scripts/test-reporting.mjs tests/commands/diff-patch/diff-patch.test.ts
node --test --test-concurrency=1 --test-reporter=tap scripts/integration-inputs.test.mjs scripts/test-reporting.test.mjs
```

Manual repeat/order check: temporarily create an owned `.mjs` entrypoint with
static imports of every `.cases.ts` using a first-pass URL query, reverse the
module order using a second query, then restore forward order with a third query.
Run three times; require the exact 3,384-name sequence each time, then remove it.
For negative attribution, inject at the first test callback in each module,
compare old/new TAP names and counts and concise file/line/name attribution,
remove all injections, and require original hashes plus clean full-family runs.
No permanent QA script or extra testing infrastructure is added.

Only the current 25 test paths, the aggregate, and this plan are changed.
Helpers, historical protocol/evidence, production, package configuration,
runners, text-program scope, and the frozen checkout are untouched. No Git or
raw ESLint commands were used. Parent owns remaining whole-workspace gates,
staging, commits, push, and release; none is claimed here.

## Initial no-ship decision (superseded)

On September 1, 2026, leave all 25 diff-patch test entrypoints standalone.
No tests are renamed, no aggregate is added, and no isolation or concurrency
behavior changes. The only delivered change is this document.

The local historical executable `pruning-consumer/run.mjs` reads
`pruning-consumer/original70.json`, requires each original filename and its
SHA-256 at lines 15–16, and requires the exact original 70-file discovery
inventory across diff-patch and diff-patch-stress at lines 17–18. The manifest
names 24 of this family's 25 current test paths. Thirteen current source hashes
still match; eleven already differ from the historical hashes. That prior drift
is not authorization to introduce missing source paths or retire the protocol.
The historical verifier was inspected, not executed or rewritten; this report
does not claim its frozen-candidate gate passes on the current worktree.

Only `patch-quiet.test.ts` is absent from that manifest. A one-file aggregate
would not reduce process/module startups. Renaming any of the other 24 would
break an explicit historical path binding. Under the requirement to preserve
historical evidence and leave unsafe files standalone, no safe multi-file
cohort remains. Do not reinterpret the historical manifest as current passing
coverage, regenerate its seals, copy test bodies into duplicate runners, or add
wrappers/discovery exceptions to force this optimization through.

Further aggregation needs a separate parent decision on historical replay/source
bindings. No such archival or runner change is included in this assignment.
The accepted text-program pilot and frozen benchmark checkout are untouched.

## Initial scope and audit

Owned scope was `packages/safe-bash/tests/commands/diff-patch/**` and this
plan. All 38 pre-existing files in the owned test tree remain byte-identical:
25 test files and 13 helper, reference, documentation, and consumer-evidence files.
No original filename, assertion, case, helper, fixture, or seal was changed.

The 25 tests were inspected for imports, top-level declarations, hooks, mocks,
ambient state, filesystem overrides, timer lifecycle, and external filename
consumers. Findings:

- No global test hooks, global mocks, environment mutation, process mutation,
  prototype patches, or native/disk fixture imports occur in these 25 tests.
- Imports are node:test/assert, timer promises, case-local helpers, and product
  contracts/commands/shell modules. Helpers create fresh memory filesystems,
  command definitions, output buffers, and abort controllers per invocation.
- Filesystem overrides, counters, deferred reads/writes, and abort reasons are
  scoped to each test instance. Cancellation timers use finally/clearTimeout;
  late-rejection tests explicitly settle their own deferred promises.
- Module fixture tables are const bindings used as read-only input during
  execution. The GNU selector cases array is populated during registration;
  it is not a shared execution counter or filesystem. Const alone was not
  treated as proof of object immutability.
- `patch-gnu-reference.ts` is a separate explicit native capture program. It
  reads GNU_PATCH_BINARY, checks a pinned version, and writes capture artifacts;
  it is not imported by the tests and was neither executed nor aggregated.
- A transitive active test/script/dependency audit visited 1,353 paths, with no
  omitted queued paths, and checked seven package JSON configurations. It found
  no active outside TypeScript/JavaScript literal import of the 25 filenames.
  This does not erase the independently inspected historical executable consumer.
- No authenticated fixture/held boundary names this family. The blocking source
  bindings are in the local historical original70 manifest and verifier instead.
- Historical prose including DIFF-GNU-TESTS.md retains its original version-specific
  claims and names; none were rewritten to describe the current test implementation.

## Pre-authorization baseline validation

Worktree: `/tmp/poe-test-speed-push-20260901`, live and shared with parent work.
Environment: darwin arm64, Node v22.22.2,
resolved package-local tsx 4.23.12. No cache reset or host-load control.

Three complete serial original-layout runs each pass all 1,128 tests, exit 0,
and have zero failures, cancellations, skips, TODOs, or stderr. Exact ordered
TAP names match across all three runs. A separate per-file validation passes
all 25 files and its concatenated names equal the full-family sequence exactly.
Test, helper, and historical file hashes captured before validation match after it.
Authenticated discovery retains exactly the same 25 family entrypoints.

Wall times include child startup and exit, measured with performance.now().
Node duration is the TAP duration_ms summary. These are baseline observations,
not evidence of an improvement or a controlled old/new production comparison.

| Original-layout sweep | Wall ms | Node duration ms | Pass / tests |
| --- | ---: | ---: | ---: |
| diff-patch-original-1 | 11066.991 | 11016.368 | 1128 / 1128 |
| diff-patch-original-2 | 10657.219 | 10576.525 | 1128 / 1128 |
| diff-patch-original-3 | 9271.182 | 9223.946 | 1128 / 1128 |

Median original-layout wall time: 10.657 s.
No new-layout timing, counterbalanced comparison, shared-process/reverse-order
probe, or injected-failure attribution check is claimed: no safe aggregate
candidate was created. Per-file process isolation is unchanged. Those checks
remain required if a later authorized candidate becomes possible; their absence
is not counted as a pass or represented as a skipped test.

Run the full unchanged family from `packages/safe-bash`:

```sh
node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/commands/diff-patch/*.test.ts
```

The serial flag reproduces the existing runner default; no runner, configuration,
concurrency default, or isolation setting was modified. Per-file inventory runs
used the same command with each literal filename, serially. Full workspace build,
typecheck, hooks, commits, push, and release remain parent-owned. No Git or raw
ESLint commands were run. No application/visual CLI changes were made.

## Pre-authorization qualification after the parent rebase

On resumption, the parent reported successful rebase/push to `0611abf45`, with
incoming `bff82562a` changing unrelated standalone filesystem packaging files.
These commit identities are parent-supplied; no Git commands were used here.
All 38 existing diff-patch files and this restored plan matched the pre-pause
bytes before work continued. The accepted text-program scope was not edited.

A fresh original-layout full-family check passed **1128/1128**, exit 0, with
zero failures, cancellations, skips, TODOs, or stderr. Its exact ordered names
match every pre-pause baseline and the complete name inventory below. Wall time
was **16174.178 ms**; Node TAP duration was **16103.243 ms**. This is a separate
post-rebase correctness check, not an old/new performance comparison. Live
cohost load was uncontrolled; do not interpret its timing difference causally.

The 248 admitted production TypeScript source files were hashed immediately
before and after that check. Their sorted `[relativePath, sha256]` pairs,
serialized as compact JSON, remained identical with digest
`23c44178009dddc3c7e2741b4b331004fab44379b25b68abfa3477899abcd2a1`.
Existing held-source, held-evidence, and fixture boundaries were respected.
This checks source stability during the run, not the whole parent commit.

The repeated outside-importer audit again visited 1,353 active dependency paths
and seven package JSON configurations, with no old-path consumers or omitted
queued paths. All 38 family files remained byte-identical after validation.
The historical verifier still binds 24 filenames: 13 hashes match, 11 have
prior drift, and only `patch-quiet.test.ts` is unbound. The no-ship decision is
unchanged: no safe multi-file cohort exists under the current preservation
requirement, and no aggregate, renamed file, or temporary probe was created.

## Pre-authorization unchanged test paths, counts, and hashes

Paths are relative to `packages/safe-bash/tests/commands/diff-patch/`.
Old path equals new path for every row; there are no renamed or added test files.
Matching/drift describes comparison to original70, not current test correctness.
The original manifest remains byte-identical and retains the expected old hashes.

| Unchanged path | Tests | original70 binding | Current SHA-256, before = after |
| --- | ---: | --- | --- |
| `cancellation.test.ts` | 9 | matching hash | `a89c8ff6695cbaf04a367da0f99af8f456fe062ab6871b165b9c8d7e8f9f3ae0` |
| `diff-formats.test.ts` | 365 | prior hash drift | `399a924c28f6881a4cba3b038b574bfce32ffeacb105d2bd33fffb5ab563e310` |
| `diff-gnu-options.test.ts` | 185 | prior hash drift | `b57fa31f8ccc7f6e5b4fb471d0d36b8d9e3aaee5839788f186cca9632223ed62` |
| `diff.test.ts` | 38 | prior hash drift | `951b9d9617ca18832fd3e92d299bc34285216c44b03dfd410af0131eda7a0a30` |
| `hunk-regressions.test.ts` | 27 | prior hash drift | `ad32bd4dfa169b260dfe3d6843e1f26d6e47442000534caf2912a924fa250cd6` |
| `options-regressions.test.ts` | 30 | matching hash | `efdf8195cd39783916b3a070746102f1253606fed801d3f4ba8c1d56a6f6497d` |
| `patch-absolute.test.ts` | 11 | matching hash | `5f4f3ff1337cddbd99dd0b878e306221406b97be1c391fef99b668ae309ef46f` |
| `patch-authorization-followup.test.ts` | 7 | matching hash | `ff631df5c0f1a6b2dadbc0b35266e39c95fe6f8d99db4cc8cdb7eeaf59dc22a5` |
| `patch-candidate-errors-followup.test.ts` | 13 | matching hash | `6cce68187f8871c28908788cde48d8fb530be8b2deee459171b1f57dd3cf2c12` |
| `patch-commit-followup.test.ts` | 3 | matching hash | `fb13bc9e57fd28a57f2f5b24d9ea8ca6012149bc238e6e13f55297c7e25e7b33` |
| `patch-editflows.test.ts` | 56 | matching hash | `2cf78494ab4bc246cf1fd16351e3299cb6285a8095e75e847437ce1237a11696` |
| `patch-empty.test.ts` | 16 | matching hash | `61025c5581605cfad4d57187b0faf9d38a938fad4a516ed1bd07f12220736874` |
| `patch-epoch.test.ts` | 44 | matching hash | `722a21bde6b3c88feada4f1ecbabca66808918abc4f994ca1d059e243bc177a1` |
| `patch-formats.test.ts` | 56 | matching hash | `ebb0f8a075139c8eb10d756d52ac75ac679a7a9ee6b9b5081e5254917e8b05d8` |
| `patch-gnu-publication.test.ts` | 12 | prior hash drift | `a70d6cbfc3edf4da637424575d53c402ac8d32746209cfd1ce57ca501c124b5a` |
| `patch-interstitial-followup.test.ts` | 16 | prior hash drift | `b844a42627990b4334a86bfc377539b0b53267558b0e210f178226e6a44c2075` |
| `patch-metadata-boundary-followup.test.ts` | 1 | prior hash drift | `d4107b47ccfc59e8e8f846fd013861d334693aff1ea3837b19ff18a7145b7d85` |
| `patch-namespace-followup.test.ts` | 28 | prior hash drift | `32820f48cbb3af6df4036a5dd9e9a9ec0c1df21efb5087f148a49a2c9d1d2d8b` |
| `patch-parser.test.ts` | 53 | matching hash | `9c2fd583cba0d57c29fb0f4bac869f03c13befd2a277226245cef2d50022a3b5` |
| `patch-quiet.test.ts` | 40 | not listed | `0ef016022ea3242badc0d8add5641ddd03b545ecc7a8e12006ffd666a604b269` |
| `patch-reject-orientation-followup.test.ts` | 43 | prior hash drift | `0039c924cba1af3c2af869195054a7e875e35bc72155cea535b663c686d7fd70` |
| `patch-strip-followup.test.ts` | 3 | prior hash drift | `ddde0dec49d3eab1e0ca2ef8767b8900cda957de2f9a12ee29bcd0afe7ecf9b6` |
| `patch.test.ts` | 39 | prior hash drift | `de57cc58089746aeec3a6755c60fadf3f441c25f0ee95c699d74cbc066211cca` |
| `safety.test.ts` | 28 | matching hash | `ca3bc6adadf3ad8d17714e7ecfbb69f5e90810c4fe56f9de7a80f3eda83e15cd` |
| `shell.test.ts` | 5 | matching hash | `8a3e90195ae0f9044d3d9bb052dbde1014065f0f54900c3580b2e730c8ae11f9` |

## Preserved non-test files

All paths are under the same family root. These files were hashed before and
after validation; contents and paths are unchanged. No historical capture ran.

| Unchanged path | SHA-256 |
| --- | --- |
| `DIFF-GNU-TESTS.md` | `7a7411e9a061f11a82bbd106dbd62f050beb9e6795a92ea9778e2cafce8c80da` |
| `helpers.ts` | `f99346035352f69b6c07c0cd4091b88e197b31047c8a96e6b31a1480245dd622` |
| `parser-reference-evidence.json` | `54558b7e2c4380f424777a617d7548a03ffc6e612bbf366a5a0b8552532d5e34` |
| `patch-gnu-reference.ts` | `ab035c7e43640020e456b93bea30a2bc7476f325a7906582a978aa5193e74494` |
| `pruning-consumer/README.md` | `0c1e8fe148e689d6eeafc337b3e0a70aace4a695e9b722cbc2f598766773b35c` |
| `pruning-consumer/capture-native.mjs` | `f74089ddcfdbcdc12eecbe40030cc53b4ddf7e01dce57a3228017a123e0d5424` |
| `pruning-consumer/consumer.acceptance.ts` | `2a60f66ed9684b715ed3b9bccbc88566853f0a89fb238dc0a732c1dff12594a2` |
| `pruning-consumer/native-evidence.json` | `aefedc80e8cda88e8f5ccaab02bdadf4989cbb6ce51136ee955203be7f29898d` |
| `pruning-consumer/native-interpose.c` | `968d21fbdeef92d73ced0c56440265e40d298aa1660dadce503c60201a2fca84` |
| `pruning-consumer/original70.json` | `d9fcf133b50ca6dded1403d388c5da80e4fff39fd80c6afdda4180053abe09ec` |
| `pruning-consumer/run.mjs` | `060212b2fe6bb63cc65eb84d0e1012c459ff0126fd38afd1e204af476f6ed741` |
| `pruning-consumer/tsconfig.json` | `ad018abf3da713470f5892e1fce1c20e6297ef7a2b4cfaf5318980305fff1708` |
| `pruning-consumer/verification.json` | `85331e949ca6e7e4ee8577480938aa077bfbf40e290c444ccb51fc12f7f7d7e9` |

## Exact full-family names

The following per-file JSON arrays retain all 1,128 emitted TAP names in original
lexical-file/execution order, including any duplicates. Flattening these arrays
and serializing with compact JSON has SHA-256
`83e2a6181ba242af2aeccfa865b3a20b79b25caf4cf47f66279799a55b2c3cc8`.
Each per-file name sequence was executed and matched the corresponding section
of every complete baseline run; counts are not inferred from source syntax.

<details>
<summary>cancellation.test.ts: 9 passing tests</summary>

```json
[
  "diff rejects pre-aborted signals without reading or writing",
  "patch rejects pre-aborted signals without reading or writing",
  "patch aborts waiting for stdin and observes late iterator failures",
  "diff aborts a blocked output sink and observes its late failure",
  "filesystem waits propagate the signal and observe late rejection",
  "diff computation yields for cancellation before producing output",
  "patch matching yields for cancellation and preflight leaves bytes intact",
  "cancellation during commit leaves only the already-committed prefix",
  "endless empty stdin chunks yield and remain cancellable"
]
```

</details>

<details>
<summary>diff-formats.test.ts: 365 passing tests</summary>

```json
[
  "normal static golden: equal, []",
  "normal static golden: equal, [\"--normal\"]",
  "normal static golden: equal, [\"--normal\",\"--normal\"]",
  "normal static golden: both empty, []",
  "normal static golden: both empty, [\"--normal\"]",
  "normal static golden: both empty, [\"--normal\",\"--normal\"]",
  "normal static golden: replace, []",
  "normal static golden: replace, [\"--normal\"]",
  "normal static golden: replace, [\"--normal\",\"--normal\"]",
  "normal static golden: replace ranges, []",
  "normal static golden: replace ranges, [\"--normal\"]",
  "normal static golden: replace ranges, [\"--normal\",\"--normal\"]",
  "normal static golden: prepend, []",
  "normal static golden: prepend, [\"--normal\"]",
  "normal static golden: prepend, [\"--normal\",\"--normal\"]",
  "normal static golden: insert, []",
  "normal static golden: insert, [\"--normal\"]",
  "normal static golden: insert, [\"--normal\",\"--normal\"]",
  "normal static golden: append, []",
  "normal static golden: append, [\"--normal\"]",
  "normal static golden: append, [\"--normal\",\"--normal\"]",
  "normal static golden: delete first, []",
  "normal static golden: delete first, [\"--normal\"]",
  "normal static golden: delete first, [\"--normal\",\"--normal\"]",
  "normal static golden: delete middle, []",
  "normal static golden: delete middle, [\"--normal\"]",
  "normal static golden: delete middle, [\"--normal\",\"--normal\"]",
  "normal static golden: delete last, []",
  "normal static golden: delete last, [\"--normal\"]",
  "normal static golden: delete last, [\"--normal\",\"--normal\"]",
  "normal static golden: empty old, []",
  "normal static golden: empty old, [\"--normal\"]",
  "normal static golden: empty old, [\"--normal\",\"--normal\"]",
  "normal static golden: empty new, []",
  "normal static golden: empty new, [\"--normal\"]",
  "normal static golden: empty new, [\"--normal\",\"--normal\"]",
  "normal static golden: empty old incomplete, []",
  "normal static golden: empty old incomplete, [\"--normal\"]",
  "normal static golden: empty old incomplete, [\"--normal\",\"--normal\"]",
  "normal static golden: empty new incomplete, []",
  "normal static golden: empty new incomplete, [\"--normal\"]",
  "normal static golden: empty new incomplete, [\"--normal\",\"--normal\"]",
  "normal static golden: incomplete old, []",
  "normal static golden: incomplete old, [\"--normal\"]",
  "normal static golden: incomplete old, [\"--normal\",\"--normal\"]",
  "normal static golden: incomplete new, []",
  "normal static golden: incomplete new, [\"--normal\"]",
  "normal static golden: incomplete new, [\"--normal\",\"--normal\"]",
  "normal static golden: incomplete both, []",
  "normal static golden: incomplete both, [\"--normal\"]",
  "normal static golden: incomplete both, [\"--normal\",\"--normal\"]",
  "normal static golden: multiple hunks, []",
  "normal static golden: multiple hunks, [\"--normal\"]",
  "normal static golden: multiple hunks, [\"--normal\",\"--normal\"]",
  "normal static golden: original UTF-8 CRLF and blanks, []",
  "normal static golden: original UTF-8 CRLF and blanks, [\"--normal\"]",
  "normal static golden: original UTF-8 CRLF and blanks, [\"--normal\",\"--normal\"]",
  "normal format conflict status: [\"-u\",\"--normal\"]",
  "normal format conflict status: [\"--normal\",\"-u\"]",
  "normal format conflict status: [\"--normal\",\"-U0\"]",
  "normal format conflict status: [\"--unified=1\",\"--normal\"]",
  "normal output is atomic on budget failure: {\"maxInputBytes\":1}",
  "normal output is atomic on budget failure: {\"maxOutputBytes\":1}",
  "normal output is atomic on budget failure: {\"maxLines\":1}",
  "normal output is atomic on budget failure: {\"maxMatrixCells\":1}",
  "normal output is atomic on budget failure: {\"maxWork\":1}",
  "normal output is atomic on budget failure: {\"maxHunks\":1}",
  "normal cancellation interrupts comparison without output",
  "normal stdin, missing-file and brief label behavior",
  "context static golden: replacement",
  "context static golden: pure insertion omits old body",
  "context static golden: pure deletion omits new body",
  "context static golden: empty old incomplete",
  "context static golden: empty new incomplete",
  "context static golden: incomplete both",
  "context static golden: incomplete context",
  "context static golden: separated delete and insert",
  "context output status: equal, [\"-c\"]",
  "context output status: equal, [\"--context\"]",
  "context output status: equal, [\"-C0\"]",
  "context output status: equal, [\"-C\",\"1\"]",
  "context output status: equal, [\"--context=9\"]",
  "context output status: both empty, [\"-c\"]",
  "context output status: both empty, [\"--context\"]",
  "context output status: both empty, [\"-C0\"]",
  "context output status: both empty, [\"-C\",\"1\"]",
  "context output status: both empty, [\"--context=9\"]",
  "context output status: replace, [\"-c\"]",
  "context output status: replace, [\"--context\"]",
  "context output status: replace, [\"-C0\"]",
  "context output status: replace, [\"-C\",\"1\"]",
  "context output status: replace, [\"--context=9\"]",
  "context output status: replace ranges, [\"-c\"]",
  "context output status: replace ranges, [\"--context\"]",
  "context output status: replace ranges, [\"-C0\"]",
  "context output status: replace ranges, [\"-C\",\"1\"]",
  "context output status: replace ranges, [\"--context=9\"]",
  "context output status: prepend, [\"-c\"]",
  "context output status: prepend, [\"--context\"]",
  "context output status: prepend, [\"-C0\"]",
  "context output status: prepend, [\"-C\",\"1\"]",
  "context output status: prepend, [\"--context=9\"]",
  "context output status: insert, [\"-c\"]",
  "context output status: insert, [\"--context\"]",
  "context output status: insert, [\"-C0\"]",
  "context output status: insert, [\"-C\",\"1\"]",
  "context output status: insert, [\"--context=9\"]",
  "context output status: append, [\"-c\"]",
  "context output status: append, [\"--context\"]",
  "context output status: append, [\"-C0\"]",
  "context output status: append, [\"-C\",\"1\"]",
  "context output status: append, [\"--context=9\"]",
  "context output status: delete first, [\"-c\"]",
  "context output status: delete first, [\"--context\"]",
  "context output status: delete first, [\"-C0\"]",
  "context output status: delete first, [\"-C\",\"1\"]",
  "context output status: delete first, [\"--context=9\"]",
  "context output status: delete middle, [\"-c\"]",
  "context output status: delete middle, [\"--context\"]",
  "context output status: delete middle, [\"-C0\"]",
  "context output status: delete middle, [\"-C\",\"1\"]",
  "context output status: delete middle, [\"--context=9\"]",
  "context output status: delete last, [\"-c\"]",
  "context output status: delete last, [\"--context\"]",
  "context output status: delete last, [\"-C0\"]",
  "context output status: delete last, [\"-C\",\"1\"]",
  "context output status: delete last, [\"--context=9\"]",
  "context output status: empty old, [\"-c\"]",
  "context output status: empty old, [\"--context\"]",
  "context output status: empty old, [\"-C0\"]",
  "context output status: empty old, [\"-C\",\"1\"]",
  "context output status: empty old, [\"--context=9\"]",
  "context output status: empty new, [\"-c\"]",
  "context output status: empty new, [\"--context\"]",
  "context output status: empty new, [\"-C0\"]",
  "context output status: empty new, [\"-C\",\"1\"]",
  "context output status: empty new, [\"--context=9\"]",
  "context output status: empty old incomplete, [\"-c\"]",
  "context output status: empty old incomplete, [\"--context\"]",
  "context output status: empty old incomplete, [\"-C0\"]",
  "context output status: empty old incomplete, [\"-C\",\"1\"]",
  "context output status: empty old incomplete, [\"--context=9\"]",
  "context output status: empty new incomplete, [\"-c\"]",
  "context output status: empty new incomplete, [\"--context\"]",
  "context output status: empty new incomplete, [\"-C0\"]",
  "context output status: empty new incomplete, [\"-C\",\"1\"]",
  "context output status: empty new incomplete, [\"--context=9\"]",
  "context output status: incomplete old, [\"-c\"]",
  "context output status: incomplete old, [\"--context\"]",
  "context output status: incomplete old, [\"-C0\"]",
  "context output status: incomplete old, [\"-C\",\"1\"]",
  "context output status: incomplete old, [\"--context=9\"]",
  "context output status: incomplete new, [\"-c\"]",
  "context output status: incomplete new, [\"--context\"]",
  "context output status: incomplete new, [\"-C0\"]",
  "context output status: incomplete new, [\"-C\",\"1\"]",
  "context output status: incomplete new, [\"--context=9\"]",
  "context output status: incomplete both, [\"-c\"]",
  "context output status: incomplete both, [\"--context\"]",
  "context output status: incomplete both, [\"-C0\"]",
  "context output status: incomplete both, [\"-C\",\"1\"]",
  "context output status: incomplete both, [\"--context=9\"]",
  "context output status: multiple hunks, [\"-c\"]",
  "context output status: multiple hunks, [\"--context\"]",
  "context output status: multiple hunks, [\"-C0\"]",
  "context output status: multiple hunks, [\"-C\",\"1\"]",
  "context output status: multiple hunks, [\"--context=9\"]",
  "context output status: original UTF-8 CRLF and blanks, [\"-c\"]",
  "context output status: original UTF-8 CRLF and blanks, [\"--context\"]",
  "context output status: original UTF-8 CRLF and blanks, [\"-C0\"]",
  "context output status: original UTF-8 CRLF and blanks, [\"-C\",\"1\"]",
  "context output status: original UTF-8 CRLF and blanks, [\"--context=9\"]",
  "context hunk merge boundary: gap 0, context 0",
  "context hunk merge boundary: gap 0, context 1",
  "context hunk merge boundary: gap 0, context 3",
  "context hunk merge boundary: gap 1, context 0",
  "context hunk merge boundary: gap 1, context 1",
  "context hunk merge boundary: gap 1, context 3",
  "context hunk merge boundary: gap 2, context 0",
  "context hunk merge boundary: gap 2, context 1",
  "context hunk merge boundary: gap 2, context 3",
  "context hunk merge boundary: gap 3, context 0",
  "context hunk merge boundary: gap 3, context 1",
  "context hunk merge boundary: gap 3, context 3",
  "context hunk merge boundary: gap 5, context 0",
  "context hunk merge boundary: gap 5, context 1",
  "context hunk merge boundary: gap 5, context 3",
  "context hunk merge boundary: gap 6, context 0",
  "context hunk merge boundary: gap 6, context 1",
  "context hunk merge boundary: gap 6, context 3",
  "context hunk merge boundary: gap 7, context 0",
  "context hunk merge boundary: gap 7, context 1",
  "context hunk merge boundary: gap 7, context 3",
  "GNU context selectors retain maximum requested width: [\"-C0\",\"-c\"]",
  "GNU context selectors retain maximum requested width: [\"-C0\",\"--context\"]",
  "GNU context selectors retain maximum requested width: [\"--context=1\",\"-rc\"]",
  "GNU context selectors retain maximum requested width: [\"-C\",\"0\",\"-crc\",\"--context\"]",
  "GNU context selectors retain maximum requested width: [\"-c\",\"-C0\"]",
  "GNU context selectors retain maximum requested width: [\"--context\",\"--context=1\"]",
  "GNU context selectors retain maximum requested width: [\"-C0\",\"-c\",\"-C1\",\"--context\"]",
  "context format conflict: [\"-c\",\"-u\"]",
  "context format conflict: [\"-u\",\"-c\"]",
  "context format conflict: [\"--normal\",\"-c\"]",
  "context format conflict: [\"-C0\",\"--normal\"]",
  "context format conflict: [\"-C0\",\"-U0\"]",
  "context format conflict: [\"-uc\"]",
  "context format conflict: [\"-cu\"]",
  "context format conflict: [\"--context\",\"--unified\"]",
  "context validates counts: [\"-C\"]",
  "context validates counts: [\"-C-1\",\"old\",\"new\"]",
  "context validates counts: [\"--context=1.5\",\"old\",\"new\"]",
  "GNU context accepts count \"--context=\" with exact incomplete-line output",
  "GNU context accepts count \"-C9007199254740992\" with exact incomplete-line output",
  "context output is atomic on budget failure: {\"maxInputBytes\":1}",
  "context output is atomic on budget failure: {\"maxOutputBytes\":30}",
  "context output is atomic on budget failure: {\"maxLines\":1}",
  "context output is atomic on budget failure: {\"maxMatrixCells\":1}",
  "context output is atomic on budget failure: {\"maxWork\":1}",
  "context output is atomic on budget failure: {\"maxHunks\":1}",
  "context cancellation interrupts comparison without output",
  "context brief labels and explicit maximum safe context count",
  "whitespace comparison policy",
  "whitespace option status: run amount, change, --normal",
  "whitespace option status: run amount, change, -u",
  "whitespace option status: run amount, change, -c",
  "whitespace option status: run amount, all, --normal",
  "whitespace option status: run amount, all, -u",
  "whitespace option status: run amount, all, -c",
  "whitespace option status: all C-locale whitespace, change, --normal",
  "whitespace option status: all C-locale whitespace, change, -u",
  "whitespace option status: all C-locale whitespace, change, -c",
  "whitespace option status: all C-locale whitespace, all, --normal",
  "whitespace option status: all C-locale whitespace, all, -u",
  "whitespace option status: all C-locale whitespace, all, -c",
  "whitespace option status: trailing run, change, --normal",
  "whitespace option status: trailing run, change, -u",
  "whitespace option status: trailing run, change, -c",
  "whitespace option status: trailing run, all, --normal",
  "whitespace option status: trailing run, all, -u",
  "whitespace option status: trailing run, all, -c",
  "whitespace option status: leading run amount, change, --normal",
  "whitespace option status: leading run amount, change, -u",
  "whitespace option status: leading run amount, change, -c",
  "whitespace option status: leading run amount, all, --normal",
  "whitespace option status: leading run amount, all, -u",
  "whitespace option status: leading run amount, all, -c",
  "whitespace option status: leading run presence, change, --normal",
  "whitespace option status: leading run presence, change, -u",
  "whitespace option status: leading run presence, change, -c",
  "whitespace option status: leading run presence, all, --normal",
  "whitespace option status: leading run presence, all, -u",
  "whitespace option status: leading run presence, all, -c",
  "whitespace option status: internal run presence, change, --normal",
  "whitespace option status: internal run presence, change, -u",
  "whitespace option status: internal run presence, change, -c",
  "whitespace option status: internal run presence, all, --normal",
  "whitespace option status: internal run presence, all, -u",
  "whitespace option status: internal run presence, all, -c",
  "whitespace option status: spacing only blank line, change, --normal",
  "whitespace option status: spacing only blank line, change, -u",
  "whitespace option status: spacing only blank line, change, -c",
  "whitespace option status: spacing only blank line, all, --normal",
  "whitespace option status: spacing only blank line, all, -u",
  "whitespace option status: spacing only blank line, all, -c",
  "whitespace option status: CRLF, change, --normal",
  "whitespace option status: CRLF, change, -u",
  "whitespace option status: CRLF, change, -c",
  "whitespace option status: CRLF, all, --normal",
  "whitespace option status: CRLF, all, -u",
  "whitespace option status: CRLF, all, -c",
  "whitespace option status: missing final newline, change, --normal",
  "whitespace option status: missing final newline, change, -u",
  "whitespace option status: missing final newline, change, -c",
  "whitespace option status: missing final newline, all, --normal",
  "whitespace option status: missing final newline, all, -u",
  "whitespace option status: missing final newline, all, -c",
  "whitespace option status: new missing final newline, change, --normal",
  "whitespace option status: new missing final newline, change, -u",
  "whitespace option status: new missing final newline, change, -c",
  "whitespace option status: new missing final newline, all, --normal",
  "whitespace option status: new missing final newline, all, -u",
  "whitespace option status: new missing final newline, all, -c",
  "whitespace option status: blank line deletion remains significant, change, --normal",
  "whitespace option status: blank line deletion remains significant, change, -u",
  "whitespace option status: blank line deletion remains significant, change, -c",
  "whitespace option status: blank line deletion remains significant, all, --normal",
  "whitespace option status: blank line deletion remains significant, all, -u",
  "whitespace option status: blank line deletion remains significant, all, -c",
  "whitespace option status: whitespace line deletion remains significant, change, --normal",
  "whitespace option status: whitespace line deletion remains significant, change, -u",
  "whitespace option status: whitespace line deletion remains significant, change, -c",
  "whitespace option status: whitespace line deletion remains significant, all, --normal",
  "whitespace option status: whitespace line deletion remains significant, all, -u",
  "whitespace option status: whitespace line deletion remains significant, all, -c",
  "whitespace option status: line boundaries remain significant, change, --normal",
  "whitespace option status: line boundaries remain significant, change, -u",
  "whitespace option status: line boundaries remain significant, change, -c",
  "whitespace option status: line boundaries remain significant, all, --normal",
  "whitespace option status: line boundaries remain significant, all, -u",
  "whitespace option status: line boundaries remain significant, all, -c",
  "whitespace option status: NBSP remains significant, change, --normal",
  "whitespace option status: NBSP remains significant, change, -u",
  "whitespace option status: NBSP remains significant, change, -c",
  "whitespace option status: NBSP remains significant, all, --normal",
  "whitespace option status: NBSP remains significant, all, -u",
  "whitespace option status: NBSP remains significant, all, -c",
  "whitespace option status: Unicode em space remains significant, change, --normal",
  "whitespace option status: Unicode em space remains significant, change, -u",
  "whitespace option status: Unicode em space remains significant, change, -c",
  "whitespace option status: Unicode em space remains significant, all, --normal",
  "whitespace option status: Unicode em space remains significant, all, -u",
  "whitespace option status: Unicode em space remains significant, all, -c",
  "whitespace option status: BOM remains significant, change, --normal",
  "whitespace option status: BOM remains significant, change, -u",
  "whitespace option status: BOM remains significant, change, -c",
  "whitespace option status: BOM remains significant, all, --normal",
  "whitespace option status: BOM remains significant, all, -u",
  "whitespace option status: BOM remains significant, all, -c",
  "whitespace option status: case remains significant, change, --normal",
  "whitespace option status: case remains significant, change, -u",
  "whitespace option status: case remains significant, change, -c",
  "whitespace option status: case remains significant, all, --normal",
  "whitespace option status: case remains significant, all, -u",
  "whitespace option status: case remains significant, all, -c",
  "whitespace option status: original non-ASCII bytes, change, --normal",
  "whitespace option status: original non-ASCII bytes, change, -u",
  "whitespace option status: original non-ASCII bytes, change, -c",
  "whitespace option status: original non-ASCII bytes, all, --normal",
  "whitespace option status: original non-ASCII bytes, all, -u",
  "whitespace option status: original non-ASCII bytes, all, -c",
  "whitespace preserves original bodies and both context sides: -w, normal",
  "whitespace preserves original bodies and both context sides: -w, unified",
  "whitespace preserves original bodies and both context sides: -w, context",
  "whitespace preserves original bodies and both context sides: -b, normal",
  "whitespace preserves original bodies and both context sides: -b, unified",
  "whitespace preserves original bodies and both context sides: -b, context",
  "whitespace brief compares normalized lines and retains labels: [\"-wq\"]",
  "whitespace brief compares normalized lines and retains labels: [\"-qw\"]",
  "whitespace brief compares normalized lines and retains labels: [\"-bq\"]",
  "whitespace brief compares normalized lines and retains labels: [\"--brief\",\"--ignore-space-change\"]",
  "whitespace brief compares normalized lines and retains labels: [\"-wcq\"]",
  "whitespace brief compares normalized lines and retains labels: [\"-buq\"]",
  "whitespace comparison applies to stdin, recursive files, and missing files",
  "whitespace equivalence avoids unnecessary LCS allocation",
  "whitespace --normal output is atomic on budget failure: {\"maxInputBytes\":1}",
  "whitespace --normal output is atomic on budget failure: {\"maxOutputBytes\":1}",
  "whitespace --normal output is atomic on budget failure: {\"maxLines\":1}",
  "whitespace --normal output is atomic on budget failure: {\"maxMatrixCells\":1}",
  "whitespace --normal output is atomic on budget failure: {\"maxWork\":1}",
  "whitespace --normal output is atomic on budget failure: {\"maxHunks\":1}",
  "whitespace -U0 output is atomic on budget failure: {\"maxInputBytes\":1}",
  "whitespace -U0 output is atomic on budget failure: {\"maxOutputBytes\":1}",
  "whitespace -U0 output is atomic on budget failure: {\"maxLines\":1}",
  "whitespace -U0 output is atomic on budget failure: {\"maxMatrixCells\":1}",
  "whitespace -U0 output is atomic on budget failure: {\"maxWork\":1}",
  "whitespace -U0 output is atomic on budget failure: {\"maxHunks\":1}",
  "whitespace -C0 output is atomic on budget failure: {\"maxInputBytes\":1}",
  "whitespace -C0 output is atomic on budget failure: {\"maxOutputBytes\":1}",
  "whitespace -C0 output is atomic on budget failure: {\"maxLines\":1}",
  "whitespace -C0 output is atomic on budget failure: {\"maxMatrixCells\":1}",
  "whitespace -C0 output is atomic on budget failure: {\"maxWork\":1}",
  "whitespace -C0 output is atomic on budget failure: {\"maxHunks\":1}",
  "normalization charges original characters even when all are ignored",
  "whitespace cancellation interrupts normalization without output",
  "whitespace context preserves per-side incomplete-line markers and native parity"
]
```

</details>

<details>
<summary>diff-gnu-options.test.ts: 185 passing tests</summary>

```json
[
  "GNU context selectors [\"-U0\"], stdin=false",
  "GNU context selectors [\"-U0\"], stdin=true",
  "GNU context selectors [\"-U\",\"0\"], stdin=false",
  "GNU context selectors [\"-U\",\"0\"], stdin=true",
  "GNU context selectors [\"-U0\",\"-u\"], stdin=false",
  "GNU context selectors [\"-U0\",\"-u\"], stdin=true",
  "GNU context selectors [\"-u\",\"-U0\"], stdin=false",
  "GNU context selectors [\"-u\",\"-U0\"], stdin=true",
  "GNU context selectors [\"-U8\",\"-U1\"], stdin=false",
  "GNU context selectors [\"-U8\",\"-U1\"], stdin=true",
  "GNU context selectors [\"-U1\",\"-U8\"], stdin=false",
  "GNU context selectors [\"-U1\",\"-U8\"], stdin=true",
  "GNU context selectors [\"-U8\",\"-u\",\"-U1\"], stdin=false",
  "GNU context selectors [\"-U8\",\"-u\",\"-U1\"], stdin=true",
  "GNU context selectors [\"-U0\",\"-U1\",\"-U0\"], stdin=false",
  "GNU context selectors [\"-U0\",\"-U1\",\"-U0\"], stdin=true",
  "GNU context selectors [\"-uU0\"], stdin=false",
  "GNU context selectors [\"-uU0\"], stdin=true",
  "GNU context selectors [\"-ruU1\"], stdin=false",
  "GNU context selectors [\"-ruU1\"], stdin=true",
  "GNU context selectors [\"-U0\",\"-uru\"], stdin=false",
  "GNU context selectors [\"-U0\",\"-uru\"], stdin=true",
  "GNU context selectors [\"-U2147483647\",\"-U0\"], stdin=false",
  "GNU context selectors [\"-U2147483647\",\"-U0\"], stdin=true",
  "GNU context selectors [\"-U9007199254740991\"], stdin=false",
  "GNU context selectors [\"-U9007199254740991\"], stdin=true",
  "GNU context selectors [\"-U999999999999999999999999999999\"], stdin=false",
  "GNU context selectors [\"-U999999999999999999999999999999\"], stdin=true",
  "GNU context selectors [\"--unified=0\"], stdin=false",
  "GNU context selectors [\"--unified=0\"], stdin=true",
  "GNU context selectors [\"--unified=1\",\"--unified\"], stdin=false",
  "GNU context selectors [\"--unified=1\",\"--unified\"], stdin=true",
  "GNU context selectors [\"--unified\",\"--unified=1\"], stdin=false",
  "GNU context selectors [\"--unified\",\"--unified=1\"], stdin=true",
  "GNU context selectors [\"--unified=8\",\"-u\"], stdin=false",
  "GNU context selectors [\"--unified=8\",\"-u\"], stdin=true",
  "GNU context selectors [\"--unified=8\",\"--unified=1\"], stdin=false",
  "GNU context selectors [\"--unified=8\",\"--unified=1\"], stdin=true",
  "GNU context selectors [\"-U0\",\"--unified\"], stdin=false",
  "GNU context selectors [\"-U0\",\"--unified\"], stdin=true",
  "GNU context selectors [\"--unified=1\",\"-ru\"], stdin=false",
  "GNU context selectors [\"--unified=1\",\"-ru\"], stdin=true",
  "GNU context selectors [\"--unified=\"], stdin=false",
  "GNU context selectors [\"--unified=\"], stdin=true",
  "GNU context selectors [\"-U\",\"\"], stdin=false",
  "GNU context selectors [\"-U\",\"\"], stdin=true",
  "GNU context selectors [\"-U\",\"+1\"], stdin=false",
  "GNU context selectors [\"-U\",\"+1\"], stdin=true",
  "GNU context selectors [\"-U\",\"\\\\t+01\"], stdin=false",
  "GNU context selectors [\"-U\",\"\\\\t+01\"], stdin=true",
  "GNU context selectors [\"-U\",\"-00\"], stdin=false",
  "GNU context selectors [\"-U\",\"-00\"], stdin=true",
  "GNU context selectors [\"-0\",\"-u\"], stdin=false",
  "GNU context selectors [\"-0\",\"-u\"], stdin=true",
  "GNU context selectors [\"-u\",\"-0\"], stdin=false",
  "GNU context selectors [\"-u\",\"-0\"], stdin=true",
  "GNU context selectors [\"-u0\"], stdin=false",
  "GNU context selectors [\"-u0\"], stdin=true",
  "GNU context selectors [\"-0u\"], stdin=false",
  "GNU context selectors [\"-0u\"], stdin=true",
  "GNU context selectors [\"-0\",\"--unified\"], stdin=false",
  "GNU context selectors [\"-0\",\"--unified\"], stdin=true",
  "GNU context selectors [\"-0\",\"-U1\"], stdin=false",
  "GNU context selectors [\"-0\",\"-U1\"], stdin=true",
  "GNU context selectors [\"-5\",\"-U1\"], stdin=false",
  "GNU context selectors [\"-5\",\"-U1\"], stdin=true",
  "GNU context selectors [\"-1\",\"-2\",\"-u\"], stdin=false",
  "GNU context selectors [\"-1\",\"-2\",\"-u\"], stdin=true",
  "GNU context selectors [\"-1\",\"-u\",\"-2\"], stdin=false",
  "GNU context selectors [\"-1\",\"-u\",\"-2\"], stdin=true",
  "GNU context selectors [\"-01\",\"-u\"], stdin=false",
  "GNU context selectors [\"-01\",\"-u\"], stdin=true",
  "GNU context selectors [\"-999999999999999999999999\",\"-u\"], stdin=false",
  "GNU context selectors [\"-999999999999999999999999\",\"-u\"], stdin=true",
  "GNU context selectors [\"-C0\"], stdin=false",
  "GNU context selectors [\"-C0\"], stdin=true",
  "GNU context selectors [\"-C\",\"0\"], stdin=false",
  "GNU context selectors [\"-C\",\"0\"], stdin=true",
  "GNU context selectors [\"-C0\",\"-c\"], stdin=false",
  "GNU context selectors [\"-C0\",\"-c\"], stdin=true",
  "GNU context selectors [\"-c\",\"-C0\"], stdin=false",
  "GNU context selectors [\"-c\",\"-C0\"], stdin=true",
  "GNU context selectors [\"-C8\",\"-C1\"], stdin=false",
  "GNU context selectors [\"-C8\",\"-C1\"], stdin=true",
  "GNU context selectors [\"-C1\",\"-C8\"], stdin=false",
  "GNU context selectors [\"-C1\",\"-C8\"], stdin=true",
  "GNU context selectors [\"-C8\",\"-c\",\"-C1\"], stdin=false",
  "GNU context selectors [\"-C8\",\"-c\",\"-C1\"], stdin=true",
  "GNU context selectors [\"-C0\",\"-C1\",\"-C0\"], stdin=false",
  "GNU context selectors [\"-C0\",\"-C1\",\"-C0\"], stdin=true",
  "GNU context selectors [\"-cC0\"], stdin=false",
  "GNU context selectors [\"-cC0\"], stdin=true",
  "GNU context selectors [\"-rcC1\"], stdin=false",
  "GNU context selectors [\"-rcC1\"], stdin=true",
  "GNU context selectors [\"-C0\",\"-crc\"], stdin=false",
  "GNU context selectors [\"-C0\",\"-crc\"], stdin=true",
  "GNU context selectors [\"-C2147483647\",\"-C0\"], stdin=false",
  "GNU context selectors [\"-C2147483647\",\"-C0\"], stdin=true",
  "GNU context selectors [\"-C9007199254740991\"], stdin=false",
  "GNU context selectors [\"-C9007199254740991\"], stdin=true",
  "GNU context selectors [\"-C999999999999999999999999999999\"], stdin=false",
  "GNU context selectors [\"-C999999999999999999999999999999\"], stdin=true",
  "GNU context selectors [\"--context=0\"], stdin=false",
  "GNU context selectors [\"--context=0\"], stdin=true",
  "GNU context selectors [\"--context=1\",\"--context\"], stdin=false",
  "GNU context selectors [\"--context=1\",\"--context\"], stdin=true",
  "GNU context selectors [\"--context\",\"--context=1\"], stdin=false",
  "GNU context selectors [\"--context\",\"--context=1\"], stdin=true",
  "GNU context selectors [\"--context=8\",\"-c\"], stdin=false",
  "GNU context selectors [\"--context=8\",\"-c\"], stdin=true",
  "GNU context selectors [\"--context=8\",\"--context=1\"], stdin=false",
  "GNU context selectors [\"--context=8\",\"--context=1\"], stdin=true",
  "GNU context selectors [\"-C0\",\"--context\"], stdin=false",
  "GNU context selectors [\"-C0\",\"--context\"], stdin=true",
  "GNU context selectors [\"--context=1\",\"-rc\"], stdin=false",
  "GNU context selectors [\"--context=1\",\"-rc\"], stdin=true",
  "GNU context selectors [\"--context=\"], stdin=false",
  "GNU context selectors [\"--context=\"], stdin=true",
  "GNU context selectors [\"-C\",\"\"], stdin=false",
  "GNU context selectors [\"-C\",\"\"], stdin=true",
  "GNU context selectors [\"-C\",\"+1\"], stdin=false",
  "GNU context selectors [\"-C\",\"+1\"], stdin=true",
  "GNU context selectors [\"-C\",\"\\\\t+01\"], stdin=false",
  "GNU context selectors [\"-C\",\"\\\\t+01\"], stdin=true",
  "GNU context selectors [\"-C\",\"-00\"], stdin=false",
  "GNU context selectors [\"-C\",\"-00\"], stdin=true",
  "GNU context selectors [\"-0\",\"-c\"], stdin=false",
  "GNU context selectors [\"-0\",\"-c\"], stdin=true",
  "GNU context selectors [\"-c\",\"-0\"], stdin=false",
  "GNU context selectors [\"-c\",\"-0\"], stdin=true",
  "GNU context selectors [\"-c0\"], stdin=false",
  "GNU context selectors [\"-c0\"], stdin=true",
  "GNU context selectors [\"-0c\"], stdin=false",
  "GNU context selectors [\"-0c\"], stdin=true",
  "GNU context selectors [\"-0\",\"--context\"], stdin=false",
  "GNU context selectors [\"-0\",\"--context\"], stdin=true",
  "GNU context selectors [\"-0\",\"-C1\"], stdin=false",
  "GNU context selectors [\"-0\",\"-C1\"], stdin=true",
  "GNU context selectors [\"-5\",\"-C1\"], stdin=false",
  "GNU context selectors [\"-5\",\"-C1\"], stdin=true",
  "GNU context selectors [\"-1\",\"-2\",\"-c\"], stdin=false",
  "GNU context selectors [\"-1\",\"-2\",\"-c\"], stdin=true",
  "GNU context selectors [\"-1\",\"-c\",\"-2\"], stdin=false",
  "GNU context selectors [\"-1\",\"-c\",\"-2\"], stdin=true",
  "GNU context selectors [\"-01\",\"-c\"], stdin=false",
  "GNU context selectors [\"-01\",\"-c\"], stdin=true",
  "GNU context selectors [\"-999999999999999999999999\",\"-c\"], stdin=false",
  "GNU context selectors [\"-999999999999999999999999\",\"-c\"], stdin=true",
  "GNU grouped whitespace selector evidence [\"-wC0\",\"-c\"]",
  "GNU grouped whitespace selector evidence [\"-bU0\",\"-uw\"]",
  "GNU rejects invalid selectors [\"-u\",\"-c\"]",
  "GNU rejects invalid selectors [\"-c\",\"-u\"]",
  "GNU rejects invalid selectors [\"-uC0\"]",
  "GNU rejects invalid selectors [\"-cU0\"]",
  "GNU rejects invalid selectors [\"-U0\",\"--normal\"]",
  "GNU rejects invalid selectors [\"--normal\",\"-C0\"]",
  "GNU rejects invalid selectors [\"-q\",\"-c\",\"-u\"]",
  "GNU rejects invalid selectors [\"-U0u\"]",
  "GNU rejects invalid selectors [\"-C0c\"]",
  "GNU rejects invalid selectors [\"--unified=-1\"]",
  "GNU rejects invalid selectors [\"--context=bad\"]",
  "GNU rejects invalid selectors [\"-U\",\" \"]",
  "GNU rejects invalid selectors [\"-C\",\"+\"]",
  "GNU rejects invalid selectors [\"-U\",\"1 \"]",
  "GNU rejects invalid selectors [\"-C\",\"0x1\"]",
  "GNU rejects invalid selectors [\"-U\",\"1e2\"]",
  "GNU rejects invalid selectors [\"-u\",\"-Cbad\"]",
  "GNU rejects invalid selectors [\"--normal\",\"--unified=bad\"]",
  "GNU rejects invalid selectors [\"--not-a-diff-option\"]",
  "GNU rejects invalid selectors [\"-J\"]",
  "GNU legacy digits do not select an output style",
  "GNU missing selector argument -U",
  "GNU missing selector argument -C",
  "GNU selectors through Shell plugin: -U0 -u -U1",
  "GNU selectors through Shell plugin: -C8 -c --context=1",
  "GNU selectors through Shell plugin: -u0",
  "GNU selectors retain budgets {\"flags\":[\"-U0\",\"-u\"],\"options\":{\"maxOutputBytes\":24}}",
  "GNU selectors retain budgets {\"flags\":[\"-C999999999999999999999999\"],\"options\":{\"maxOutputBytes\":24}}",
  "GNU selectors retain budgets {\"flags\":[\"-U0\",\"-u\"],\"options\":{\"maxInputBytes\":8}}",
  "GNU selectors retain budgets {\"flags\":[\"-C999999999999999999999999\"],\"options\":{\"maxInputBytes\":8}}",
  "GNU selectors retain budgets {\"flags\":[\"-U0\",\"-u\"],\"options\":{\"maxLines\":4}}",
  "GNU selectors retain budgets {\"flags\":[\"-C999999999999999999999999\"],\"options\":{\"maxLines\":4}}",
  "GNU selectors retain budgets {\"flags\":[\"-U0\",\"-u\"],\"options\":{\"maxWork\":12}}",
  "GNU selectors retain budgets {\"flags\":[\"-C999999999999999999999999\"],\"options\":{\"maxWork\":12}}",
  "GNU maximum context merges hunks before the shared hunk budget"
]
```

</details>

<details>
<summary>diff.test.ts: 38 passing tests</summary>

```json
[
  "native diff exact output and cross-apply: replacement, U0",
  "native diff exact output and cross-apply: replacement, U3",
  "native diff exact output and cross-apply: insertion, U0",
  "native diff exact output and cross-apply: insertion, U3",
  "native diff exact output and cross-apply: deletion, U0",
  "native diff exact output and cross-apply: deletion, U3",
  "native diff exact output and cross-apply: empty old, U0",
  "native diff exact output and cross-apply: empty old, U3",
  "native diff exact output and cross-apply: empty new, U0",
  "native diff exact output and cross-apply: empty new, U3",
  "native diff exact output and cross-apply: unterminated old, U0",
  "native diff exact output and cross-apply: unterminated old, U3",
  "native diff exact output and cross-apply: unterminated new, U0",
  "native diff exact output and cross-apply: unterminated new, U3",
  "native diff exact output and cross-apply: unterminated both, U0",
  "native diff exact output and cross-apply: unterminated both, U3",
  "native diff exact output and cross-apply: CRLF, U0",
  "native diff exact output and cross-apply: CRLF, U3",
  "native diff exact output and cross-apply: UTF-8 BOM, U0",
  "native diff exact output and cross-apply: UTF-8 BOM, U3",
  "native diff exact output and cross-apply: separate hunks, U0",
  "native diff exact output and cross-apply: separate hunks, U3",
  "identical input returns zero without headers",
  "brief comparison, grouped flags, and stdin operands",
  "recursive new-file diffs create, delete, and update with strip",
  "recursive order is deterministic and nonrecursive subdirectories stay unvisited",
  "file-directory matching uses the file basename",
  "literal option-like filenames and labels with spaces",
  "diff rejects invalid arguments [\"-x\",\"a\",\"b\"]",
  "diff rejects invalid arguments [\"--color\",\"a\",\"b\"]",
  "diff rejects invalid arguments [\"-U-1\",\"a\",\"b\"]",
  "diff rejects invalid arguments [\"-U\"]",
  "diff rejects invalid arguments [\"a\"]",
  "diff rejects invalid arguments [\"--label=a\\\\nb\",\"a\",\"b\"]",
  "GNU unified accepts context above the safe integer range with exact incomplete-line output",
  "missing paths require -N; both missing remains an error",
  "symlinks including ancestors are rejected without dereferencing",
  "bounded seeded repeated-line diffs roundtrip in both directions"
]
```

</details>

<details>
<summary>hunk-regressions.test.ts: 27 passing tests</summary>

```json
[
  "unprefixed empty context applies forward",
  "unprefixed empty context applies reverse",
  "unprefixed context preserves empty lines at both hunk edges",
  "--atomic empty context retains validation: truncated body",
  "--atomic empty context retains validation: truncated final physical line",
  "--atomic empty context retains validation: old count overflow",
  "--atomic empty context retains validation: new count overflow",
  "--atomic empty context retains validation: missing prefix on nonempty context",
  "--atomic empty context retains validation: tab is not an empty context line",
  "--atomic empty context retains validation: empty incomplete context",
  "--atomic empty context retains validation: stray newline marker",
  "--atomic empty context retains validation: unknown newline marker",
  "--atomic empty context retains validation: duplicate newline marker",
  "--atomic empty context retains validation: context after incomplete line",
  "--atomic empty context retains validation: no changed lines",
  "empty context remains subject to line and work budgets",
  "empty context parsing observes cancellation before mutation",
  "GNU empty coordinates remain literal before reversal",
  "GNU empty coordinates remain literal for each file section",
  "--atomic empty-range normalization retains rejection: nonempty zero remains invalid",
  "--atomic empty-range normalization retains rejection: both ranges empty",
  "--atomic empty-range normalization retains rejection: unsafe coordinate integer",
  "--atomic empty-range normalization retains rejection: coordinate limit",
  "--atomic empty-range normalization retains rejection: normalized header still checks body overflow",
  "--atomic empty-range normalization retains rejection: normalized header still checks body truncation",
  "--atomic empty-range normalization retains rejection: normalized header cannot hide incomplete middle line",
  "normalized hunks retain hunk and coordinate budgets"
]
```

</details>

<details>
<summary>options-regressions.test.ts: 30 passing tests</summary>

```json
[
  "diff context regression: [\"-U0\",\"-u\"]",
  "diff context regression: [\"-U0\",\"--unified\"]",
  "diff context regression: [\"--unified=1\",\"-ru\"]",
  "diff context regression: [\"-U\",\"0\",\"-uru\",\"--unified\"]",
  "diff context regression: [\"-u\",\"-U0\"]",
  "diff context regression: [\"--unified\",\"--unified=1\"]",
  "diff context regression: [\"-U0\",\"-u\",\"-U1\",\"--unified\"]",
  "diff context regression: [\"-U0\"]",
  "diff context regression: [\"--unified=1\"]",
  "diff context regression: []",
  "diff context regression: [\"-u\"]",
  "diff context regression: [\"--unified\"]",
  "diff context regression: [\"-ru\"]",
  "diff brief label regression: both files, []",
  "diff brief label regression: both files, [\"-L\",\"BEFORE\"]",
  "diff brief label regression: both files, [\"-L\",\"BEFORE\",\"-L\",\"AFTER\"]",
  "diff brief label regression: both files, [\"--label=before name\",\"--label\",\"after name\"]",
  "diff brief label regression: missing left, []",
  "diff brief label regression: missing left, [\"-L\",\"BEFORE\"]",
  "diff brief label regression: missing left, [\"-L\",\"BEFORE\",\"-L\",\"AFTER\"]",
  "diff brief label regression: missing left, [\"--label=before name\",\"--label\",\"after name\"]",
  "diff brief label regression: missing right, []",
  "diff brief label regression: missing right, [\"-L\",\"BEFORE\"]",
  "diff brief label regression: missing right, [\"-L\",\"BEFORE\",\"-L\",\"AFTER\"]",
  "diff brief label regression: missing right, [\"--label=before name\",\"--label\",\"after name\"]",
  "explicit-count regression with whitespace: [\"-wC0\",\"-c\"]",
  "explicit-count regression with whitespace: [\"-bU0\",\"-uw\"]",
  "diff brief labels remain silent: identical files",
  "diff brief labels remain silent: missing left and empty right",
  "diff brief labels remain silent: empty left and missing right"
]
```

</details>

<details>
<summary>patch-absolute.test.ts: 11 passing tests</summary>

```json
[
  "exact comparator absolute-target integration uses virtual root",
  "authorized target target allows absolute header labels without selecting them",
  "authorized target /work/target allows absolute header labels without selecting them",
  "authorized target /work//./target allows absolute header labels without selecting them",
  "header autoselection rejects /work/target before stripping",
  "header autoselection rejects /work/../target before stripping",
  "header autoselection rejects a/../../target before stripping",
  "header autoselection rejects a/C:target before stripping",
  "explicit targets reject traversal before normalization",
  "authorized absolute target preserves dev-null creation and reverse deletion",
  "authorized target still rejects symlink, ancestor, hardlink and input aliases"
]
```

</details>

<details>
<summary>patch-authorization-followup.test.ts: 7 passing tests</summary>

```json
[
  "followup dry-run mismatch never authorizes orig, atomic=false",
  "followup dry-run mismatch never authorizes rej, atomic=false",
  "followup dry-run mismatch never authorizes orig, atomic=true",
  "followup dry-run mismatch never authorizes rej, atomic=true",
  "followup unused header symlink is not an authorized target",
  "followup unused header hardlink is not an authorized target",
  "followup an actual reject may use an unselected ordinary header name"
]
```

</details>

<details>
<summary>patch-candidate-errors-followup.test.ts: 13 passing tests</summary>

```json
[
  "followup unused looping candidate parent=false, atomic=false, dryRun=false",
  "followup unused looping candidate parent=true, atomic=false, dryRun=false",
  "followup selected looping candidate remains forbidden, atomic=false, dryRun=false",
  "followup unused looping candidate parent=false, atomic=false, dryRun=true",
  "followup unused looping candidate parent=true, atomic=false, dryRun=true",
  "followup selected looping candidate remains forbidden, atomic=false, dryRun=true",
  "followup unused looping candidate parent=false, atomic=true, dryRun=false",
  "followup unused looping candidate parent=true, atomic=true, dryRun=false",
  "followup selected looping candidate remains forbidden, atomic=true, dryRun=false",
  "followup unused looping candidate parent=false, atomic=true, dryRun=true",
  "followup unused looping candidate parent=true, atomic=true, dryRun=true",
  "followup selected looping candidate remains forbidden, atomic=true, dryRun=true",
  "followup candidate I/O failures are not mistaken for nonexistent paths"
]
```

</details>

<details>
<summary>patch-commit-followup.test.ts: 3 passing tests</summary>

```json
[
  "followup stat failure between publications reports the committed prefix",
  "followup lstat failure between publications reports the committed prefix",
  "followup readFile failure between publications reports the committed prefix"
]
```

</details>

<details>
<summary>patch-editflows.test.ts: 56 passing tests</summary>

```json
[
  "--atomic normalized sections stage dry-run and inverse-order reverse",
  "--atomic same-file creation edit deletion collapses and reverses",
  "--atomic same-file deletion then creation publishes final replacement",
  "--atomic --force later conflict prevents distinct and repeated writes",
  "loose blanks preserve actual context and literal additions -l",
  "loose blanks preserve actual context and literal additions --ignore-whitespace",
  "loose blanks preserve actual context and literal additions --ignore-white-space",
  "loose blanks retain nonblank and EOF distinctions \"oldvalue\\\\n\"",
  "loose blanks retain nonblank and EOF distinctions \"old\\\\rvalue\\\\n\"",
  "loose blanks retain nonblank and EOF distinctions \"old\\\\u000bvalue\\\\n\"",
  "loose blanks retain nonblank and EOF distinctions \"old value\"",
  "loose blanks retain nonblank and EOF distinctions \" old value\\\\n\"",
  "bounded mail preamble, diffstat and signature apply and reverse",
  "mail never hides malformed, unsupported, or oversized patch data",
  "mail never hides malformed, unsupported, or oversized patch data",
  "mail never hides malformed, unsupported, or oversized patch data",
  "mail never hides malformed, unsupported, or oversized patch data",
  "mail never hides malformed, unsupported, or oversized patch data",
  "mail never hides malformed, unsupported, or oversized patch data",
  "strict quoted filename roundtrip \"file name\"",
  "strict quoted filename roundtrip \"a\\\\\"quote\"",
  "strict quoted filename roundtrip \"café\"",
  "strict quoted filename roundtrip \"tab\\\\tname\"",
  "strict quoted filename roundtrip \"literal\\\\ttab\"",
  "decoded unsafe filename rejected before stripping \\\\q",
  "decoded unsafe filename rejected before stripping \\\\400",
  "decoded unsafe filename rejected before stripping \\\\777",
  "decoded unsafe filename rejected before stripping \\\\12",
  "decoded unsafe filename rejected before stripping \\\\300\\\\257",
  "decoded unsafe filename rejected before stripping \\\\377",
  "decoded unsafe filename rejected before stripping \\\\000",
  "decoded unsafe filename rejected before stripping \\\\n",
  "decoded unsafe filename rejected before stripping \\\\r",
  "decoded unsafe filename rejected before stripping \\\\057tmp",
  "decoded unsafe filename rejected before stripping a/\\\\056\\\\056/target",
  "decoded unsafe filename rejected before stripping a/C:target",
  "decoded unsafe filename rejected before stripping a/\\\\\\\\target",
  "relative repeated separators collapse before stripping; traversal never does",
  "mail cannot hide unsupported metadata \"Subject: example\\\\nnew file mode 120000\\\\n--- target\\\\n+++ target\\\\n@@ -1 +1 @@\\\\n-old\\\\n+new\\\\n\"",
  "mail cannot hide unsupported metadata \"--- target\\\\n+++ target\\\\n@@ -1 +1 @@\\\\n-old\\\\n+new\\\\n-- \\\\nnew file mode 120000\\\\n\"",
  "mail cannot hide unsupported metadata \"Subject: example\\\\ndeleted file mode 120000\\\\n--- target\\\\n+++ target\\\\n@@ -1 +1 @@\\\\n-old\\\\n+new\\\\n\"",
  "mail cannot hide unsupported metadata \"--- target\\\\n+++ target\\\\n@@ -1 +1 @@\\\\n-old\\\\n+new\\\\n-- \\\\ndeleted file mode 120000\\\\n\"",
  "mail cannot hide unsupported metadata \"Subject: example\\\\nsimilarity index 100%\\\\n--- target\\\\n+++ target\\\\n@@ -1 +1 @@\\\\n-old\\\\n+new\\\\n\"",
  "mail cannot hide unsupported metadata \"--- target\\\\n+++ target\\\\n@@ -1 +1 @@\\\\n-old\\\\n+new\\\\n-- \\\\nsimilarity index 100%\\\\n\"",
  "mail cannot hide unsupported metadata \"Subject: example\\\\ndissimilarity index 100%\\\\n--- target\\\\n+++ target\\\\n@@ -1 +1 @@\\\\n-old\\\\n+new\\\\n\"",
  "mail cannot hide unsupported metadata \"--- target\\\\n+++ target\\\\n@@ -1 +1 @@\\\\n-old\\\\n+new\\\\n-- \\\\ndissimilarity index 100%\\\\n\"",
  "directory label remains invalid with explicit target a/target//-p1",
  "directory label remains invalid with explicit target a/target//-p1 /work/target",
  "directory label remains invalid with explicit target a/target///-p1",
  "directory label remains invalid with explicit target a/target///-p1 /work/target",
  "directory label remains invalid with explicit target a/target/./-p1",
  "directory label remains invalid with explicit target a/target/./-p1 /work/target",
  "directory label remains invalid with explicit target a/target/.//-p1",
  "directory label remains invalid with explicit target a/target/.//-p1 /work/target",
  "directory label remains invalid with explicit target a/target/././-p1",
  "directory label remains invalid with explicit target a/target/././-p1 /work/target"
]
```

</details>

<details>
<summary>patch-empty.test.ts: 16 passing tests</summary>

```json
[
  "normal -E removes empty results but dry-run preserves existence",
  "normal --remove-empty-files removes empty results but dry-run preserves existence",
  "context -E removes empty results but dry-run preserves existence",
  "context --remove-empty-files removes empty results but dry-run preserves existence",
  "unified -E removes empty results but dry-run preserves existence",
  "unified --remove-empty-files removes empty results but dry-run preserves existence",
  "context /dev/null forward creation auto accepts only missing or empty",
  "context /dev/null forward creation /work/target accepts only missing or empty",
  "context /dev/null reverse creation auto accepts only missing or empty",
  "context /dev/null reverse creation /work/target accepts only missing or empty",
  "unified /dev/null forward creation auto accepts only missing or empty",
  "unified /dev/null forward creation /work/target accepts only missing or empty",
  "unified /dev/null reverse creation auto accepts only missing or empty",
  "unified /dev/null reverse creation /work/target accepts only missing or empty",
  "--atomic remove-empty stages recreation and preflights later conflicts",
  "existing-empty creation and remove-empty retain link guards"
]
```

</details>

<details>
<summary>patch-epoch.test.ts: 44 passing tests</summary>

```json
[
  "unified epoch 1970-01-01 00:00:00 +0000 autoselect creates and reverses deletion",
  "unified epoch 1970-01-01 00:00:00 +0000 /work/target creates and reverses deletion",
  "unified epoch 1970-01-01 00:00:00.000000000 +0000 autoselect creates and reverses deletion",
  "unified epoch 1970-01-01 00:00:00.000000000 +0000 /work/target creates and reverses deletion",
  "unified epoch 1969-12-31 19:00:00 -0500 autoselect creates and reverses deletion",
  "unified epoch 1969-12-31 19:00:00 -0500 /work/target creates and reverses deletion",
  "unified epoch 1970-01-01 01:00:00 +01:00 autoselect creates and reverses deletion",
  "unified epoch 1970-01-01 01:00:00 +01:00 /work/target creates and reverses deletion",
  "unified epoch Thu Jan  1 00:00:00 1970 autoselect creates and reverses deletion",
  "unified epoch Thu Jan  1 00:00:00 1970 /work/target creates and reverses deletion",
  "unified epoch 1970-01-01 00:00:00 autoselect creates and reverses deletion",
  "unified epoch 1970-01-01 00:00:00 /work/target creates and reverses deletion",
  "unified epoch 1970-01-01 00:00:00.900000000 +0000 autoselect creates and reverses deletion",
  "unified epoch 1970-01-01 00:00:00.900000000 +0000 /work/target creates and reverses deletion",
  "unified epoch 1970-01-01 00:00:01 +0000 autoselect creates and reverses deletion",
  "unified epoch 1970-01-01 00:00:01 +0000 /work/target creates and reverses deletion",
  "context epoch 1970-01-01 00:00:00 +0000 autoselect creates and reverses deletion",
  "context epoch 1970-01-01 00:00:00 +0000 /work/target creates and reverses deletion",
  "context epoch 1970-01-01 00:00:00.000000000 +0000 autoselect creates and reverses deletion",
  "context epoch 1970-01-01 00:00:00.000000000 +0000 /work/target creates and reverses deletion",
  "context epoch 1969-12-31 19:00:00 -0500 autoselect creates and reverses deletion",
  "context epoch 1969-12-31 19:00:00 -0500 /work/target creates and reverses deletion",
  "context epoch 1970-01-01 01:00:00 +01:00 autoselect creates and reverses deletion",
  "context epoch 1970-01-01 01:00:00 +01:00 /work/target creates and reverses deletion",
  "context epoch Thu Jan  1 00:00:00 1970 autoselect creates and reverses deletion",
  "context epoch Thu Jan  1 00:00:00 1970 /work/target creates and reverses deletion",
  "context epoch 1970-01-01 00:00:00 autoselect creates and reverses deletion",
  "context epoch 1970-01-01 00:00:00 /work/target creates and reverses deletion",
  "context epoch 1970-01-01 00:00:00.900000000 +0000 autoselect creates and reverses deletion",
  "context epoch 1970-01-01 00:00:00.900000000 +0000 /work/target creates and reverses deletion",
  "context epoch 1970-01-01 00:00:01 +0000 autoselect creates and reverses deletion",
  "context epoch 1970-01-01 00:00:01 +0000 /work/target creates and reverses deletion",
  "non-epoch 2026-08-26 00:00:00 +0000 leaves an empty regular file on reversal",
  "non-epoch 1970-01-02 02:00:00 +0000 leaves an empty regular file on reversal",
  "non-epoch 1969-12-30 23:00:00 +0000 leaves an empty regular file on reversal",
  "non-epoch 1970-02-30 00:00:00 +0000 leaves an empty regular file on reversal",
  "non-epoch invalid timestamp leaves an empty regular file on reversal",
  "unified epoch allows existing empty target but never overwrites nonempty data",
  "unified epoch does not bypass header path validation",
  "context epoch allows existing empty target but never overwrites nonempty data",
  "context epoch does not bypass header path validation",
  "epoch timestamp on a nonempty side is not a creation or deletion directive",
  "normal zero-origin insertion can create a missing authorized target",
  "--atomic epoch create/delete sequence and later conflict preserve namespace"
]
```

</details>

<details>
<summary>patch-formats.test.ts: 56 passing tests</summary>

```json
[
  "unified autodetect with target dry-run/forward/reverse",
  "unified -u with target dry-run/forward/reverse",
  "unified --unified with target dry-run/forward/reverse",
  "unified rejects asserted normal before writing target",
  "unified rejects asserted context before writing target",
  "unified autodetect with /work/target dry-run/forward/reverse",
  "unified -u with /work/target dry-run/forward/reverse",
  "unified --unified with /work/target dry-run/forward/reverse",
  "unified rejects asserted normal before writing /work/target",
  "unified rejects asserted context before writing /work/target",
  "normal autodetect with target dry-run/forward/reverse",
  "normal -n with target dry-run/forward/reverse",
  "normal --normal with target dry-run/forward/reverse",
  "normal rejects asserted unified before writing target",
  "normal rejects asserted context before writing target",
  "normal autodetect with /work/target dry-run/forward/reverse",
  "normal -n with /work/target dry-run/forward/reverse",
  "normal --normal with /work/target dry-run/forward/reverse",
  "normal rejects asserted unified before writing /work/target",
  "normal rejects asserted context before writing /work/target",
  "context autodetect with target dry-run/forward/reverse",
  "context -c with target dry-run/forward/reverse",
  "context --context with target dry-run/forward/reverse",
  "context rejects asserted unified before writing target",
  "context rejects asserted normal before writing target",
  "context autodetect with /work/target dry-run/forward/reverse",
  "context -c with /work/target dry-run/forward/reverse",
  "context --context with /work/target dry-run/forward/reverse",
  "context rejects asserted unified before writing /work/target",
  "context rejects asserted normal before writing /work/target",
  "unified rejects truncated final physical line",
  "unified budget {\"maxHunks\":1} causes zero early writes",
  "unified budget {\"maxWork\":3} causes zero early writes",
  "unified budget {\"maxLines\":3} causes zero early writes",
  "unified budget {\"maxOutputBytes\":2} causes zero early writes",
  "normal rejects truncated final physical line",
  "normal budget {\"maxHunks\":1} causes zero early writes",
  "normal budget {\"maxWork\":3} causes zero early writes",
  "normal budget {\"maxLines\":3} causes zero early writes",
  "normal budget {\"maxOutputBytes\":2} causes zero early writes",
  "context rejects truncated final physical line",
  "context budget {\"maxHunks\":1} causes zero early writes",
  "context budget {\"maxWork\":3} causes zero early writes",
  "context budget {\"maxLines\":3} causes zero early writes",
  "context budget {\"maxOutputBytes\":2} causes zero early writes",
  "--atomic malformed format never publishes \"0c1\\\\n< old\\\\n---\\\\n> new\\\\n\"",
  "--atomic malformed format never publishes \"1,0c1\\\\n< old\\\\n---\\\\n> new\\\\n\"",
  "--atomic malformed format never publishes \"1,2a1\\\\n> new\\\\n\"",
  "--atomic malformed format never publishes \"1c1\\\\n< old\\\\n---\\\\n\"",
  "--atomic malformed format never publishes \"1c1\\\\n< old\\\\n---\\\\n> new\\\\n> extra\\\\n\"",
  "--atomic malformed format never publishes \"9007199254740992c1\\\\n\"",
  "--atomic malformed format never publishes \"*** target\\\\n--- target\\\\n***************\\\\n*** 1,2 ****\\\\n! old\\\\n--- 1 ----\\\\n! new\\\\n\"",
  "--atomic malformed format never publishes \"*** target\\\\n--- target\\\\n***************\\\\n*** 1 ****\\\\n  old\\\\n--- 1 ----\\\\n  other\\\\n\"",
  "--atomic malformed format never publishes \"*** target\\\\n--- target\\\\n***************\\\\n*** 1 ****\\\\n! old\\\\n--- 1 ----\\\\n+ new\\\\n\"",
  "normal autodetection requires a target and explicit target preserves EOF",
  "context format validates header traversal and permits authorized absolute labels"
]
```

</details>

<details>
<summary>patch-gnu-publication.test.ts: 12 passing tests</summary>

```json
[
  "noninteractive default explicitly chooses batch reversal, not force",
  "--atomic paired control retains complete namespace: \"--- target\\\\n+++ target\\\\n@@ -1 +1 @@\\\\n-old\\\\n+new\\\\n@@ -3 +3 @@ function\\\\n-tail\\\\n+TAIL\\\\n\"",
  "--atomic paired control retains complete namespace: \"--- target\\\\n+++ target\\\\n@@ -1 +1 @@\\\\n-old\\\\n+new\\\\n--- missing\\\\n+++ missing\\\\n@@ -1 +1 @@\\\\n-old\\\\n+new\\\\n\"",
  "--atomic paired control retains complete namespace: \"--- target\\\\n+++ target\\\\n@@ -1 +1 @@\\\\n-old\\\\n+new\\\\n--- missing\\\\n+++ missing\\\\n@@ -1 +1 @@\\\\n-old\\\\n\"",
  "publication safety default: .orig symlink",
  "publication safety default: .orig hardlink",
  "publication safety default: .rej symlink",
  "publication safety default: .rej hardlink",
  "publication safety atomic: .orig symlink",
  "publication safety atomic: .orig hardlink",
  "publication safety atomic: .rej symlink",
  "publication safety atomic: .rej hardlink"
]
```

</details>

<details>
<summary>patch-interstitial-followup.test.ts: 16 passing tests</summary>

```json
[
  "followup GNU ignores bare interstitial rename from target",
  "followup GNU ignores bare interstitial rename to sentinel",
  "followup GNU ignores bare interstitial copy from target",
  "followup GNU ignores bare interstitial copy to sentinel",
  "followup GNU ignores bare interstitial new file mode 120000",
  "followup GNU ignores bare interstitial deleted file mode 120000",
  "followup GNU ignores bare interstitial old mode 120000",
  "followup GNU ignores bare interstitial new mode 120000",
  "followup GNU ignores bare interstitial similarity index 100%",
  "followup GNU ignores bare interstitial dissimilarity index 100%",
  "followup GNU ignores bare interstitial GIT binary patch",
  "followup GNU ignores bare interstitial unknown extension metadata",
  "followup scan authorizes selected traversal tail before any status or writes",
  "followup scan authorizes selected symlink tail before any status or writes",
  "followup scan authorizes selected hardlink tail before any status or writes",
  "followup bare metadata scanning does not implement Git rename envelopes"
]
```

</details>

<details>
<summary>patch-metadata-boundary-followup.test.ts: 1 passing tests</summary>

```json
[
  "followup atomic staging rejects orphan deletion payload before any effects"
]
```

</details>

<details>
<summary>patch-namespace-followup.test.ts: 28 passing tests</summary>

```json
[
  "followup created target outranks unused symlink, atomic=false, dryRun=false",
  "followup created target outranks unused symlink, atomic=false, dryRun=true",
  "followup created target outranks unused symlink, atomic=true, dryRun=false",
  "followup created target outranks unused symlink, atomic=true, dryRun=true",
  "followup created target outranks unused hardlink, atomic=false, dryRun=false",
  "followup created target outranks unused hardlink, atomic=false, dryRun=true",
  "followup created target outranks unused hardlink, atomic=true, dryRun=false",
  "followup created target outranks unused hardlink, atomic=true, dryRun=true",
  "followup created target outranks unused symlink-parent, atomic=false, dryRun=false",
  "followup created target outranks unused symlink-parent, atomic=false, dryRun=true",
  "followup created target outranks unused symlink-parent, atomic=true, dryRun=false",
  "followup created target outranks unused symlink-parent, atomic=true, dryRun=true",
  "followup input may remain an unused header candidate after creation, atomic=false",
  "followup repeated create/delete/recreate selects current target, atomic=false",
  "followup deletion exposing selected symlink is rejected before effects, atomic=false",
  "followup actual orig cannot alias later selected creation, atomic=false",
  "followup actual rej cannot alias later selected creation, atomic=false",
  "followup newly created parents affect candidate ranking, atomic=false",
  "followup input may remain an unused header candidate after creation, atomic=true",
  "followup repeated create/delete/recreate selects current target, atomic=true",
  "followup deletion exposing selected symlink is rejected before effects, atomic=true",
  "followup actual orig cannot alias later selected creation, atomic=true",
  "followup actual rej cannot alias later selected creation, atomic=true",
  "followup newly created parents affect candidate ranking, atomic=true",
  "followup atomic reverse selection follows inverse section order, dryRun=false",
  "followup atomic reverse selection follows inverse section order, dryRun=true",
  "followup namespace preview observes cancellation during a pending target read",
  "followup namespace preview shares the invocation input budget"
]
```

</details>

<details>
<summary>patch-parser.test.ts: 53 passing tests</summary>

```json
[
  "--atomic mixed normal/context stages forward, dry-run and reverse for target",
  "--atomic mixed normal/context stages forward, dry-run and reverse for /work/target",
  "--atomic mixed normal/context rejects a later asserted format",
  "--atomic mixed normal/context rejects later parse error before writing",
  "--atomic mixed normal/context rejects later conflict before writing",
  "--atomic mixed context/unified stages forward, dry-run and reverse for target",
  "--atomic mixed context/unified stages forward, dry-run and reverse for /work/target",
  "--atomic mixed context/unified rejects a later asserted format",
  "--atomic mixed context/unified rejects later parse error before writing",
  "--atomic mixed context/unified rejects later conflict before writing",
  "--atomic mixed unified/normal stages forward, dry-run and reverse for target",
  "--atomic mixed unified/normal stages forward, dry-run and reverse for /work/target",
  "--atomic mixed unified/normal rejects a later asserted format",
  "--atomic mixed unified/normal rejects later parse error before writing",
  "--atomic mixed unified/normal rejects later conflict before writing",
  "--atomic mixed context/normal/unified stages forward, dry-run and reverse for target",
  "--atomic mixed context/normal/unified stages forward, dry-run and reverse for /work/target",
  "--atomic mixed context/normal/unified rejects a later asserted format",
  "--atomic mixed context/normal/unified rejects later parse error before writing",
  "--atomic mixed context/normal/unified rejects later conflict before writing",
  "mixed sections honor the single authorized target rather than header labels",
  "unified hunk body owns header-looking lines before a normal section",
  "mixed sections share budgets {\"maxFiles\":1}",
  "mixed sections share budgets {\"maxHunks\":1}",
  "mixed sections share budgets {\"maxWork\":30}",
  "mixed parse cancellation propagates its reason without mutations",
  "normal preserves file CR=false with transport CR=false",
  "normal preserves file CR=false with transport CR=true",
  "normal preserves file CR=true with transport CR=false",
  "normal preserves file CR=true with transport CR=true",
  "normal CRLF transport normalizes before bounded mail signature parsing",
  "context preserves file CR=false with transport CR=false",
  "context preserves file CR=false with transport CR=true",
  "context preserves file CR=true with transport CR=false",
  "context preserves file CR=true with transport CR=true",
  "context CRLF transport normalizes before bounded mail signature parsing",
  "unified preserves file CR=false with transport CR=false",
  "unified preserves file CR=false with transport CR=true",
  "unified preserves file CR=true with transport CR=false",
  "unified preserves file CR=true with transport CR=true",
  "unified CRLF transport normalizes before bounded mail signature parsing",
  "LF framing preserves literal CR and nested header-looking file payload",
  "inconsistent transport is not globally stripped or published",
  "suppressed normal new blank: forward and reverse exact bytes",
  "suppressed normal old blank: forward and reverse exact bytes",
  "suppressed context changed blank: forward and reverse exact bytes",
  "suppressed context bare shared blank: forward and reverse exact bytes",
  "suppressed context inserted blank: forward and reverse exact bytes",
  "suppressed context removed blank: forward and reverse exact bytes",
  "suppressed blank still rejects incomplete/count error \"1c1\\\\n< old\\\\n---\\\\n>\\\\n\\\\\\\\ No newline at end of file\\\\n\"",
  "suppressed blank still rejects incomplete/count error \"*** target\\\\n--- target\\\\n***************\\\\n*** 1 ****\\\\n! old\\\\n--- 1 ----\\\\n!\\\\n\\\\\\\\ No newline at end of file\\\\n\"",
  "suppressed blank still rejects incomplete/count error \"1c1,2\\\\n< old\\\\n---\\\\n>\\\\n\"",
  "suppressed blank still rejects incomplete/count error \"*** target\\\\n--- target\\\\n***************\\\\n*** 1 ****\\\\n! old\\\\n--- 1,2 ----\\\\n!\\\\n\""
]
```

</details>

<details>
<summary>patch-quiet.test.ts: 40 passing tests</summary>

```json
[
  "default preserves diagnostic output: apply",
  "quiet preserves diagnostic output: apply",
  "default preserves diagnostic output: reverse",
  "quiet preserves diagnostic output: reverse",
  "default preserves diagnostic output: dry-run",
  "quiet preserves diagnostic output: dry-run",
  "default preserves diagnostic output: multifile",
  "quiet preserves diagnostic output: multifile",
  "default preserves diagnostic output: offset and backup",
  "quiet preserves diagnostic output: offset and backup",
  "default preserves diagnostic output: fuzz and backup",
  "quiet preserves diagnostic output: fuzz and backup",
  "default preserves diagnostic output: failed hunk and reject",
  "quiet preserves diagnostic output: failed hunk and reject",
  "default preserves diagnostic output: failed dry-run",
  "quiet preserves diagnostic output: failed dry-run",
  "default preserves diagnostic output: partial hunk publication",
  "quiet preserves diagnostic output: partial hunk publication",
  "default preserves diagnostic output: explicit reject destination",
  "quiet preserves diagnostic output: explicit reject destination",
  "default preserves diagnostic output: automatic reversal warning",
  "quiet preserves diagnostic output: automatic reversal warning",
  "default matches GNU deletion-conflict diagnostic",
  "quiet retains deletion-conflict diagnostic",
  "quiet aliases/grouped options --quiet",
  "quiet aliases/grouped options --silent",
  "quiet aliases/grouped options -stp0",
  "quiet aliases/grouped options -sRp0",
  "quiet retains malformed diagnostics and committed prefix (39 bytes)",
  "quiet retains malformed diagnostics and committed prefix (83 bytes)",
  "quiet success never writes routine stdout (atomic=false)",
  "quiet preserves failure diagnostics and effects (atomic=false)",
  "quiet success never writes routine stdout (atomic=true)",
  "quiet preserves failure diagnostics and effects (atomic=true)",
  "quiet retains path, symlink, hardlink and input-alias guards",
  "quiet does not relax input, output, work or line limits",
  "quiet reports publication failure and preserves the completed prefix",
  "quiet propagates pre-aborted cancellation without effects",
  "quiet aborts blocked input and observes its late rejection",
  "quiet failure summaries remain cancellable before publication"
]
```

</details>

<details>
<summary>patch-reject-orientation-followup.test.ts: 43 passing tests</summary>

```json
[
  "reject orientation unified deletion: default",
  "reject orientation unified deletion: batch",
  "reject orientation unified deletion: force",
  "reject orientation unified deletion: reverse",
  "reject orientation unified deletion: reverse force",
  "reject orientation unified deletion: force before batch",
  "reject orientation unified creation: default",
  "reject orientation unified creation: batch",
  "reject orientation unified creation: force",
  "reject orientation unified creation: reverse",
  "reject orientation unified creation: reverse force",
  "reject orientation unified creation: force before batch",
  "reject orientation context deletion: default",
  "reject orientation context deletion: batch",
  "reject orientation context deletion: force",
  "reject orientation context deletion: reverse",
  "reject orientation context deletion: reverse force",
  "reject orientation context deletion: force before batch",
  "reject orientation context creation: default",
  "reject orientation context creation: batch",
  "reject orientation context creation: force",
  "reject orientation context creation: reverse",
  "reject orientation context creation: reverse force",
  "reject orientation context creation: force before batch",
  "failed deletion retains candidate and appends exact rejects: default",
  "failed deletion retains candidate and appends exact rejects: batch",
  "failed deletion retains candidate and appends exact rejects: force",
  "failed deletion retains candidate and appends exact rejects: reverse",
  "failed deletion retains candidate and appends exact rejects: reverse force",
  "failed deletion retains candidate and appends exact rejects: force before batch",
  "reject orientation actual-write-only auxiliaries, reverse=false: --no-backup-if-mismatch",
  "reject orientation actual-write-only auxiliaries, reverse=false: -r chosen.rej",
  "reject orientation actual-write-only auxiliaries, reverse=false: -r -",
  "reject orientation actual-write-only auxiliaries, reverse=false: --dry-run",
  "reject orientation actual-write-only auxiliaries, reverse=true: --no-backup-if-mismatch",
  "reject orientation actual-write-only auxiliaries, reverse=true: -r chosen.rej",
  "reject orientation actual-write-only auxiliaries, reverse=true: -r -",
  "reject orientation actual-write-only auxiliaries, reverse=true: --dry-run",
  "reject orientation atomic conflicts leave the full namespace unchanged: ",
  "reject orientation atomic conflicts leave the full namespace unchanged: -R",
  "reject orientation atomic conflicts leave the full namespace unchanged: -f",
  "reject orientation atomic conflicts leave the full namespace unchanged: -R -f",
  "reject orientation atomic conflicts leave the full namespace unchanged: --dry-run"
]
```

</details>

<details>
<summary>patch-strip-followup.test.ts: 3 passing tests</summary>

```json
[
  "followup GNU counts dot components before stripping ./leaf",
  "followup GNU counts dot components before stripping a/./leaf",
  "followup GNU counts dot components before stripping a///./leaf"
]
```

</details>

<details>
<summary>patch.test.ts: 39 passing tests</summary>

```json
[
  "patch reads -i, dry-run does not modify, and reverse restores bytes",
  "space-containing filenames and tab-delimited timestamps",
  "zero-fuzz patch conflicts preserve actual context",
  "offset-only matching succeeds at fuzz zero and carries offsets across hunks",
  "fuzz never ignores deletion content",
  "--atomic preflights all hunks before modifying one file",
  "--atomic preflights all files before modifying any file",
  "multifile creation/deletion reverses without reject files",
  "--atomic create/delete failures preserve preexisting content",
  "creation makes missing parent directories with -p0",
  "empty patch is a successful no-op",
  "--atomic --force repeated target conflict has no early writes",
  "--atomic malformed patch rejected before modification: missing new header",
  "--atomic malformed patch rejected before modification: missing hunks",
  "--atomic malformed patch rejected before modification: truncated body",
  "--atomic malformed patch rejected before modification: extra body line",
  "--atomic malformed patch rejected before modification: bad body prefix",
  "--atomic malformed patch rejected before modification: zero nonempty start",
  "--atomic malformed patch rejected before modification: unsafe integer",
  "--atomic malformed patch rejected before modification: empty range",
  "--atomic malformed patch rejected before modification: no changes",
  "--atomic malformed patch rejected before modification: unknown marker",
  "--atomic malformed patch rejected before modification: empty incomplete line",
  "--atomic malformed patch rejected before modification: duplicate marker",
  "--atomic malformed patch rejected before modification: content after missing newline",
  "--atomic malformed patch rejected before modification: truncated physical line",
  "--atomic malformed patch rejected before modification: unsupported preamble",
  "--atomic malformed patch rejected before modification: git symlink metadata",
  "--atomic malformed patch rejected before modification: git rename metadata",
  "--atomic malformed patch rejected before modification: metadata without patch",
  "--atomic malformed patch rejected before modification: unterminated quoted filename",
  "--atomic malformed patch rejected before modification: both null",
  "patch rejects unsupported or invalid options [\"-p-1\"]",
  "patch rejects unsupported or invalid options [\"--fuzz=NaN\"]",
  "patch rejects unsupported or invalid options [\"-i\"]",
  "patch rejects unsupported or invalid options [\"--output=elsewhere\"]",
  "patch rejects unsupported or invalid options [\"a\",\"b\"]",
  "patch rejects unsupported or invalid options [\"/dev/null\"]",
  "patch rejects unsupported or invalid options [\"--strip=9007199254740992\"]"
]
```

</details>

<details>
<summary>safety.test.ts: 28 passing tests</summary>

```json
[
  "patch rejects unsafe header before or after strip: \"../target\"",
  "patch rejects unsafe header before or after strip: \"dir/../../target\"",
  "patch rejects unsafe header before or after strip: \"/work/target\"",
  "patch rejects unsafe header before or after strip: \"a/../target\"",
  "patch rejects unsafe header before or after strip: \"C:/target\"",
  "patch rejects unsafe header before or after strip: \"a\\\\\\\\target\"",
  "patch rejects unsafe header before or after strip: \"target\\\\rname\"",
  "patch rejects unsafe header before or after strip: \"./..\"",
  "patch rejects unsafe header before or after strip: \"target\"",
  "explicit targets reject traversal even with safe patch headers",
  "strip removing the entire pathname is an error",
  "selected-path policy rejects symlink target, retained ancestor (-p0), and patch input",
  "dangling symlinks cannot become creation targets",
  "hard-linked targets are rejected to avoid modifying aliases",
  "directory targets are never overwritten",
  "binary rejection preserves bytes 0041",
  "binary rejection preserves bytes ff0a",
  "binary rejection preserves bytes c30a",
  "line/matrix/work/input/output limits fail closed",
  "file and hunk budgets apply across complete invocations",
  "invalid configuration reports usage failure before mutation",
  "commit failures stop later files and disclose the committed prefix",
  "--atomic late mutation in precommit validation prevents all command writes",
  "output budget is checked before writing any patch target",
  "hostile directory entry names never become filesystem paths",
  "excessive path lengths and depths are bounded before filesystem traversal",
  "diagnostics have a separate fixed bound even for huge invalid options",
  "patch updates preserve existing permission bits"
]
```

</details>

<details>
<summary>shell.test.ts: 5 passing tests</summary>

```json
[
  "plugin exposes stable command definitions and collision preflight",
  "shell redirects a patch, applies dry-run, patches, compares, and reverses",
  "shell streaming diff-to-patch pipeline composes with tee and stdin",
  "shell recursive changes apply inside a subshell cwd with strip",
  "shell here-document patch uses literal content and preserves failed-file bytes"
]
```

</details>
