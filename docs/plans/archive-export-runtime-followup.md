# S3 archive export runtime follow-up

Date: September 1, 2026.
Status: approved exact-Buffer comparison improvement implemented and validated.
The investigation sections below record the earlier read-only findings; the
approved implementation and final measurements are recorded at the end.

## Scope

- [x] Read the supplied pre-index profile and current archive implementation.
- [x] Measure the current complete S3 export test owner.
- [x] Compare original case names and capture existing verifier phase receipts.
- [x] Determine current-product versus historical coverage and packaging-smoke overlap.
- [x] Obtain root approval before implementation; no test-route change authorized.

The initial investigation added only this plan. Its measurements made no test,
helper, verifier, production, evidence, workflow, concurrency, timeout, or
selector changes. No manual Git commands or lint commands were run. Existing
tests perform their own isolated fixture Git operations and committed-candidate
reads. The separately approved implementation scope is listed at the end.

## Measurement

Worktree: `/tmp/poe-test-speed-push-20260901`.
Current measurement: Node v22.22.2, Darwin arm64, `CI=true`.

Uninstrumented command, from the worktree root:

```sh
CI=true node --import tsx --test --test-reporter=tap packages/safe-bash/tests/integration/s3-http-exports/exports.test.ts
```

Baseline inputs are the supplied `PROFILE.md`, `timing-summary.json`, and
`cases.csv` under `/tmp/poe-full-profile-20260901/baseline-wnA4Q4`.
That profile records revision `6844edf3e`, Node v22.23.2, and CI=true.
The frozen worktree itself was not accessed.

| Comparable measurement | Pre-index supplied profile | Current uninstrumented |
| --- | ---: | ---: |
| Original 126 archive controls, summed case time | 86.108111128 s | 86.465103787 s |
| Authentic packed-revision case | 27.716417042 s | 25.605067125 s |
| Original 127 cases combined | 113.824528170 s | 112.070170912 s |
| Additional 49 copy-index controls | Not present | 0.117017249 s |
| All current 176 cases, summed case time | Not comparable | 112.187188161 s |
| Current Node test duration | Not compared | 112.846764292 s |
| Current outer wall time | Not compared | 112.899 s |

All 127 baseline case names occur in the current results, with 49 additional
controls and no removed baseline names. The current run passes 176/176, with
zero failures, cancellations, skips, or TODOs. The old archive-control cost has
not disappeared. These runs differ in Node version, runtime revision, host load,
and cache warmth; the 1.754357258-second common-case difference is not a causal
measurement of the directory-index improvement.

Current uninstrumented, nonoverlapping groups:

| Group | Cases | Sum |
| --- | ---: | ---: |
| Authentic committed product | 1 | 25.605067125 s |
| Synthetic successful peer/declaration profiles | 3 | 26.187409791 s |
| Actual verifier drift/alias injection controls | 9 | 28.765637042 s |
| Missing public HTTP type negative control | 1 | 4.721045291 s |
| Remaining controls, including the new index controls | 162 | 26.908028912 s |

## Passive phase capture

A second complete run used an in-memory data-URL preload only in the test-owner
process. It observed existing `spawnSync` return values and the already-read
report JSON, forwarding the original calls and results unchanged. It did not
transform verifier source or enter the verifier's cleaned child environments.
No temporary source file or tracked instrumentation was written.

This diagnostic repeat passed 176/176: outer wall 104.095 s, Node test duration
104.049700958 s, summed case time 103.442775548 s. It is not an optimized variant
or a controlled before/after comparison. For example, the legacy-local-types
case varied from 12.661824667 s to 6.298013167 s without a code change.

Thirteen existing reports were observed: three successful synthetic profiles,
nine deliberately failing mutation reports whose enclosing tests passed, and
one authentic product report. The directly invoked missing-export negative
control was not captured by this observer, so these phase totals are partial.

| Existing subprocess receipt label | Observations | Total |
| --- | ---: | ---: |
| TypeScript version | 13 | 1.402 s |
| Committed output guard | 13 | 0.500 s |
| Committed boundary owner authentication | 13 | 0.662 s |
| Isolated committed compiler build | 13 | 13.844 s |
| Isolated lifecycle-free package archive | 12 | 4.072 s |
| Offline tarball install without lifecycles | 9 | 6.397 s |
| Plain Node packed imports and guard controls | 6 | 0.736 s |
| Strict public TypeScript consumer | 5 | 6.692 s |
| Strict invalid consumer controls | 4 | 5.960 s |

These are whole subprocess elapsed times, not isolated process-startup costs.
The authentic case took 23.088103833 s in this repeat; its nine subprocesses
sum to 11.943 s: build 4.938 s, pack 1.217 s, install 2.169 s, valid types
1.429 s, invalid types 1.549 s, runtime 0.431 s, and initial checks 0.210 s.
The remaining 11.145103833 s includes candidate admission, copies, fresh
inventories/hashes, peer binding, fixture work, imports, and cleanup. It is not
established as removable overhead, nor separately attributed to source hashing.

## Exact exercised revision

`exports.test.ts:12` invokes the current `verify.mjs` with
`S3_HTTP_EXPORTS_REVISION ?? "HEAD"`. No revision or peer-artifact override was
set for these measurements. `inspectCommittedCandidate` resolves that selector
to a commit and admits exact Git blobs; it never overlays dirty product source.

The observed authentic report, captured at 2026-09-01T23:52:03.738Z
(September 1, 2026, 6:52:03.738 p.m. CDT), records:

- Requested revision: `HEAD`.
- Source commit: `1b3fa27704ad354cdb16c084cc80dfef0a954080`.
- Qualification: `actual-integrated-commit`.
- Peer profile: `checkout-root`.
- Result: `pass`.

This proves the diagnostic repeat's exact selected revision. The first run's
report was not retained by its normal wrapper; do not retroactively assign it
this exact commit while root commits may advance HEAD. Likewise, the supplied
baseline identifies its checkout revision but is not a retained sourceCommit
receipt from this worker's run.

The canonical peer uses authenticated existing checkout build outputs, with
selected committed metadata/lock agreement. It is not a historical bundled
peer, a registry fallback, or independent proof that live uncommitted product
changes were compiled into the candidate. The report expressly excludes HTTP
operations, root release packaging, and service acceptance.

The archive controls do not repeatedly qualify one old product revision.
`withRepository` at `archive-controls.test.mjs:870` creates fresh synthetic
commits with current reviewed build scripts, metadata, owner bindings, tiny
product stubs, and a synthetic peer. Their reports expressly identify synthetic
qualification. The three successful fixture commits observed in this repeat
were `b813de93bf4330f3160de9dfe8bd5ee159a62c4e` (packed root),
`b191ec2f89865d77b66accf51245e901f036e261` (checkout root), and
`cadaa97154b011f7a032ad3a782cc4d32bc59b76` (checkout root/local declarations).
Mutation controls also receive separate fresh synthetic commits. These fixtures
test the current verifier, not full current product behavior.

## Coverage parity and retirement decision

| Boundary | Current S3 owner | Existing public packaging smoke / copy controls |
| --- | --- | --- |
| Product artifact | Selected committed private `virtual-bash`, built in an isolated authenticated snapshot | `scripts/package-safe.mjs` rewrites live built outputs into public `@poe-platform/*` artifacts; not the same artifact route |
| S3 runtime exports | Root/subpath factory identity, exact subpath exports, canonical FsError/MemoryFileSystem identity, six transport methods, zero requests and credential calls | Public smoke checks generic Shell/SafeJS/FS identity, copy options and limits, not S3 HTTP root/subpath assertions |
| S3 declarations | Four root/subpath public types, strict valid consumer, exact invalid diagnostic codes 2322/2345/2741, missing-export TS2305 negative | Public type smoke constructs Shell and uses SafeJS/FS; no S3 HTTP consumer or matching negative diagnostics |
| Source and module origins | Exact admitted committed blobs, no source overlay/fallback, private/outside imports refused, canonical peer metadata/runtime tampering refused | Packaging smoke imports installed public artifacts, but does not establish this private committed-source chain |
| Archive continuity | Commit/archive-bound full dist inventory through copy, pack, install, runtime, types and final checks | Copy unit controls validate copy admission itself; they cannot prove verifier check placement across later stages |
| Nine injected verifier defects | Copied bytes; packed membership/root declaration/HTTP declaration; installed, post-runtime and post-types membership; two installed ancestor aliases | Neither packaging smoke nor copy-helper unit controls inject these defects into the real verifier or assert the next consumer is blocked |
| Environment and peer profiles | Packed-root, checkout-root and legacy-local-type profiles; dirty/staged source, ancestor Git isolation, startup poisoning, lifecycle marker and prerequisite failures | Public release install/build smoke is useful integration coverage but not these hostile-environment/profile controls |
| Historical owners | Freshly authenticated boundary authorities; held product/evidence bodies excluded from materialization | Authenticating an immutable admission owner is not replaying an old product qualification |

Relevant inspected sources: `scripts/package-safe.test.ts` has two memfs/AST
unit tests with a mock bundler; `scripts/fixtures/safe-packages-smoke.mjs` and
`scripts/fixtures/safe-packages-types.mts` are invoked by the public release
workflow's installed-tarball smoke. Neither contains the S3-specific assertions
above. `verify.mjs:85`, `verify.mjs:175`, `verify.mjs:195`, `verify.mjs:243`, and
`archive-controls.test.mjs:1255` contain the distinct integration boundaries.

Decision: no historical-only redundant wrapper is established. Do not move the
authentic test or the 126 original archive controls to manual historical
verification. The legacy-local-declarations success fixture is a compatibility
branch of the current verifier, not a pinned old release replay; removing it
would also require an explicit support/coverage decision. No immutable evidence
or verifier bytes should move or change for this investigation.

## Bounded next proposal, not implementation approval

No minute-scale safe reduction is demonstrated by these measurements. Removing
these wrappers, sharing mutable fixtures/build outputs between cases, skipping
strict library checks, merging independently guarded stages, or reusing hashes
would trade away required coverage rather than remove historical duplication.

One narrow experiment worth considering is attribution of fresh dist
inventory admission in `committed-archive.mjs:343`: `readDistInventory` enumerates
the full tree, then each `readRegularInput` repeats ancestor directory listings.
The existing copy index does not cover this path. Measure that function with
real current dist inputs and a counting filesystem adapter before proposing an
index extension. Keep all payload reads, full inventories, hashes, source and
archive identities, and before/after stage checks fresh. Do not treat the entire
11.145-second authentic-case remainder as its potential saving.

Only if that read-only attribution shows worthwhile cost should root authorize
a memfs TDD prototype with bounded invocation-local directory-name admission,
fresh identity checks on every use, before/after population identity checks,
all seven identity fields, canonical aliases, extra/missing names, symlinks,
I/O failure identity, and explicit no-cross-invocation reuse controls. It must
retain every current case and all nine actual-verifier mutation controls.
No source/hash/result cache, stage sharing, retry policy change, or concurrency
change is proposed. A second full owner measurement would then be required;
there is currently no promised saving for this candidate.

## Compact pre-worker fixture follow-up

Root additionally asked whether pre-worker controls could use a newly created
compact valid fixture instead of irrelevant full product bytes. This is already
the setup: the ordinary fixture's three product source files contain just
154, 155, and 189 bytes, totaling 498 bytes. Its peer is also a tiny synthetic
declaration/runtime implementation, not a full product build. Not all 126 old
archive controls stop before workers: three successful profiles, nine injected
verifier controls, and the missing-export control run real verifier stages.

A read-only diagnostic run selected these exact three existing cases:

- `committed archive rejects a missing package prefix even when integration files are staged`
- `committed build script drift and held path aliases fail before candidate execution`
- `pre-read committed admission never requests held blobs or nonregular input bodies`

They create eight independent temporary repositories. All three cases passed in
11.109 s outer wall time, with respective case times 0.602622791 s,
7.272488667 s, and 2.627572375 s. A passive in-memory preload observed original
filesystem writes and Git calls without modifying arguments or return values.
The positive default fixture has 40 observed written paths totaling 204,233
bytes, including three uncommitted synthetic peer files. This is a write-payload
observation, not a replacement for the verifier's canonical committed census;
mutant variants may subsequently remove or replace paths.

Across all eight fixtures, 55 Git subprocesses consumed 4.979013458 s:
init 1.744245042 s, add 0.490005541 s, commit 0.543143291 s,
rev-parse 1.484581207 s, ls-tree 0.424421169 s, cat-file 0.171114916 s,
hash-object 0.058633209 s, and update-index 0.062869083 s.
There is no large historical product payload to shrink. The bulk that remains
is reviewed build/admission code and the authenticated boundary owners.
`committed-archive.mjs:187` checks the former against fresh authority bytes and
the latter against their bound hashes. Shrinking them would change the admission
contract or cause a different, earlier failure; preserving the small product
stub while replacing those authorities is not an equivalent valid fixture.

The slow drift case instead exposes avoidable negative-diagnostic work. A
separate memory-only microbenchmark compared fresh current source bytes with
the exact existing short drift strings, catching the same AssertionError class
and stable required message in each variant. It did not transform the helper,
change source files, run a mutant verifier, or shrink any fixture.

| Current source / mismatch | `assert.deepEqual` | `assert.ok(actual.equals(expected), message)` |
| --- | ---: | ---: |
| integration-inputs.mjs, 40,266 versus 37 bytes | 4,601.601625 ms | 0.072917 ms |
| build.mjs, 17,804 versus 57 bytes | 1,411.989584 ms | 0.101958 ms |
| integration-inputs.mjs, same-length middle-byte mutation | 12.233583 ms | 0.021792 ms |
| build.mjs, same-length middle-byte mutation | 5.151667 ms | 0.023667 ms |

Both comparison forms rejected every mutant; independent equal-byte copies
were also accepted by `Buffer.equals`. The two short-drift deep comparisons
constructed error messages of 345,835 and 152,896 characters. The exact-byte
boolean comparisons retained the stable 85- and 72-character messages instead.
This isolates about six seconds of expected-failure diff construction, not a
source-hashing or historical-fixture-volume problem. The microbenchmark process
passed in 6.184 s; it is not an end-to-end optimized-owner measurement.

Preferred next bounded authorization request: change only the reviewed-build
Buffer comparison in `committed-archive.mjs` after TDD establishes that both
inputs are Buffers, equality remains exact, all existing drift/mode/alias/body
ordering controls still fail at their original boundary, and current success
cases still pass. Preserve fresh reads and all actual bytes. Explicitly approve
the diagnostic change: no huge numeric Buffer diff, but the same contextual
failure message and AssertionError class. Do not replace structural object or
inventory assertions wholesale. Measure the affected negatives and complete
176-case owner afterward. This is a plausible approximately six-second local
gain, not the requested minute-scale saving; no implementation was made.

The four archive source inputs remained byte-identical after this additional
diagnostic run. All measurement subprocesses have finished.

## Source stability

The following inputs were byte-identical before and after both read-only runs;
all captured report harness hashes agree with these values:

- `committed-archive.mjs`: `a4bcf609187f6cbffc8d8a90bc41bb9fed24a635dd6d703e11eade00499bef10`
- `archive-controls.test.mjs`: `965bc777e11fb27cc4234795940f175a038a8d56971ea62ddd1efba9d347658f`
- `exports.test.ts`: `8812ad9d066fd1d2ca4549f3d5a86eda7dc95704e713c735daa9dccf552d96bb`
- `verify.mjs`: `600bc575720ee839e6f7075100a4f613ebd5f7e3547e03670183f35a5a586e48`

The read-only investigation required no TDD red/green cycle. The
existing negative controls passed in both complete owner runs. It does not
claim a new full workspace, lint, release, or deployed-service qualification.

## Approved Buffer comparison implementation

Root authorized exact `Buffer.equals` checks with the same contextual assertion
message instead of giant Buffer diffs, without changing source bytes, fixtures,
fresh reads, metadata/hash checks, or case membership.

Exact changed paths:

- `packages/safe-bash/tests/integration/s3-http-exports/committed-archive.mjs`
- `packages/safe-bash/tests/integration/s3-http-exports/archive-controls.test.mjs`
- `docs/plans/archive-export-runtime-followup.md`

Only two helper statements change: the committed root output guard comparison
and the loop comparing the six reviewed build inputs. Each calls `Buffer.equals`
on the entire freshly read expected Buffer, then `assert.ok` with the original
contextual message. No prefixes, truncation, cached inputs, hashes, or results
are used. An in-memory comparison with the pre-edit source confirms all other
helper bytes, including Git batching and the directory index, are unchanged.
`exports.test.ts` and `verify.mjs` are byte-unchanged.

Four existing named tests gain assertions, with no new or removed names:

- The bootstrap guard case exercises both a same-length middle-byte mutation
  and its original short tamper string, each in a fresh private fixture. Both
  preserve the original refusal, authenticated bootstrap reads, no product-body
  requests, and no lifecycle execution assertions.
- The successful binary/path admission case checks all seven authority inputs
  are Buffers, equal byte-for-byte, and independently owned from fresh reads.
- The guarded build drift case exercises both a same-length middle-byte
  mutation and its original short tamper string in fresh fixtures, retaining
  body-read, refusal, and no-execution controls.
- The build-script/held-path case retains all three existing defects and asserts
  the exact script-path diagnostic for the original large-to-short mismatch.

Negative diagnostics must be AssertionError instances with code `ERR_ASSERTION`
and exactly the original contextual message. Exact equality prevents appended
numeric Buffer dumps while retaining the guard reason or reviewed input path.
Two additional inner fixture invocations cover same-length mutations; no
existing fixture is reduced or shared between cases.

### TDD and complete-owner results

- Red: the extended four existing cases against the unchanged helper produced
  three expected diagnostic failures and one equal-copy success, exit 1,
  8.214 s outer wall. The helper was verified byte-identical to the baseline.
- Green: after the two-statement fix, all four passed, exit 0, 5.250 s outer
  wall and 4.751574793 s summed case time. Both mutation sizes execute on green.
- Full: the same uninstrumented complete-owner command passed all 176 tests,
  zero failures/skips/cancellations/TODOs. All 176 names match the pre-edit run
  in the same order, including all nine actual-verifier tamper controls.
- All four archive input files were stable throughout the full post-edit run.

| Measurement | Before, original tests | After, stronger tests |
| --- | ---: | ---: |
| Bootstrap bad guard | 0.999939167 s | 1.694634333 s |
| Equal-copy/raw binary admission | 0.724615125 s | 0.921516000 s |
| Guarded build drift | 1.784222459 s | 1.689867750 s |
| Build script drift and held aliases | 8.474301917 s | 2.223127834 s |
| Four affected names combined | 11.983078668 s | 6.529145917 s |
| All 175 archive controls combined | 86.582121036 s | 84.722819502 s |
| Authentic packed-revision case | 25.605067125 s | 33.085571583 s |
| All 176 cases combined | 112.187188161 s | 117.808391085 s |
| Node test duration | 112.846764292 s | 118.614645500 s |
| Outer wall | 112.899 s | 118.676 s |

The affected case sum falls by 5.453932751 s despite two additional fresh mutant
fixtures. The isolated earlier microbenchmark establishes the removed Buffer
diff-construction cost. The complete-owner run is slower, not faster: the
authentic case alone varies upward by 7.480504458 s. These sequential local
runs are not a controlled host-load comparison, and root may advance the
selected HEAD. Do not claim an observed full-suite speedup or assign the
post-edit authentic case the earlier diagnostic run's captured sourceCommit.

Post-edit SHA256:

- `committed-archive.mjs`: `8b802bcaa0f80bd74af25653df77f0585b142b2578fc669de9bab9639306890d`
- `archive-controls.test.mjs`: `9d9287dec7b68c42c1f0bf9d15341bda4ebe8bcb91534ca3e7b79aabca402299`

No Git or lint command was run; guarded `npm run lint:eslint` remains the root
integration route, not a claimed worker pass. All measurement/test processes
have finished. Optional investigation of commit-OID-keyed raw fixture inputs
has not begun; it is separate from this patch and has no implementation approval.
