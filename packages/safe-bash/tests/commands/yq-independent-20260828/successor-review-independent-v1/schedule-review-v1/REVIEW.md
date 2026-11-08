# Independent Successor Schedule Static Review

Date: August 28, 2026. Classification: STATIC ONLY; not runnable; NO GO.

Verdict: **FINITE_DECLARED_SCHEDULE_COHERENT_TYPE_SCOPE_MISMATCH_BINDINGS_AND_IMPLEMENTATION_PENDING**.
This review does not approve execution or infer product acceptance. Previous
review `36a95bae98185e4db381f0f5b9cfce00f8206208` remains immutable.

## Authority and Authentication

Criteria commit `5ae13b4601066eb51225a25681e8c271fd110440` precedes plan body
inspection. This is post-candidate static preparation, not unseen precode proof.
The original 194 IDs/eight overlays predate the candidate.

- Plan source: `5b121e0c5e136a40bc4b277cab686ab0413af527`.
- Plan evidence: `009c20f812926e4dc7c175b379f85753ff632691`.
- SOURCE-SEAL SHA256: `1f2a8f4670ddcfebf6a36d0c2d55ccf0666609d932de38145dbefc7798e8e891`.
- FINAL-SEAL SHA256: `b29006dedd2d2be64165d6688ed4f451ccb369967a2cac5af97365546128b656`.
- Exact source diff SHA256: `586b0c7299585bb2911bf3e522ea5d33c0dfd1dc03a4afe5abd75e232a75a2bd`.

Independent Git/hash checks authenticate 20 source files, 22 final files, the
20-path additive source diff, two evidence-only additions, unchanged source
blobs, and 258 immutable references. No authored validator was invoked and no
author static PASS was inherited. Authentication covers Git regular/executable
mode, not unrecorded full POSIX permissions or future physical materialization.

## SS-F01 — Direct Type Environment Mismatch

Current user wording requires inspection of six direct fixtures **per
environment**. `JOBS.json` schedules only `TYPE-DIRECT-SIX`, explicitly
`installedMovedOnly: true`; its qualification explicitly says one environment.
Matching source-built declaration bytes is useful provenance, not a second
compiler execution. The proposal is honest about its narrower scope, but does
not meet the current per-environment request. This is a plan-routing mismatch,
not a product failure. Raw exact job/phase data was frozen in
`FINDING-SS-F01.json` before reporting the finding.

Normal additive harness preparation can include the missing source-built
direct-fixture worker; no special policy approval is needed to prepare it. At
the existing allocation this adds one 540,000ms outer slot and six compiler
descendants: 336 outer/18 compiler maximum, with 24,165,000ms (6h42m45s) if all
other allocations remain unchanged. These are arithmetic consequences, **not
an adopted budget**. Reseal either explicit reallocation or a new finite ceiling
and update all affected slot/tool/storage bounds. Keeping the narrower
one-environment type claim instead would require explicit user scope alignment;
do not silently substitute byte equality for execution.

## Exact Cohort and Gaps

Independent corrected static data checks: **51 satisfied, zero unsatisfied**;
these are data consistency checks, not control/runtime passes. The invalid
earlier hash-scope comparison remains preserved separately (see preparation log).

- 194 exact unique IDs; roles 111 semantic /34 admission /23 source /11 lifecycle
  /4 package /5 type /6 negative. Eight overlays overlap these IDs, not 202.
- Two runtime profiles: source-built-direct and installed-moved-direct. Each
  references the same exact 149 frozen jobs/132 IDs: 128 semantic-role job
  projections and 21 admission jobs. This is 298 invocations, not 298 unique
  cases, nor three distinct source/installed/moved execution environments.
- 94 complete-projection-eligible semantic IDs and 17 partial IDs are selection
  labels, not results. All 80 gap records/135 missing bindings remain explicit.
- All 371 declared expected values match frozen job pointers/hashes; every
  frozen top-level expected field is represented. Implementation bindings are
  null. States: 330 declared runtime, 3 declared alias, 7 byte alias, 1 diagnostic
  alias, 24 unbound, 3 fixture/internal, 3 partial-witness. None is a full pass.
- 18 guard/data workers and one CMD22 worker containing 31 unrun definitions.
  Classifier/data controls do not prove actual host timeout/nonzero/reap behavior.
- Source report covers 23 primary IDs plus two overlapping annotations. Of eight
  overlays, NUM14/15, UTF12, ENC07 and QUE12 have both runtime projections;
  WRK10 remains a gap, WRK22/26 source-routed with explicit runtime gaps.

Both environments replay all prepared affected command/parser/query/encoder
fragments; missing observers and private counter obligations are not invented.
Unknown fields/partial projections remain incomplete, not false product bugs.
Old 31 incomplete FAIL observations and the consumed 35da GO stay unchanged.

## Schedule Arithmetic and Limits

| Phase | Outer slots | Cap ms | Absolute cutoff ms |
| --- | ---: | ---: | ---: |
| Authentication | 1 | 120000 | 120000 |
| Independent build | 1 | 300000 | 420000 |
| Setup/admission | 2 | 180000 | 600000 |
| Controls | 19 | 570000 | 1170000 |
| Source audit | 1 | 300000 | 1470000 |
| Source runtime | 149 | 6705000 | 8175000 |
| Installed/moved runtime | 149 | 13410000 | 21585000 |
| Types, as currently scoped | 2 | 1020000 | 22605000 |
| Loaded controls | 10 | 900000 | 23505000 |
| Finalization | 1 | 120000 | 23625000 |

All **335 declared slots** fit their phase sums exactly, and phase cutoffs are
contiguous. Global ceiling is **23,625,000ms = 6h33m45s**. Twelve declared
compiler descendants mean build1 + direct6 + conditional-public5, not twelve
additional outer slots. This arithmetic does not cover SS-F01's absent worker.

Source slots are 5s setup +30s import/invocation/settlement +5s guards/capture
+5s known-reap cleanup. Moved/loaded slots are 40+30+15+5=90s. Their cleanup
contains 1s TERM grace +4s known-group reap/KILL wait, never appended time.
Type totals are 540s direct and 480s conditional public, including their stated
30s cleanup allocations. Nested compiler/metadata reaps must fit those existing
windows; individual ownership/reserve mapping is not implemented evidence yet.

Against the old 27.231s moved **whole-child** maximum, 45s has 17.769s headroom
(about 1.653 times), and 90s has 62.769s (about 3.305 times). These are reasonable
finite conservative proposal margins, not estimates or guarantees. The old
source whole-child maximum was 409ms; neither measurement isolates setup,
import, semantic, cumulative guard or parent bookkeeping costs. Old parent
619594ms/600000ms admission failure is not a product bug or phase measurement.
Future full-prefix guard growth and cohost/tool costs remain unknown.

The proposal correctly uses one monotonic origin, absolute cumulative phase
caps, and whole-slot reservation **before** job preflight. Early phase completion
does not increase local caps; no retry, reset, implicit carry or free bookkeeping
is permitted. Exact slot sums have no additional unallocated transition/grace
budget. The implementation must charge that work inside its stated allocations
and retain UNRUN when a full next reservation cannot fit.

The 10,977,280 metadata-helper maximum equals 335*32768; it is a refusal ceiling,
not planned work or permission for arbitrary Git calls. Declared package/raw/
compiler reservations consume 17,733,517,312 bytes of the 24GiB storage ceiling,
leaving 8,036,286,464 bytes for bounded base/source/tool trees. Admission still
needs exact inventories and enforced reservations; arithmetic is not storage or
process-ownership proof. No hard-preemption/escaped-descendant claim is accepted.

## Proof and Safety Readiness

The six direct definitions are one positive/five exact diagnostic negatives;
five public-only TS2305 negatives remain PUBLIC_EXPORT_GAP. Missing modules,
wrong declaration failures or arbitrary compiler errors cannot satisfy them.
Raw compiler output and consumed declaration/file paths precede classification;
expected diagnostic rejection is internal to a zero-exit worker. Every actual
worker/parent nonzero, signal or timeout remains aggregate FAIL.

Ten loaded slots comprise two positive loads plus four mutant/witness invocations
in each environment: retained-view/UTF22, quoted-DEL/UTF02, quoted-DEL/UTF03,
pending-shadow/ALS04. Actual enrolled mutated module load **and invocation** with
changed captured behavior is required. Hash denial/blocked load is UNRUN_CONTROL,
not killed-mutant credit. Exact preimage/patch/postimage, module entry and load
provenance, whole control-tree manifest, and uniquely bound expected status/
behavior are still missing. NEG05 budget/alias and NEG06 EPIPE gaps remain.
A positive direct factory-shape load is not public export acceptance.

Source23/four repair arguments remain null, not independently proved. WRK06 C+1
rejection cannot establish at-C success; WRK07's author scalar claim is not
independent; WRK17 small internal limits are PROOFCONTROL, not a public cap.
Future at-C/masking claims need the exact frozen prior gate and mathematical/
procedural reachability argument. Generic source extraction is insufficient;
no injected state, reduced caps, private DI or runtime-memory credit is allowed.

The safety prose correctly requires capture before assertions, unique outside-
candidate evidence, exact membership/mode/hash checks including added entries,
and retained prior moved-tree/parent checks. Ordinary failures and post-admission
semantic timeouts may continue only after integrity **and known-owned reap**;
nonzero/timeout failure stays sticky. Unsafe provenance, source/runtime/loader
admission, integrity or unknown reap stops admission. Missing/duplicate/malformed
receipts cannot turn green. These are required behaviors, not executed proofs.

## Minimum Remaining Harness Work

No new execution API exists in this plan. Static reads of the authenticated old
host/type/worker sources confirm the 30s whole-child bound, nested 60s compiler
calls and combined materialization/import/invocation path. Configuration alone
cannot establish the proposed phase separation.

Separately assigned owners need additive successor versions, not foreign fixes:

1. Coordinator plus owned supervisor/tool bridge: immutable root gate, one
   monotonic deadline graph, slot/subphase/cleanup reservations, exact PID/group
   registration, bounded capture, fixed tool counts and unsafe-stop aggregation.
2. Versioned stage worker and capture/classification boundary: real owner-timed
   setup/admission/import/settlement/drain/reap/postguard events, raw-before-
   assert publication, unchanged frozen payloads, exact CMD22 output recipe,
   retained gaps and independently verified actual-host negative controls.
3. Scoped type and loaded-control workers: SS-F01's second direct environment,
   exact diagnostics/consumed roots, compiler ownership, and authenticated
   control-only mutation packages with true load/invocation evidence.
4. Fresh candidate/runtime/consumer/loader/root bindings, tool copies and source
   proof data: exact 5137 baseline +7436 interpreter +authorized YQ/query-core
   origins, source271/archive273/full870 README distinction, independent fresh
   build receipt/map relocation, and regular isolated physical moves. No fake
   commit, implicit HEAD, ambient node_modules/NODE_PATH, source/workspace
   fallback, recycled capabilities or old author-artifact semantic acceptance.

The six named APIs in INTEGRATION-DELTA are proposals only. Minimum path scope
is NEW successor-executor-v1/** plus separately owned narrow successor authority/
runtime/consumer data or helpers; exact file-level implementation seals remain
pending. Normal harness preparation needs no policy roundtrip. Fresh execution
still needs explicit root authorization after complete bindings and review.

## Newly Arrived Candidate Failure Notice

At the single bounded checkpoint, a sealed **failure-only** packet was present:
preseal `a59ac90a60ebdf3e87eb17814e7718b8177c125c`, evidence
`90a633e89d35085183a1d57716451438335b93f3`, FINAL-SEAL SHA256
`e569179037058f038e0fc28345af56ae95e06765e153fe0724cc5fbd273019a2`.
All 13 packet files and four unchanged preseal files authenticate as Git data.

The preserved inspector exit1 occurred on old COMPOUND-RESULT.json's 0600
POSIX mode versus Git normalized100644. The exact original seal records0600;
the old committed bytes match. This corroborates the inspector-assumption
diagnosis, not a product/history mutation. No rerun, chmod, omission, live-tree
resnapshot or artifact scan occurred. Source-observation/pending proposal files
were hashed only, not adopted as new candidate proof.

Candidate b8f5d60d /evidence644460b9 /handoff065f824d and root-supplied archive/
package hashes remain **expected, not artifact-authenticated**. No fresh source/
package/build admission receipts exist here. An additive corrected static packet
and separately routed exact candidate binding remain necessary. No product fix
or guard weakening is proposed.

## Final Limits

Control/runtime/product passes and authored validator/adapter/predicate/
materializer/loader/product/build/compiler/harness executions: **all zero**.
No product/source/private/root changes. Old failures and deadline-UNRUN work
are unchanged. Static consistency, finite scheduling and a failure diagnosis
do not establish runnable readiness or fresh GO. Stop prepared for explicit
binding/implementation routing; no indefinite waiting.
