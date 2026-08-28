# Final Corrected Composition: Different Static Review

Date: August 28, 2026. **STATIC_READY_FOR_ROOT_GO_CONSIDERATION** for the exact corrected composition identified below. New code/provenance findings: **0**. This is neither an execution authorization nor YAML/shell acceptance.

## Exact inspected bindings

| Binding | Commit or SHA256 |
| --- | --- |
| Criteria sealed before body inspection | `0d7d7a00` |
| Single-target correction commit | `30c38df6a8ee526392fc59850475dfad679cfd59` |
| Correction FINAL-SEAL | `3abd40dc8b40cc079e12f4a74cebaed825a0c0de9006741910efdc1253621665` |
| Correction ASSEMBLY-OVERLAY | `3b13adfff112166e5d4803da62761fd8d400f9cd355db97019d7efa31cc3eac3` |
| Intermediate composition commit | `c175839a69f4c352c5f8fcfb405ead06782e8684` |
| Intermediate FINAL-SEAL | `f633d77168b78eb061001b98f2da3098a95e8329d049f41bfe027ee1740c1288` |
| Intermediate recipe | `bf66d8929646c85e5d6e63313d59e28422ca6e276718e548e6fe581b18ed5b7b` |
| **Corrected final composition commit** | **`0e8ee2900e7810b911f1335b0d3f05f23ce740c5`** |
| Final composition FINAL-SEAL | `05c3f93e650d2b26e88f793af89c90a52872ce5a5475bdf251df3afcb3c2574d` |
| Final ASSEMBLY-SEAL | `5496ce256fbd2f69798b52ffc11f0ebf0e4d0bcbf37e356ce25722d57a6f3014` |
| Final ASSEMBLY-ORIGINS | `ba848d2d06e655e0b1e4098dd22efdc5e87a4debe5889f1b82fb65dc3be0347c` |
| **Final recipe** | **`92b4c7b958b9f07b75c2f55fa719e83093317a506bb41f74526a4df09eed7c90`** |
| Final PHYSICAL-INPUT-SEAL | `d977b6e68190077c9bb7a231465e91f3d459374361736d0f8e9fd5a07167afe0` |
| Final LOAD-AND-TOOL-SEAL | `c4a4646f273ee7e5dd2fdfed192614b11e8dca7d61812453b87c2ded0d9331b4` |
| Final ROOT-RECEIPT-SCHEMA | `01823fa351319a2b5aeda501698c110fa42134b4da21fd7ca3a860cd07f4123f` |

The final scope is `tests/commands/yq-independent-20260828/executor-b8f5d60d-v1/composition-v4/`. Complete source/descriptor evidence is in `SOURCE-UNION-AUTHENTICATION.json`, `INTERMEDIATE-BINDINGS.json` and `FINAL-UNION-AUTHENTICATION.json`.

## CC-F01 correction

The only source difference is supervisor line276, adding104 bytes: `parent.spawnError !== null || parent.metadataComplete !== true || parent.metadataError !== undefined` as three independent final FAIL disjuncts. Removing that insertion restores the exact27,596-byte946c preimage SHA `7d33d4e0feba862a3bf3b5da3f6e41bd2217871c01d429207b4a47061682a126`. The27,700-byte postimage is SHA `49c7c7050769e2c2edf71a27edd26790ac786e05dc6afbc02c93eba372d361a0`, regular0644.

At final `assembly/core/supervisor.mjs:268–276`, the same object returned by `await coordinator.done` remains the final `parent`. The added comparisons do not mutate, clone, stringify or wrap its raw error/status/signal/reap/provenance. A captured nonnull stream-finalization error now independently forces FAIL; incomplete or erroneous metadata cannot establish success. Existing nonzero/signal/timeout/overflow, global deadline, final reap/integrity, unsafe-stop and row-gap terms remain byte-for-byte present. Normal producer null/true/undefined fields add no failure, but do not imply a passing current cohort.

All13 declared conditions remain **UNRUN**. This is source reasoning, not a constructed receipt, classifier evaluation, real fsync failure or observed current-cohort false PASS. Original CC-F01 witness and `cac8ebac` CHANGES_REQUIRED remain unchanged and unrescored. The correction closes that demonstrated source omission only in the new selected version.

## Independently derived union

First, all72 c175 active files were derived from root-selected b1 plus the exact two3b55/four946c targets:66 unchanged files, four replacements, two additions. The intermediate retained CC-F01 and was not accepted as corrected.

At the single natural checkpoint, a complete committed v4 handoff was available. It was treated as retrieval, not source authority. Final membership is exactly71 byte-identical c175 files plus the sole30c38 supervisor postimage; no additions or unknown executable changes. All85 scope files/eight directories and72 active files/33mjs match committed bytes and fresh regular modes0644/directories0755. Full manifest paths, sizes, hashes and added membership are bound. Before/after checks do not prove absence of change-and-restore.

Recipe changes are limited to the selected manifest and fresh v4 path/seal rewiring. All jobs, phases, dispatch destinations relative to the new root, and active data bodies remain exact. Format strings `yq-b8-composition-v2` and `B8_COMPOSITION_V2_ASSEMBLY_SEAL` remain solely for unchanged admission compatibility, not old acceptance.

The56 relative dependency edges comprise55 static imports, including the JSON import with attributes, and one fixed CLI supervisor dynamic dependency. There are63 builtin edges and two variable candidate/worker dynamic sites: **three dynamic import expressions total**, not only two. The fixed supervisor import at `core/cli.mjs:11` follows admission. All edge targets/hashes remain selected and closed; no helper was imported during review.

## Physical, candidate and authority boundaries

Read-only fresh hashes/modes/kinds/sizes and append-proof membership match249 copied tool files plus two raw archives at `/private/tmp/yq-b8-composition-v2-bMqyvD`:251 regular files,150,255,368 bytes; tools alone146,740,654 bytes, compiler subset248 files. No symlink/hardlink escape was found. The directory contains only `inputs` and `tools`; actual candidate execution layouts are absent. No copied executable was invoked and no archive was extracted.

The raw source archive remains `fe76de08017859b066ecb8830846e109cdab6fa3953b0317e5fc6f27777fd878`; full package remains `1d06350cdef1a5f6c7d70c7d55a19b63537037bd97b2de5a5d8b8b8f722229ca`. Authenticated active maps preserve selected source271/archive273/full870 including README. The two archive-only support entries are `package-lock.json` and `scripts/typecheck.mjs`; no bytes were dropped or relabeled. Previously accepted candidate DATA is retained, not a new independent build.

Root schema constants match the actual physical binding, final recipe hash, selected mutant enrollments and legacy role. Default remains DENY. `core/admission.mjs:13–60/:65–78` requires independently supplied root receipt/hash, fresh0600 receipt/0644 recipe and review seal, exact union/data/tool/archive membership and independent-composition-review role. `core/cli.mjs:6–11` rejects ambient NODE_PATH/NODE_OPTIONS and admits before supervisor import. No receipt, runId, token or GO was created, requested or granted.

Historical90a stays inert `ORIGINAL_MODE_UNATTESTED`: `physicalBindings.legacyHistorical` feeds exact root classification equality, not an executable selector or original-mode predicate. Its path is not an active descriptor; no current filesystem mode is invented as historical proof. Original mode DENY remains historical. No active source/tool/package mode exception is introduced.

## Exact matrix and ceilings

| Role | Preserved reservation and qualification |
| --- | --- |
| A |149 independently SOURCE-BUILT compiled-tree DIRECT-module role-projection jobs; no rawTS/author-output relabeling |
| B |149 full870 OFFLINE package materializations then PHYSICAL movement before DIRECT calls |
| Unmoved | Admission/movement origin only; no third cohort, npm execution or public-export proof |
| Types/build |6 direct typesA+6 direct typesB+1 build=13 current planned compiler calls; public5 UNRUN,18 maximum |
| Outer jobs |336 reservations; at most334 starts absent other refusals because two retained-view slots deny before outer admission |
| Loaded |10 slots: two positive INCOMPLETE/failing on contradiction, two retained-mutant UNRUN, six future actual-mutant/witness obligations |
| Record accounting |194 unique original row IDs+8 overlapping overlays; each149-job runtime profile projects the same132 IDs, not149 unique semantic passes |
| Missing/source proof |80 records/135 missing bindings remain;94 complete/17 partial semantic projection eligibility is not success;23 source proofs/four repair arguments are not public runtime proof |

Phase seconds are **120/300/180/570/300/6705/13410/1560/900/120 =24,165 (6h42m45)**. These are ceilings, not forecasts; cleanup is inside, no reset/retry, peak4 processes. Actual32MiB job capture includes4MiB phase and933,888 terminal bytes. Existing worker16MiB/compiler8MiB, IPC262144 bytes/2048 messages, phase4096 events/4MiB,180 copies and24GiB logical ceiling remain;23.25GiB reservation is not an OS quota. Frozen2MiB command capture does not prove the product16MiB public cap; host-capture-masked/at-C source arguments remain qualified. No hardRSS, timer precision or opaque preemption guarantee is inferred.

## Readiness and evidence limits

No additional concrete code/provenance blocker was found in the corrected closure. Future authorized build, types, physical move, actual loaded mutants, YAML/runtime/control, timing, saturation and known-owned reap observations remain **UNRUN**, not static blockers merely because absent. Same-environment pristine prerequisites, no hash-denial kill credit, raw-before-assert, nonzero-sticky failure and integrity/known-reap continuation qualifications remain inherited source requirements, not newly measured successes. User YAML/shell objectives remain incomplete.

This reviewer performed **one** existing-host syntax-only parse of the final supervisor, with raw stdout/stderr/status/PID/reap recorded before assessment. No author's33 syntax results or13 conditions are inherited as passes. Three reviewer data-reader commands failed and are preserved in `PREPARATION-ERROR.json` (edge classification, literal phase name, ledger scalar-vs-row shape); their statuses remain1. Original author/reader failures, including earlier SYNTAX-CAPTURE aggregate failure, remain immutable. Subsequent corrected data checks do not turn those commands green.

All authored imports/helpers/classifiers/clocks/ledgers/getters/controls, workers/coordinator, compiler/loader, candidate/product and copied-tool executions are **0**. Runtime/semantic/control passes are **0**. The verdict covers static preparation of the exact v4 closure only; any later execution requires a separate root decision and exact fresh authorization.
