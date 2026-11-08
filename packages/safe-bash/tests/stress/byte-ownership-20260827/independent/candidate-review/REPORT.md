# Independent first-candidate verification — August 27, 2026

**BLOCKED: first candidate is byte-correct on the unchanged independent cohort,
but violates the frozen no-new-quadratic copy policy. Final trim-fix replay is
pending a new frozen author source.** This is an independent verifier report,
not the source author's acceptance report.

## Freeze and ownership

The verifier changes only this new `candidate-review/` subtree. Product,
FS/runtime, root exports/configuration/dependencies/dist, prior independent
fixtures, expected vectors, manifests and evidence are untouched. No regex
execution probes or broad suites were added/run.

New policy and all 53 tests were frozen **before executing them** at
`b1c823af09c1cc4bf9a13225ef0ae9c170d22d80`. The manifest SHA-256 is
`cff5906058fc055f44fde01c7e87e6aacb0a2bdc44852a375d5518fdf9a89abd`.
The root/author ready marker was written promptly to
`/tmp/byte-helper-trim-holdouts-ready.txt`, withholding vectors. It releases the
root to assign the narrow trim repair; it is not source acceptance.

The exact first candidate is `7a517cecab21d9fbff204df01a6a2ad2712a7673`.
All 217 original source/config/contract/AGENTS entries matched that committed
source at freeze, and live source was unchanged before/after the complete first
candidate run. An isolated source archive was saved before releasing the ready
marker. Each run builds its own exact committed source archive, records complete
source hashes before/after, and independently records live-worktree differences.
This remains reproducible if concurrent owners subsequently change live source.

| Candidate file | SHA-256 |
| --- | --- |
| src/commands/internal.ts | ade20c95a7d3dac5250a214d112ab25d710ce7909a4c6605f18ee21781949654 |
| src/commands/streams.ts | 06bff98731e9244f502589de6f81c5dec9737c70a3eb285ebf90bf2a3dd93a9d |

## Separate correctness denominators

| Cohort | Preserved prepatch | First candidate |
| --- | --- | --- |
| Author original unchanged20 | 17/20 | 20/20, author-reported; not rerun by this leaf |
| Independent internal unchanged10 | 8/10 | **10/10** |
| Independent public unchanged20 | 14/20 | **20/20** |
| Independent combined unchanged30 | **22/30** | **30/30** |

The unchanged independent fixture freeze is
`d4320b06f26e57d1a16fe758244ed6b6a2c70b6b`, baseline evidence `6736221`,
manifest `freeze-scaffold-v3.json` SHA-256
`bab5b39938c868e68637d3b1d5c28145d3da0a7ee9ff7b6304176b2e5ca246bc`.
Every original fixture hash is checked against that manifest before and after
execution. Both unchanged cohorts exit zero with no skips, TODOs or cancellations.
Their public error/status/byte assertions, including attempted bytes on sink
rejection, remain exactly unchanged. Raw first-candidate TAP and binding/result
files are under `evidence/candidate-first-*`.

The author's canonical 27/27 and adjacent 46/46 are separate reported checks,
not part of this leaf's denominators. Original baseline failures and prior
scaffold corrections remain in their original locations, not rewritten here.

## New frozen allocation/retention results

These are deterministic operation counts and reachable queue backing-byte
observations, **not** wall-time, RSS or broad benchmark results.

| Added holdout group | Baseline d4320b0 | First candidate 7a517cec |
| --- | --- | --- |
| Geometric immutable Buffer, tail/head | 10/10 | 0/10: copy-bound failures |
| Geometric borrowed Buffer, tail/head | 0/10: wrong bytes | 0/10: copy-bound failures |
| Geometric borrowed Uint8Array, tail/head | 0/10: copy-bound failures | 0/10: copy-bound failures |
| Oversized backing, immutable Buffer | 0/6: retained-backing failures | 6/6 |
| Oversized backing, borrowed Buffer | 0/6: wrong bytes | 6/6 |
| Oversized backing, borrowed Uint8Array | 6/6 | 6/6 |
| Meter calibration and head lease/error controls | 5/5 | 5/5 |
| Total added tests | **21/53** | **23/53** |

All 30 first-candidate geometric failures occur after exact output, status,
diagnostic, finalization and checkpoint assertions pass. All 18 first-candidate
retention tests pass. None are skips or harness failures. Counts are deliberately
kept separate from the original 30: a higher combined count cannot excuse the
regression in the previously correct immutable-Buffer cohort.

Representative matched immutable-Buffer byte-tail observations (head exclusion
has the same copy counts):

| Input bytes | Retained count | Baseline copied bytes | Candidate copied bytes | Candidate trim-slice bytes |
| ---: | ---: | ---: | ---: | ---: |
| 1,032 | 1,024 | 0 | 9,188 | 8,156 |
| 2,064 | 2,048 | 0 | 34,696 | 32,632 |
| 4,128 | 4,096 | 0 | 134,672 | 130,544 |
| 8,256 | 8,192 | 0 | 530,464 | 522,208 |
| 16,512 | 16,384 | 0 | 2,105,408 | 2,088,896 |

The ownership constructor copies exactly input bytes; repeated remaining-queue
slice copies dominate the new growth. Native Uint8Array already had this defect,
but immutable Buffer did not and was byte-correct. Thus that native baseline is
not an excuse for the newly introduced Buffer regression. The author's larger
65,792-byte example is not needed to establish this independent bounded witness.

The retained-backing holdouts also reject simply replacing trimming with an
unbounded large-backing subarray. The baseline immutable-Buffer retention
failures are explicitly preserved, not represented as first-candidate
regressions. All frozen envelopes and modest workload limits remain unchanged.

## Real packed public package, not repository self-reference

Inspection confirmed the old frozen runner only copied the original manifest
and physically moved an emitted directory. It **did not call npm pack**. That
earlier evidence is still valid for its stated moved-package scope, but is not
retroactively described as archive verification.

The new `run-packed.mjs`:

1. Archives the exact committed source, original manifest and build configs;
   emits TypeScript exclusively into owned isolated staging.
2. Copies the original manifest without changing `exports`, `files`, `private`,
   name, scripts or dependencies; includes the original README that npm includes
   automatically. No synthetic publish manifest is used.
3. Runs genuine local `npm pack --ignore-scripts --offline --json` with an owned
   cache and no dependency download/install. The original `files: ["dist"]`
   controls the archive. Native tooling is only a test harness operation.
4. Physically moves the generated archive into an unrelated named consumer
   package scope, then extracts it into that consumer's node_modules/virtual-bash.
   The original archive location must no longer exist.
5. Requires `import.meta.resolve('virtual-bash')` to select the extracted package,
   not the repository root or build-stage directory. The unchanged public test
   repeats the resolution assertion itself.
6. Hash-checks all **706 archive/extracted files**, checks them against actual
   staging bytes, and records the existing immutable independent loader's
   verification of **164 unique loaded package modules**, including root index,
   internal helpers and streams. All package files remain unchanged afterward.

First-candidate archive SHA-256:
`5311781a67455f7e71631e20766da714dd41cf4453ac87d7243f02309273ef93`.
The package's original manifest SHA-256 remains
`316d5eb7e741f71b91270c5c08fa44d9252d3dfac33a7e6aed79a0cf705ee55a`.
Exact pack command/output, npm integrity/shasum, extracted paths, loaded hashes,
source snapshots and results are preserved, not inferred from a dry run.
Toolchain: Node 22.22.2, npm 10.9.7, Darwin arm64, repository-local TypeScript.

## Harness history and measurement limits

The first `baseline-trim` build/pack succeeded, but publishing its large failing
TAP via a process argument failed before apply_patch started. Partial evidence is
preserved; this attempt receives **no invented product score**. The runner-only
transport fix passes the patch through stdin. `baseline-trim-v2` then completed
unchanged tests at 21/53; its full original failing TAP is retained. Frozen
fixtures/policy/vectors were never edited. See
`evidence/baseline-trim-harness-failure.md`.

The isolated meter observes native constructors/slices/sets and weakly observes
the byte-array queue at producer-resume checkpoints. Source inspection of both
bound candidates confirms their copy sites use those operations. This is not
proof against arbitrary indexed-copy loops, changed queue representations,
malicious host JavaScript, all counts, every buffer budget or every command.
Consumed slots still referenced are counted. Counts are positive and workloads
remain below the existing queue-slot compaction threshold. No GC/RSS inference
or noisy elapsed-time threshold is used.

Bare ByteSource does not define a lease duration. The tested legal schedule is
supported by executable `tests/contracts/io.test.ts:41` and `:144`, copy/await
helpers, AGENTS and the user's explicit next-read/finalizer/awaited-sink rules.
No arbitrary concurrent-mutation or cancellation-as-rollback promise follows.

## Continuation and closure

At this checkpoint, `/tmp/byte-helper-trim-author-ready.txt` is not present.
After root supplies the next frozen source, run from the repository root:

```
node tests/stress/byte-ownership-20260827/independent/candidate-review/run-packed.mjs final-trim FROZEN_COMMIT
```

This must replay the **unchanged original 30 plus unchanged new 53** with a new
append-only phase, original/trim fixture hash checks, committed-source
before/after hashes, actual npm-pack proof and loaded-asset checks. Do not use
the old parent runner to write outside the verifier's owned subtree. A later
pass cannot erase the first-candidate regression evidence. No final trim-fix
acceptance is claimed now.

Every launched synchronous build, npm, tar and test child returned. No test
server or detached child was launched. Original public fixtures dispose their
Shells; added tests restore instrumentation in finally. Closure evidence checks
for remaining owned runners. No broad all-tests run, native product process,
runtime dependency, project superiority, full completion or duration claim.
