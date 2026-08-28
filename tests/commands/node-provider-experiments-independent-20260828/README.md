# Independent bridge PREEXECUTION review

2026-08-28. **HOLD — no real engine launch authorization.**

- Author code freeze `570e5accd0ff9686fbdc0b00ab1d01a20c82950e`;
  handoff `5aeb915c39612a0e04021818af1251e8f3d78973`;
  manifest `c163bcd7cc0686dc7d4ab67ba24429fe4900c68c244cdf46799bff5b12b4e213`.
- Independent synthetic preseal `e64790155875dfb6cdfba6e8702cb2471b055825`;
  recipe `62e9392bc79a4a9851d2e3da8097e22f898d0098f377e0106e7a80d52c43db61`.
- One invocation, `synthetic-v1-01`: **nine expected observations, zero unexpected
  failures, two explicitly scoped counterexamples; four real harmless children
  closed, reviewer unsafe=false, input guards intact**. This is not nine passing
  engine cases or a current author-supervisor unsafe=false result.
- Real bridge: **0/8 evaluations, seven identities unrun**, including both F06
  reason variants. No author driver/loader/compiler/entry activation, build/install,
  product/native oracle, private access or real runtime staging.

## B1 — Blocking post-spawn outgoing-deadline cleanup gap

`supervisor.mjs.data:47-77` checks remaining time before spawn, enrolls the child
and PID, then calls `remaining()` again at line64 **before registering error/close
handlers** at65/68. If the budget expires during spawn, the second call throws.
The Promise rejects; its finally clears timers that were never installed and leaves
activeChild set because closeObserved was never recorded. The outer finalizer at
291 only asserts no active child; its catch at318-321 retains scratch/STOP but does
not contain/reap that child. Enrollment-before-publication is present; retirement
after this fallible clock check is the missing piece.

**L02 actual harmless-child counterexample:** the exact child body receives a
deterministic second-call EXECUTION_WINDOW_EXHAUSTED fault. It rejects that identical
Error while the real stub subsequently prints READY and remains active. The subject
has no close observation/containment. The reviewer then sends SIGTERM and observes
close. This is a demonstrated component lifecycle failure plus the inspected outer
finalizer composition, not an actual engine leak or measured wall-clock race.
Reviewer cleanup is not credited to the author function. All raw data are retained.

**Narrow repair:** install ownership/listeners and a guaranteed retirement path
around every post-spawn fallible step; precompute outgoing allowance where possible,
and on a later deadline/publication/setup failure contain and await close while
preserving the primary reason. The outer finalizer must not merely leave a live
known child. Retest the whole affected child/outer-cleanup path with a harmless
stub, then version/reseal the changed source and all execution hashes. No repair
was made here, no threshold increase is requested, and no real grant is reusable.

## B2 — Standalone receipt-acceptor counterexample, not a composed bypass

The exact receipt read/acceptance section at275-282 checks canonical stdout,
label/hash/classification, clean/unhandled, status and engineEntered/engineSettled.
It does not independently reconcile source hash, assertion inventory, engineOutcome
or finalResources against those booleans. **D02** supplies PASS/clean:true with a
wrong source hash, empty assertions, failed/unsettled engine and hostPending1; this
section accepts. D03/D04/D05 still reject dirty/nonzero/wrong-hash controls.

**Qualification:** the full fixed driver is separately source-bound. It checks
source at15/20, records its unconditional assertions at224-241, computes clean from
resources at254, and refuses driverFailure/unhandled before PASS at255. D02 did not
activate that driver or demonstrate it can produce the contradictory receipt.
Therefore this is **not a proven composed engine/admission bypass** and is not
counted as an additional real-run failure. Either explicitly bind these composed
preconditions in the acceptance proof or add case-specific reconciliation; do not
claim the parent acceptance function alone validates the omitted fields. Raw F06
engine failures are deliberately observable, not universally required to be ok:true.

## Other reviewed boundaries

All four executable bodies were read: supervisor324 lines, driver259, loader131,
reference entry46. The source/manifest/grant checks, selected tree authentication,
staging map, emission pins, scope of builtin denials, actual-load audit, byte bounds,
negative exit dispositions, archive-before-removal and fresh postcleanup CLOSURE
were reviewed. No old loader/function acceptance was promoted to this new recipe.

`INPUTS.json` proves66 selected public file byte/mode/blob memberships and all18
fresh feasibility bindings from a1,073,919-byte decoded bounded archive. No engine
source was materialized. The63 runtime candidates retain historical emission pins;
the three extra files are source-only. Actual loads/transforms remain unexecuted.
Four external tools were authenticated as regular files. No full-history archive,
private checkout, native-library census or hostile-host-JS sandbox claim follows.

Normal and capture-publication-fault stubs L01/L03 both close naturally before
settlement; L03 preserves its exact write failure. L04 records96 observed stdout
bytes against a reduced32-byte synthetic cap, containment and nonnatural close;
never PASS/natural. The independent observer retained all96 bytes. L02/L04 each
terminate by SIGTERM for the designated negative, while all four close events are
observed. These are separate from the author's requirement for nine natural real
children and8/8 actual bridge outcomes. No historical lost bytes were reconstructed.

The planned actual bound is unchanged: one Git plus eight evaluation children,
serial, ten processes total,480s including30s cleanup reserve,192MiB scratch,
64KiB streams/receipts,2MiB traces,32MiB logs,64MiB raw/encoded archives. Finite
cooperative bounds are not hard OS preemption or RSS limits. Actual authority/load,
capture, natural-close, guard, archive and current closure predicates must all pass.

## Sync-job qualification: no extra experiment

F03 already asserts the queued same-guest Promise reaction cannot interleave with
the held apparent Sync read and following statements: empty marks while held, then
exactly `[true,2,'after','job']`. F07 requires the contrasting explicit-await order
`['job']` while held, then `['job',true,2,'after']`. F02 distinguishes Promise boxing.
The read-admission barrier and final marks, not a host clock or primitive return
alone, are the intended witnesses. They are prospective; neither has run here.
No ninth evaluation or duplicate ordering case is proposed or authorized.

## Review receipt and authorization

`REVIEW.json` uses the exact seven-field author review schema with disposition
**HOLD**, not READY_FOR_FRESH_ROOT_GO. `AUTHORIZATION-STATUS.json` records the
sixteen-field grant interface and exact frozen constants for audit, but issues no
grant, unused run ID, token or launch command. Its authorizedAt must eventually
postdate an actually READY review; a matching hash of this HOLD cannot authorize.
After a repair, a new source/manifest review and fresh root decision are required.

The separate NP1-CJS review retains implementation/provider HOLD for concrete
preallocation and all-job quiescence gaps. Bridge feasibility can remain narrower;
even a later8/8 bridge result would not finish NP1-CJS or the user's Node requirement.
Original36/33, N21 defect, old SafeJS/coherent78/comparator history and grants remain
unchanged. No real launch occurred; stop after this handoff.
