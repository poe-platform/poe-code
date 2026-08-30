# Corrective Overlay and Union Checkpoint: Different Static Review

Date: August 28, 2026. **CHANGES_REQUIRED**: one new code finding, zero source-integrity mismatches. Final composition-v3 and its recipe: **NOT_YET_REVIEWED**. No execution GO.

## Scope and chronology

Live AGENTS was read without copying it. Criteria were sealed at `b03560dd` before corrective body inspection. This is post-candidate, post-authoring static review, not blind precode proof. Original `88f92894` findings and accepted narrow FC-F01 review `abd9f2f0` remain immutable and unrescored. No authored helper, ledger, clock, control, getter, worker, coordinator, compiler, loader, candidate, copied tool or module was imported or executed.

The single natural checkpoint after source inspection found no `/tmp/yq-executor-composition-v3-ready.txt`. No polling followed and no unsealed composition body was read. The source-selection authority remains exactly b1 plus accepted 3b55 two-target correction plus routed 946c four-target correction; no unknown delta is authorized by this report.

## Authenticated source

Commit `946c33cfaf02f4120fb636d19b2095ab62746ad4`, scope `tests/commands/yq-independent-20260828/executor-b8f5d60d-v1/capture-deadlines-v3/`:

| Artifact | SHA256 |
| --- | --- |
| FINAL-SEAL.json | `430af377d11b9a824320bedd7b163e1a314269b4b8ce5229138c7ecc13c0c7c4` |
| ASSEMBLY-OVERLAY.json | `397b98ac8c2355541c0a11a5162ea2cb219a64c9a5a31f91d09c67b47b29628e` |
| SOURCE-PRESEAL.json | `6da57435bd6819c5973a5b979a688358294531550c2b70eb88091569f406e80c` |
| New core/capture-budget-v3.mjs, 6,289 bytes | `fac865817f05c8cbe970e1356c565a68468306caada0f251a9f86710df1c0605` |
| Replace core/owned-process.mjs, 7,803 bytes | `b8fcbc43e1500f058c3dbc1942a438cd6da383135bebe05fcc2f6b175978d7fc` |
| Replace core/phase-capture.mjs, 4,240 bytes | `a5449c12112a341f818154899c10290509e7999d5c48b7b7a3d7d6942fd69335` |
| Replace core/supervisor.mjs, 27,596 bytes | `7d33d4e0feba862a3bf3b5da3f6e41bd2217871c01d429207b4a47061682a126` |

All 19 committed/current regular files, three directories and exact membership match; current full modes are 0644/0755. Three exact parent preimages and the new target's absence are verified. Parent full-mode declarations are bound to accepted b1 ASSEMBLY-SEAL `de9b45808d9ebb23dd74c950637d9643c9125107c487b3625773f1280d5d8d5e`, not inferred from Git100644. All 26 direct import edges resolve to the declared parent or overlay bytes. Before/after checks match, without a change-and-restore guarantee. The four targets must be selected together; none overlaps accepted worker-api/tool-request.

## CC-F01 — coordinator capture errors are not sticky in final aggregation

Witness commit: `cc6da0299760f26cdfcf0b77ad26d1e0b0b7c260`. Witness SHA256: `604334221f8e1b1caad5e55a17055e644960cda2bd744f1dbc3aaa8d32fb20fc`. Exact excerpts are in `CC-F01-STATIC-WITNESS.json`.

At overlay `owned-process.mjs:88–89`, the new finish path catches stream fsync/close errors into `spawnError`, then resolves the process receipt at :105. The coordinator uses this same owner through `supervisor.mjs:74`. A normal coordinator exit can therefore have code0/signalnull/reapedtrue/no timeout/no overflow while carrying a captured stream-finalization error; successful process metadata publication retains that error.

The final aggregation at `supervisor.mjs:276` tests parent code/signal/timeout/overflow but not `parent.spawnError` or the existing process classifier. The guard at :53–69 checks root membership and boot identity, not this captured coordinator error. The unchanged classifier rejects nonnull spawnError, but supervisor applies it only to outer job receipts at :194. Thus this newly captured parent error does not independently force aggregate failure.

This is a source-level error-aggregation omission, not an executed failure or observed false PASS. The exact current cohort's known UNRUN/gap rows already force FAIL independently; they must not be waived, nor used to excuse the missing error term. **Minimum owner correction:** make actual coordinator capture/metadata error outcomes independently sticky FAIL, retaining raw provenance, nonzero/signal/timeout/reap handling. Reseal the changed source and fresh union. No foreign source was fixed here.

## Original correction paths: static assessment

**FC-F02 job accounting:** `capture-budget-v3.mjs:8–13` allocates 933,888 terminal bytes plus 4,194,304 phase bytes and 28,426,240 ordinary bytes inside 33,554,432. Request publication is charged before writing. Process metadata reserves 131,072 before acquisition; only unused ordinary reserve returns after publication. Actual metadata remains charged. Metadata exceeding available capacity becomes bounded explicit FAIL with original length/hash and up-to1,024-byte prefix, never a complete PASS receipt (:64–84).

`owned-process.mjs:59–77` debits accepted stream prefixes before writing and hashes/counts actual partial-write progress; extra bytes set overflow. Synchronous acquisition errors are rethrown unchanged after bounded capture attempts (:43–50). `supervisor.mjs:182–186` rehashes process metadata alongside streams. Its complete per-job snapshot now has the actual32MiB ceiling (:17), includes every regular file, and is counted before and after accounting/outcome publication (:223–229). Accounting requires actual bytes not exceed accounted bytes or the cap; failure escapes to unsafe admission stop (:262–265). Prior outcome explicitly remains PENDING until the final parent row. The job-level accounting correction is coherent in source; CC-F01 is the remaining shared-owner/coordinator error closure defect.

**FC-F03 deadline transition:** `phase-capture.mjs:22–25` saves and checks the outgoing parent deadline at entry; :35–43 checks again after blocking append/fsync and before index assignment. First-late time, outgoing index/deadline and cached error persist (:49–54/:63); late transitions do not advance. The old operation-to-capture gap between polling ticks cannot erase that observed expiration. Absolute minimum caps, 5s/40s setup, 30s semantic operation and cleanup reserve remain. `owned-process.mjs:53` now marks timeout even if another termination began. No shorter polling, timer precision, clock injection or opaque-work preemption is claimed. This correction is statically coherent, not dynamically proven.

Outer nonzero/signal/timeout/overflow and missing receipts still aggregate failure. Ordinary continuation remains gated by integrity and known-owned reap; unsafe/provenance/admission failures stop. CC-F01 identifies the distinct coordinator capture-error omission rather than rescoring those retained guards.

## Preserved matrix and remaining work

The unchanged intended matrix is A149 newly source-compiled direct-module jobs and B149 offline full870 package materialized then physically moved before direct calls. Unmoved is admission only; no third cohort, npm run or public-export proof. Twelve direct type calls plus one build are planned; public5 UNRUN makes18 maximum. Preserve336 reservations/max334 starts due two preouter denials; ten load slots/four known gaps/six future mutants; 194+8 overlap;80 records/135 missing bindings. These are inventories, not semantic passes.

The phase ceilings total24,165s (6h42m45), cleanup inside, no reset/retry; peak4 and existing stream/IPC/event/global bounds remain inherited qualifications. Fixture2MiB capture is not public16MiB proof. Actual candidate execution layouts are not created by this review. Fresh union path/mode/hash/size/membership, recipe/load/root receipt, physical tool/raw archive reauthentication and inert-only historical90a role remain **future union-review obligations**, not checked by absence. No candidate archive analysis or copied-tool invocation was repeated.

All20 deferred author witnesses remain UNRUN. Four existing-host syntax-only parses exited0 with raw streams/status/PIDs/reap recorded. Author original SYNTAX-CAPTURE remains STATIC_CHECK_FAILURE (including document lint), and its shell127/document failures remain historical. Reviewer data-check exit1 from an incorrect edge-schema assumption is retained separately in `PREPARATION-ERROR.json`; corrected data checks do not rescore it. Control/runtime passes and all candidate/authored-code executions remain **0**. Future saturation/timing/reap/build/type/load/semantic proof is UNRUN, not itself a static preparation defect. Root must route corrected sealed source and a complete fresh union; this report grants no GO or YAML/shell acceptance.
