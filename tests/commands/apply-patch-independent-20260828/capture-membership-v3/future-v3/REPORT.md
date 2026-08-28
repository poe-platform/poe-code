# Corrected single ACTUAL apply_patch review — stopped, attempt consumed

## Disposition

One controller launch, exit 1, **27/70 supervised jobs executed; 43 unrun**.
The unchanged controller stopped before `types-moved-positive` admission:
`put()` uses `flag: 'wx'` for `consumer-positive.mts`, but the physical rename
preserved the installed consumer's existing file. The resulting EEXIST is a
sealed harness setup failure, not a moved compiler or product failure. See
controller.mjs:67, controller.mjs:213 and controller.mjs:334. The failed snapshot
was archived; no file removal, permission change, fallback, reseal or retry was
used to continue the attempt.

**The complete peak-two process envelope was not maintained by the operator.**
At the build barrier, waiting controller + administrative Node helper + its
synchronous Git subprocess overlapped (at least three). Exact all-owned peak was
not measured. The controller's reported peak 2 describes only its supervised
job envelope, not all operator work. This additional protocol qualification is
preserved in runs/OPERATOR-PROCESS-QUALIFICATION.md. It is not product evidence
or an authorized retrospective exemption.

## Frozen and generated identities

| Artifact | Identity |
| --- | --- |
| Candidate | `58be2d6c5706f3e90f01d48e695ecfd9daa52669` |
| Author evidence | `767b6729d3acac0dd17c42dfb9e0b93e6e9c4de5` |
| Materialization and corrected ROOT-GO commit | `2bca8eafcd55453fc2fee6a7e677108f306e096f` |
| ROOT-GO.json SHA256 | `233775f3295868f270de72ad12b3fc73ff2e10cd7e43ca021517cc75ff838a27` |
| Exact 32318-byte controller SHA256 | `89af8472d1f19e2e0dee02c3f09d7d011e7c677cec755b4c614aa8b6a5b8ab3d` |
| Execution seal SHA256 | `ec2f19e1825970b662d60a99f2128158ab7ab494b4161ce2a4b0f121f4dcc8e5` |
| Postbuild runtime-seal commit | `07f6a3967994b768f47d0ca8fffb93e19a08fd90` |
| RUNTIME-SEAL.json SHA256 | `9a5a3b4aa2fe5c39ae3ea1cc0b266459d5dccb7e373a4e9b56c78a321a86cf23` |
| BUILD-RECEIPT.json SHA256 | `34a85129559c4a871260755f21d7dbd0571c43ab8c39c623a44297d0204e274d` |
| Actual full882 package inventory SHA256 | `91bbda56c424f883cc1e8b92da48b4ff329e340c4bda913f99259800ab32dce0` |
| FINAL.json SHA256 | `0f9cc57ffe3865f133846f0f82d88a2ac5b52dc1ecd06f37a61d4d50544e9e04` |
| Raw capture membership SHA256 | `74a5aeb0c16922f9e96a98a1fe71125b1e4ade52a95a725486f244568b071098` |
| Compressed failed-work archive SHA256 | `95d29ab19d665ff0816a7d8703656fcb8fcb8f5e769cc66caf9e5727ea9ff69c` |

The exact command was
`node tests/commands/apply-patch-independent-20260828/capture-membership-v3/future-v3/controller.mjs`.
Its stdout/stderr are retained in runs/controller.log; the grant at ROOT-GO.json
references the latest root path correction and both accepted scoped C18 closures.
The final evidence commit is the commit containing this report and the raw files;
its full identity is provided in the final handoff rather than self-embedded.

## Qualified dynamic counts

Rows are original32 plus supplemental80, expanded to126 scenarios per layout.
PASS/FAIL below retain the frozen assertions; no expectation was relaxed.

| Cohort | PASS | FAIL | NOT_RUN | STATIC_NONCONFORMANCE |
| --- | ---: | ---: | ---: | ---: |
| Source, 126 scenario receipts | 115 | 4 | 6 | 1 |
| Installed, 126 scenario receipts | 115 | 4 | 6 | 1 |
| Physically moved, 126 scenario receipts | 116 | 3 | 6 | 1 |
| Observed scenario receipts, 378 | 346 | 11 | 18 | 3 |
| Fixed-limit endpoints, 18 planned | 0 | 0 | 18 | 0 |
| Owned Real adapter, 4 planned | 0 | 0 | 4 | 0 |
| MockS3 adapter, 4 planned | 0 | 0 | 4 | 0 |
| Six mutant before/mutant/restored sequences, 18 planned | 0 | 0 | 18 | 0 |
| All 422 frozen scenario obligations | 346 | 11 | 62 | 3 |

The 62 NOT_RUN total separates 18 predeclared nonexecution receipts from 44
undispatched scenarios after the fatal stop. Three static findings are not
dynamic passes. The 357 dynamically executed scenarios are 346 PASS +11 FAIL.
All32 originals passed in each layout. No dynamic HARNESS_ERROR case record was
emitted; the later controller setup stop is separately recorded, not hidden by
that zero.

| Type cohort | Expected-outcome PASS | FAIL | NOT_RUN |
| --- | ---: | ---: | ---: |
| Source | 5 | 0 | 0 |
| Installed | 5 | 0 | 0 |
| Moved | 0 | 0 | 5 |
| Total15 | 10 | 0 | 5 |

Expected TS2322 wrong-value and TS2305 absent-root-export diagnostics count only
as their specific negative type checks. No moved type process was started.
The actual supervised roles were Git3, guard4, build1, type10, product9. The
remaining roles are type5/product38; no other frozen job was dispatched.

## Findings for the author; no edits or rescore

- **S62, all three layouts:** the frozen truncation-suffix assertion failed;
  actual stderr is the short `apply_patch: permission denied: /work/a` message.
  The predeclared contract-basis qualification remains; this is not adjudicated
  into a new product regression or turned into a pass.
- **S64, all three layouts:** observed rejection, empty stdout, absent literal
  special-character destination and a trace mismatch contradict the frozen
  success/namespace expectations. Raw before/after/call evidence remains intact.
- **S71, all three layouts:** required `access` trace for `/work`, mode2, was not
  satisfied. The permission-denied stderr is retained separately.
- **S74 differs by layout:** source/installed FAIL observed `target bytes changed
  since preflight: /work/b`; moved PASS observed `target changed since preflight:
  /work/b`. No cause or regression is inferred from this unadjudicated difference;
  no repetition was used to normalize it.
- **S32, four S57 variants and S61:** six predeclared NOT_RUN receipts per layout;
  required composed-provider/resource/shared-budget fixtures were not invented.
- **S54:** one predeclared STATIC_NONCONFORMANCE F02 per layout, not a newly
  measured private counter boundary or dynamic pass.
- **Moved type setup:** author action is needed on the frozen controller's
  write-once filename reuse after physical relocation. No source fix or second
  attempt is authorized here.

The six mutation byte pairs M01/M03/M04/M09/M12/M18 were generated and committed
before runtime but never loaded. Zero kills, zero positive/restored dynamic
controls; all18 phases remain NOT_RUN. Other mutation intentions and unplanned
limit probes remain outside executed coverage. Real/MockS3 did not run; DAV,
Mount/Overlay/deployed providers, native oracles, private engines and network
services are NOT_RUN, not implied by the memory-backed scenarios.

## Authentication and actual loads

Preflight authenticated all275 previous references (26,639,996 bytes), all280
successor references, unchanged70 jobs/budgets and the exact five-substitution
controller derivation. Post-run verification rechecked all555 references and
249 tool files/24 tool directories including tool namespace membership. The
old instruction hash is historical metadata only; no instruction body was
materialized or archived.

Candidate inventory was authenticated as raw NUL-delimited Git records, full
50002 entries with exact byte names/modes/OIDs. The complete stored candidate
tree is `189bef24a927241d7c47a662f1ac447b56da1835`. Authenticated268+6 selected
source inputs and five overrides recompute derived base
`8437e4eda904e1248c25eeef0d9d455b1d251495` and candidate composition
`f761c0e1d7a1df48236da38ad78a18cf00a4813c`. No derived identity was required to
exist as a stored Git object; no live source overlay was used.

The build emitted and sealed the actual882-file package. All nine product
children returned217 actual-load records each, 1953 total, including the same
six apply_patch JavaScript modules in every child. Every recorded byte hash,
mode and size matches the postbuild runtime seal. The app hashes and all24 app
emission files are in RUNTIME-SEAL.json; not all882 files are claimed loaded.
Source uses its internal module route; installed/moved resolve the real consumer
package and then its internal apply_patch module. Actual physical relocation
and original-directory absence were observed. This does not create a public
apply_patch export or default registration.

Twenty finite own-data controls, a five-reason identity group, three loader
refusal controls and one binary capture control preceded product admission
(25 recorded groups). Accepted C18 regular52+3 and symlink6+4 proofs were not
rerun or replaced. Trace phase labels in this frozen worker remain existence
checks, not complete ordinal phase instrumentation. The selected build/type
checks do not cover the candidate's complete tests or consumer inventory.

## Clock, capture and cleanup

Controller PID69235 started **2026-08-28T19:59:18.226Z**. FINAL.json records
176554.228875ms before cleanup; the post-cleanup final artifact was written at
20:02:16.110Z and the last log at20:02:16.111Z. The one110-minute clock included
the build-seal wait and cleanup; no clock reset or extension occurred. Final
file timestamps are wall-clock observations, not an invented monotonic cleanup
measurement. All27 supervised children have close/group-absence/retired records;
the exec handle settled with exit1. Exact controller/group absence was observed
during final preservation. No blind kill or foreign cleanup occurred.

Raw stdout/stderr totaled10,040,242 bytes. Exact199-file raw evidence membership
is bound in runs/CAPTURE-MEMBERSHIP.json (19,933,774 retained file bytes including
the encoded archive). Every fragment length, channel, offset, canonical base64,
SHA256, complete stream hash and receipt join was verified. The archive is
4,839,664 compressed bytes and contains2231 entries/2078 files, whose decoded
bytes/hashes and source/package subtrees were verified without rematerialization.
Peak measured work was14,210,103 bytes; controller cumulative work admission was
75,755,140 bytes. These are accounting observations, not RSS or OS quota claims.
The owned .work-v2 root is absent; all failed snapshots remain in the archive.

Capture verification compares exact raw filename membership and detects added
entries at verification time. Tool guards also enumerate additions. This is not
an append-proof claim for the entire repository or arbitrary concurrent writes.
Administrative helper errors (a removed invented prefix assertion before
materialization, and a corrected fixture-source lookup before runtime-seal
publication) are separately retained in runs/OPERATOR-*-CORRECTION.md; neither
changed frozen inputs or repeated a product job.

## Historical separation and final boundary

Unchanged historical cohorts: **197 PASS/1 FAIL/1 unsupported/7 unrun**;
**98/50002** inventory proof; **25 DATA/68 UNRUN** original review;
unauthorized author **66+66 uncredited**. Prior root record
`8405f9228fe646281311ed784d10096361df03ae` remains **0/70 preflight HOLD due to
root command mismatch**, not author/product failure and not a consumed attempt.
It is separate from this now-consumed corrected attempt.

Accepted scoped C18 closures remain
`4934900a237c6930262a623afe303490fdcf0118` and
`9c4dad3091845987d538f4cbb67cd7060268444e`; this report does not reopen them.
Disputed correction/evidence and all old source/fixture captures are immutable
and uncredited as instructed. Review GO is not acceptance/integration. There is
no full compatibility, superiority, default-integration or completion claim.
Only exact operator-owned paths are committed; root coordination, product,
AGENTS, exports, configuration and foreign staging remain untouched. No further
work follows the final handoff.
