# Timeout PUBLIC independent review: HOLD on verifier findings

## Exact scope and chronology

One authorized invocation, no retry, on August 28, 2026 from
05:25:54.996Z through 05:31:04.847Z. Product candidate
`67eab12e315054907ef4ef435c6bbca2f59e0c36` is unchanged. The selected composition is
`5137a74ec855a32d8a8860eb66b62eb44d11e290` plus accepted module
`a23867d6a42e1cb2f2e7278cf22061737a4bea9d` plus the three explicit public blobs.
This excludes concurrent changes; it does not claim that existing baseline
modules disappear. Five maintained fixture files/19 literal inventory hunks
were separately authenticated to their author fixture revisions, not counted
as an independent replay of the author's 83 maintained/21 stream-five tests.

The original 031d4dd freeze and 58de5502 preparation remain byte-unchanged.
Candidate inspection preceded this version's concrete bindings and adapters;
OVERLAY.json explicitly records that timing and every adapter change. Sealed
commit `330ffcb9` preceded the 18/18 focused controls and actual invocation.

- Recipe manifest SHA256: `74ee8bb5c667f7b143cdbf637627f67d83eaacaa5f7cea802ed5f2e072747826`.
- Request SHA256: `6d01916d6cd7c0e6f6cbc79697764fba972e1cfc45f857235965b67e45d6877a`.
- Author evidence: `2736db840369a51dd76e7f5cc115bd44fe8e0f54`.

## Actual results

- Source: **22/30 PASS**, 8 FAIL; installed: **22/30 PASS**, 8 FAIL; physically
  moved: **22/30 PASS**, 8 FAIL. The same eight IDs fail in every layout:
  R01, R12, R21, R23, R24, R25, R28, R29. No family is rescored.
- Strict types: **10/10 installed + 10/10 moved**. Root cases authenticate 86
  declarations; leaf-only cases authenticate 9. T08 uses the narrowly reconciled
  predicate below. All other diagnostic expectations are unchanged.
- Admission families: **7/8 PASS**; A07 fails because M07 is not a valid kill.
  Fresh-tree guards **6/6**, package/export/fallback negatives **7/7**.
- All eight mutants executed with the actual altered module hash loaded.
  **7/8 designated kills**: M01-M06 and M08. M07 is **FAIL / WRONG_MUTANT_FAILURE**,
  not a surviving-product finding or an accepted caller-priority kill.
- **128/128 Node children naturally closed/reaped**, no forced termination;
  545 synchronous Git children returned naturally. **258 integrity guards**.
  Runtime cleanup records pending promises=0, owned timers=0, unhandled=[];
  no cleanup failure was accepted to continue an ordinary failed assertion.
- All top-level runtime/type/admission/negative/mutant families were attempted;
  **no top-level tail unrun**. Subassertions after each failed assertion remain
  unexecuted/unqualified, as detailed below. This is not 90 passing runtime cases.

## Verified build, package and loads

Fresh materialization authenticated **269** pristine selected Git inputs and
the **3** public replacements, then actually built, packed, installed offline
and moved the package. The extra input over the original 268 is the exact
baseline README; the author's two fixture-only helpers are not required by
this independent suite (author selected 271). No live-source fallback.

Whole pack **actually reproduced**, not merely bound to author evidence:
`6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06`,
**749907 bytes / 858 authenticated regular members**.
Tools were preauthenticated: Node 22.22.2, Git, 2274 dependency files and 12
metadata-only aliases. Actual compiler/npm loads and declaration reads were
checked. Runtime actual-load observations: **6540 per layout / 19620 total**
(includes verifier helpers); source loads use explicit authenticated TS
transformation, installed/moved loads use actual package exports and nextLoad.
Mutants add 1744 load observations; negatives add 217. No disk-only load claim.

This is scoped committed Git-blob/build proof, **not full-history archive proof**.

## Actionable verifier findings; no established product defect

1. **Plugin readiness**. R01 reads `makeShell().commands` synchronously after
   `.use(agentCommands())`: the first two factory/setup assertions passed, but
   the immediate Shell registry is empty (`0 !== 78`). Baseline Shell.use queues
   setup through `#ready.then(...)`; the fixture did not await that boundary.
   R21/R28 likewise read an undefined timeout definition and attempt to register
   its nameless spread, yielding the exact CommandRegistry TypeError. R23/R24/
   R29 and the Shell half of R25 pre-register a timeout wrapper before pending
   plugin setup: static code exposes the setup collision. Their retained raw
   failure is only “handler settled before required admission (rejected)”; the
   inner rejection's original message was not retained and is **not reconstructed**.
   M07 hits this same setup failure, before the required caller collision.

   Proposed narrow repair: await actual plugin admission before registry
   snapshots/wrapper installation, keeping the real plugin path and all existing
   count, dispatch, raw-sentinel, status/output and cleanup assertions. Add
   readiness/collision controls and preserve the old failing run. No product edit.

2. **R12 stdin probe boundary**. The direct first-vector refusal succeeds; the
   actual Shell route then fails at fixture `[Symbol.asyncIterator]()` acquisition
   inside baseline `InputCursor`, before timeout dispatch. This does not establish
   an input `next()` or content read by timeout. Remaining R12 vectors and its
   later stderr sentinel checks were not reached. Proposed root-reviewed split:
   retain the raw no-acquisition trap; on Shell distinguish iterator acquisition
   and return/cleanup from `next()` reads, and still require zero reads, child
   invocations and timers plus the original exact refusal outputs/statuses.
   No boundary expectation was silently changed in this invocation.

3. **Retirement activation is not assumed**. R25's direct branch actually enters
   clearTimeout, throws the observed identical deadline sentinel, rejects it and
   closes resources in all layouts. Its Shell branch remains unqualified due to
   readiness. M08 actually activates the same retirement collision and wrongly
   returns124, killed by the original RETIREMENT_MAPPED_TO_STATUS predicate. This
   direct partial proof does not turn the whole failing R25 into a pass.

## T08 and preserved history

Before the actual run, independent diagnosis recipe `8d578ca0` executed one
compiler child, retained the original expected2353 predicate failure, and proved
the same intended missing-option rejection: **consumer.ts(2,52), TS2561, invoker**,
exact full message ending `Did you mean to write 'invoke'?`, authenticated root
closure86. Only this unchanged payload's precise diagnostic was reconciled;
no generic code whitelist, unrelated diagnostic or leaf-for-root substitution.
Eighteen focused controls passed. This is not an old T08 rescore.

Original module acceptance, old31/34, missing historical bytes and every prior
freeze/failure remain unchanged. Native/SafeJS executions=0; no full-gate or
public acceptance. Root should authorize a narrowly versioned verifier
continuation for the failed obligations, not a product repair or full rerun.

## Evidence and cleanup

`runs/actual-01/RESULT.json` is the untouched actual result. `REVIEW.json` is
post-processing only, generated by `summarize.mjs`, not a changed predicate.
`runs/actual-01/RECEIPTS.json.gz` retains 1678 files, including all 901 raw files;
13211 work-file inventory entries remain in CLOSURE.json. Archive **12882940 bytes**,
SHA256 `9592272d48060cd6b783c2fbbafe0afd2685e563fbaec3dccdb667c2c1a36ec8`.
Archive decode/hash verification preceded deletion of owned work/raw trees.
CLOSURE.json describes the pre-deletion snapshot; RESOURCE-CLEANUP.json records
actual removal. A post-only progress reader raced this completed removal and
reported ENOENT for raw; no test was retried or rescored. The archive remains the
authoritative raw capture. All writes and the evidence commit stay in owned scope.
