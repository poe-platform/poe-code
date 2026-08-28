# M1B runner static review

Status: Changes required before launch; source/data review only

Implemented Through: `a3021720f22c44b66eab7f0bacbfe1d7955a10ae`

Purpose: Review the committed runner's admission, capture, process and deadline boundaries without executing the runner or independently accepting this reviewer's own components.

Date: Friday, August 28, 2026

## Scope and authority

This is one finite review of the runner tree
`46a6df2a2ee68d0c84fe56da54c9eeb057e8cfe0`, selected from its explicit Git
implementation history. The ABI handoff names
`de95161c9de136852884d054612dad1b8ec716e5`; subsequent committed runner sources
are `203f5f0088ea7452ba6bc3b07f38cff63ead838c`,
`10c62e8ed1614516fd042522c3f4fea3a62f83a0`, and the reviewed `a3021720`.
Mutable HEAD is not candidate or executable authority. The reviewed parent
scope tree is `58b22fa9ff8911e39919c0aa43e48d80201845b4`.

The snapshot contains a recipe and executable closure but not the final
parent `FINAL-SEAL.json` required by launch. The lead was still sealing it;
this known preparation state is not reported as a new defect. No later
uncommitted or newly committed runner body is included in this review.

The target stays source `fca6f81d2d96db2bbceabf3247cd57ffe240bde6`, evidence
`897e5141b034b59501f576a259d5ea1e7e2673c6`, selected derived-only tree
`23074ef0c443ca618c4f26204b5f3d2274b86895`, and full package SHA256
`cc0e75c2d0d12f713f0458e608ddeae157cf3432b4e0b48277a329a98115aa1a`.
The independent review's ceilings remain 168 all-nesting owned children,
peak4, 7200 seconds from one origin including cleanup, 256MiB capture,
1GiB working files, case30s and build120s. No exception, retry or new GO is
created here. Host scheduler lateness is not a hard-preemption guarantee.

The fourteen parent executable bindings and twenty-two worker-projection
bindings match their committed bytes and sizes. `SNAPSHOT.json` binds the
source, control and data identities inspected. Git inventories use NUL-framed
records. Git regular/executable class is distinct from declared POSIX mode;
this source review is not a fresh runtime filesystem-mode admission.

## Findings

All findings below are prelaunch harness-source conditions, not observed
candidate failures or executed counterexamples. Their exact preimages are in
`SNAPSHOT.json`; expected future checks are data in `DEFERRED-CONDITIONS.json`.

### RS-F01 — Missing concrete outer startup capture

`runner/launch.mjs:11` starts fallible argument, receipt, seal, Node identity,
filesystem and import work. The output directory is first created at line55;
the coordinator is imported at line59 and entered at line60. Only then does
`runner/coordinator.mjs:35` create the budget and line66 publish `root-route`.
The documented command at `README.md:115` is a bare Node invocation, without
an outer durable stdout/stderr/status capture mechanism.

A wrong route hash, unreadable seal, failed output mkdir or failed bootstrap
import can therefore escape before the reviewed implementation owns durable
startup raw capture. Terminal stderr is not that evidence artifact. This
does not assert that an uninspected root launcher already exists or fails.

**Required correction:** the launch composition must bind concrete trusted
outer-owned startup capture before fallible launch/admission, including its
stdout, stderr, actual status, timing, known retirement and accounting. Its
process/capture/storage costs must fit the same ceilings. An independently
sealed outer mechanism can satisfy this boundary without changing product
code; no such mechanism is in this reviewed closure or launch command.

### RS-F02 — Outgoing absolute phase deadline is discarded

`runner/coordinator.mjs:61` defines `phase(name)` solely as admission against
the incoming phase end plus a phase record. It retains no outgoing phase
deadline and makes no outgoing completion check.

For example, setup begins at line93, performs tool/harness/source
materialization at lines94–102, then enters build at line105. Completion at
600001ms is late for setup's 600000ms end, but the transition still admits
against build's 720000ms end. Similarly, build validation and guards at
lines114–124 can finish after build's end and enter install's later end at
line125. No child timeout need occur in these examples: the lateness is
parent-side work after or outside the child.

**Required correction:** the parent must retain the outgoing phase authority
and check its observed completion time before a transition replaces it.
Late setup, validation, capture and cleanup must remain a sticky failure;
they cannot borrow the next phase's budget. A shorter polling period is not
this check, and no stronger host scheduling guarantee is requested.

### RS-F03 — Batch lifecycle and retirement omit final deadline checks

`runner/cases.mjs:51` starts batch setup, reserves work, creates directories,
inventories candidate/harness and writes controls. Its 30000ms batch deadline
is not established until line80. After `supervise` returns, lines159–169
perform fresh guards, control authentication, case inventory, owned deletion
and grant release without checking that deadline.

Inside `runner/supervisor.mjs:92`, the close callback records `closedMs`,
clears the clocks and resolves retirement, but never compares that observed
time to `currentDeadline`. Post-close stream sync/close and receipt publication
at lines106–112 also have no final observed deadline check. A zero-exit child
closing before its timer, followed by slow parent guard/deletion or spool
closure, can finish beyond the batch deadline with no timing failure. A close
observed late before a delayed timer callback likewise lacks a sticky check.
These are source conditions, not a measured scheduling failure.

The README at lines67–69 explicitly says setup, capture and cleanup share the
batch's 30000ms. In this recipe all36 batches are exactly30000ms, so this
finding does **not** rely on falsely claiming that `endCase()` extends a
shorter case clock in the current fixed batch schedule.

**Required correction:** fix one batch origin before its setup; retain its
deadline through capture, known retirement, guards and cleanup; check actual
parent-observed completion before accepting or continuing. Preserve nonzero,
signal, capture-error and unknown-retirement failures independently. Deadline
checks establish truthful classification, not opaque filesystem preemption.

## Source checks without a new finding

These are code/data observations, not runtime passes or full acceptance.

| Boundary | Inspected condition and limit |
| --- | --- |
| Selected source | `source-admission.mjs:25` requests282 inputs plus stored commit/tree objects; lines37–76 hash raw object bodies and walk exact component bytes; lines78–104 compose and check the derived tree without demanding it be a stored object. The sealed map has5 actual origins,60 stored trees and347 unique requested objects. |
| Source admission timing | `coordinator.mjs:79` owns the Git metadata child and requires zero/known retirement before source authentication or product loading. It does not execute Git as a product oracle. Future source authentication remains UNRUN here. |
| Full package | `archive.mjs:19` verifies raw gzip size/hash before decompression, bounds expansion, refuses links/nonregular types/duplicates/unsafe paths and compares all910 file identities including README. The gzip bytes independently matched806626 bytes and the pinned SHA during this data review; no runner parser was called. |
| Independent build | `coordinator.mjs:111` invokes the pinned compiler against the selected `tsconfig.build.json` with explicit typeRoots; zero/known retirement precedes all908 emitted-byte and source-input comparisons. No author JS is substituted into S. `strict:true`, NodeNext and the selected baseline's existing `skipLibCheck:true` are retained, not silently changed. |
| Offline installation | `coordinator.mjs:130` supplies `--offline --ignore-scripts --no-audit --no-fund --no-bin-links --package-lock=false --save=false --omit=dev` and explicit prefix/archive. The environment has private empty npmrc files and cache; `tool-fence.mjs` denies process/network dispatch. No npm invocation occurred in this review. |
| Installed/moved identity | Lines134–139 guard the complete910-file install, physically rename it and require old-path absence plus equality. Installed-unmoved is admission only, not a third semantic layout or public-export proof. |
| Tool domains | `TOOLS.json` distinguishes original observations from the regular copied projection. npm has2027 regular files and12 explicitly omitted original symlinks; the other trees have132 TypeScript,74 Node-type and41 undici files. Both originals and projections are separately guarded. No AGENTS files are copied by the declared source projection. |
| Inventory ordering | `primitives.mjs:80` uses bytewise component-ordered depth-first traversal for inventory and guard. All four committed tool tree row lists match that ordering as data. Package comparisons use one full-path byte order on both sides (`materialize.mjs:54`, `archive.mjs:50`). No ordering contradiction was found. |
| Loader | `cases.mjs:55` takes complete candidate/harness inventories; the parent writes hashed job/load controls. `loader.mjs:6` authenticates the load control; each enrolled module is path/mode/size/hash checked before evaluation. Actual module loading is UNRUN. |
| Own-data | `primitives.mjs:18` validates finite values, descriptors, exact array keys/order and holes/accessors/extras rather than requiring prototype identity. This is not a hostile host-JavaScript sandbox claim. No cross-realm control was executed. |
| Child status and known retirement | `supervisor.mjs:110` makes nonzero, signal, timeout, spawn/capture errors and absent close independently fail. Unknown retirement marks unsafe; `cases.mjs:166` refuses continuation unless retired and safe. `coordinator.mjs:213` only signals tracked owned children. RS-F03 limits deadline acceptance, not these existing failure checks. |
| Capture ownership | Parent spools are created before each child spawn; parent acknowledgement follows case raw flush. Stream bytes, control files, metadata and final outcome reservations use the same Budget. Failed capture is unsafe. RS-F01 concerns the earlier bootstrap boundary. |
| Working files | Capture reserves also reserve working bytes. Materialization and declared build/install/case grants are charged. Deletion releases only after owned-path absence. Final totals inspect regular-file membership. These are logical file accounting, not hard OS/RSS quotas. |

## Known integration work, not new findings

1. **Type API v2** source
   `10186980049dee95c062f88b2ae093962c8f328e`, evidence
   `33775a17d315d469aa8817c2421e3b6077b3e0b7` is root-approved but absent from
   this runner snapshot's active compiler protocol. The existing five fixture
   template hashes match. The future runner must transport the explicit
   compiler-API result, not fabricate a CLI status; actual nonzero API worker
   exit remains fatal. Its admitted tool/subject contexts, request/raw/result
   roles, exact diagnostics and bounded transport must be composed. In this
   snapshot JSON captures are64KiB and IPC frames128KiB; the new API result's
   declared512KiB maximum cannot be assumed to fit without that integration.
   This is an interface-reconciliation dependency, not independent acceptance
   of the type component authored by this reviewer.
2. **Semantic integration** source
   `c3d8a8578b9e83af9b16fb85d553f05a66d5a534`, evidence
   `b57b45b7461cb133863f6b0a97e8fdcf7fc8cf3b` adds9 witness IDs/14 batches.
   The same-root restore, actual loaded identity and preceding witness gates
   belong to the pending runner integration; the old6 loaded calls are not
   evidence that these new requirements have already been implemented.
3. **Semantic mode-v3** is separately assigned to correct the already-known
   SOURCE-only mode contradiction. This review neither invents another mode
   finding nor authenticates an uncommitted correction.
4. **Sticky ordinary assertions** are already nonthrowing in this snapshot's
   `worker.mjs:84`, but line119 still ends the batch on any nonPASS. Root has
   already required safe continuation after raw capture, known case cleanup
   and fresh candidate/harness/control guards. That known change is pending;
   escaping/capture/integrity/unknown-cleanup errors remain STOP and actual
   nonzero child status remains aggregateFAIL.

The snapshot declares36 wrappers +1 metadata +1 build +1 install +10 type
compiler children =49 descendants,50 including the coordinator, peak3.
Its capture proposal is258801664 bytes, leaving9633792 bytes under256MiB;
tool copies total159186899 bytes. These are the **old snapshot's** exact
proposal counts, not the pending union's accepted costs. The14 extra semantic
batches and replacement API-worker capture/tool materialization must be
reconciled within the same ceilings, not simply added as extra allowance.

H09 remains SOURCE_ONLY/UNQUALIFIED as allowed by root. The S02 source concern,
public-export gap, exception-injection-only ownership qualification and all
old author/independent histories remain unchanged. No full resource, native
allocation, RSS or public-cap proof is inferred. This reviewer does not
independently accept mechanical or mechanical-type-api-v2.

## Preparation evidence and conclusion

Source/data/hash reads only: zero candidate, compiler, npm, loader, runner,
fixture, mutant, control or new-module executions. No syntax/checker execution
was used for this assignment. The write-spec skill was read for audit format;
its executable checker was not run under the source/data-only restriction.

One reviewer metadata script mistakenly treated `candidateCompiledFiles` as
Git paths under the review scope after authenticating the14 parent and22
worker entries. Git returned128 for the nonexistent review-relative
`dist/commands/archive/create.js`; the outer metadata command returned1.
This preparation-domain error is retained in `PREPARATION.json`, not attributed
to a missing candidate artifact or rescored. Correctly separated data reads
followed; no reviewed module or target was run or retried.

**Disposition: REQUIRES_CORRECTION.** Three new runner-source findings are
routed, with the known integration dependencies separate. All dynamic
conditions remain UNRUN. A final assembled union, peer reviews and root
routing remain outside this report. Later genuine fixes need only an exact
delta review; this report does not request another broad review, execute a
cohort, modify peers or create GO. No runtime scratch or owned child remains.
