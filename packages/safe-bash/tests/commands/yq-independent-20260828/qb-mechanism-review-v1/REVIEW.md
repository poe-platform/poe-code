# Independent final QB mechanism PRECODE review

Status: Bounded static review complete; **root terminal-checkpoint decision held**.

Implemented Through: Not applicable — no product module was imported or executed.

Purpose: Review the proposed shared-Budget reservation mechanism, not author or
implement it, and freeze the remaining exact decision before yq GO.

## Binding and scope

The inspected author base is `89e403e080ba2ac051bcc19a634d9e964620152d`, with
additive clarification `6620463abdf7e952aaa855abfba13159a6c5cc83`. Latest
`qb-policy-v1/README.md` SHA-256 is
`96a7ae5aa36cec464a28d9ba09cfcd9791cb0dd09e80a51a6fc203cdd87b7ac6`.
The clarification retains the entire base README prefix and changes only the
README and identity chronology. The base's arithmetic runner and controls are
read-only evidence; **its reported 23 rows are neither run nor counted here**.

`SOURCE_IDENTITY.json` pins the exact files, revisions, blobs, hashes and selected
line spans. Adopted 5783/cfa6, b311 checkpoint wording, and the fixed 544f8279
reconciliation were compared. The current assignment's root QB1/QB2 decisions
control: new async yq-owned traversals are authorized for design, existing engine
internals remain qualified, and whole-copy work including its required checkpoints
is preadmitted against the one existing Budget. N/encoder decisions are not
reopened. Accepted length74361026 and full846 packaging are not dependencies.

EXACT5137 is commit `5137a74ec855a32d8a8860eb66b62eb44d11e290`, tree
`48e5ae39ce98e1c8e416bae77da40d88b75e1db5`. Its Budget bytes equal those at the
accepted length revision. Only the admitted length arm is considered as an engine
delta; current HEAD is not a replacement source base. Original 194/80/62 packets,
their receipts and author/adopted files remain unchanged. This informative review
is not a competing specification. The write-spec skill/reference were read.

## QBM-01 — formula correct conditionally; terminal policy is not interchangeable

For the author's **before-next-unit** rule, let `W=1023`, `0<=c<=W`, `U>=0`.
For positive U, checkpoints occur before unit indices
`W-c+1, 2W-c+1, ...` that are at most U. Hence
`K=floor((c+U-1)/W)`, `c'=c+U-KW`, and `1<=c'<=W`.
For U=0, K=0 and c'=c. Reservation U+K is exactly this rule's cost. The independent
unit-by-unit oracle agrees with all 16 literal boundary rows; no off-by-one is
alleged **within that policy**.

The author expressly permits finishing at c'=W (policy lines 104–123, 180).
The original adopted clause instead says “After no more than 1023 yq-owned units
without an await, call Budget.tick” (final contract line 268; b311 lines 338–347).
It does not expressly settle terminal flush, empty close, or transferring this
obligation to a later operation. The new conservative counter also ignores
unrelated awaits; async `beforeUnit()` calls cannot be used as a loophole to
discard its checkpoint debt. Root approved prepaid accounting, not yet this
exact before-next/terminal interpretation. Arithmetic success alone does not
resolve that policy delta.

**Smallest positive-work discriminator:** c=1022, U=1, remaining Budget=1.
The proposal reserves step(1), finishes at 1023 and publishes after credit
closeout. If reaching the threshold requires a final checkpoint, the copy needs
2 steps and must fail admission **before allocation**. Adding a real tick in
finish would discover the deficit too late; an unpaid immediate would omit the
step; silently resetting pending would change the next operation's cost.
Cases S10/A02 freeze this distinction. S03 gives the c=0,U=1023 form.

### Explicit narrow root choices — neither selected by this reviewer

**CARRY:** Adopt before-next timing expressly, including terminal operations.
Keep K and c' unchanged. `finish()` does not flush or reset pending. U=0 costs
zero checkpoints even at c=W; the next ordinary owned unit must checkpoint,
whether in the same document or a later owned phase. If no such unit follows,
no terminal Budget tick is owed. A signal/publication guard and cooperative
cleanup still apply; they are not an uncharged checkpoint substitute.

**CLOSE-THRESHOLD:** Require a checkpoint at each owned phase close (estimator,
alias reservation, and final owned command phase) when c'=W, including an empty
close that inherits c=W. Before alias allocation reserve
`U + K + delta`, where `delta = (c'===W ? 1 : 0)`; check that final addition too.
Consume the extra prepaid checkpoint during **async** closeout and leave pending
zero only after success. This changes proposed `finish(): void`, its zero-credit
condition and its exact final-pending expectation. Ordinary preflight closeout
pays its own real tick before copy planning; copy closeout uses prepaid credit,
not a second real tick. If root instead wants nonempty-only close, it must also
say so: c=W,U=0 distinguishes that third timing rule from CLOSE-THRESHOLD.

Thus S13/A06 freezes the empty distinction: cost 0 under CARRY, cost 1 under
CLOSE-THRESHOLD. U=0 is a private accounting boundary, not evidence that a valid
nonempty alias subtree can have zero copied nodes. Terminal flushing is not a
blanket flush for c'<W under either stated choice.

## QBM-02 — last-unit cancellation needs a non-timer closeout binding

The clarification correctly specifies prepaid timer rejection selection:
check the signal first; on rejection, an aborted borrowed signal supplies its
exact reason, otherwise preserve the yield failure; after fulfillment check
again before resetting pending. This covers false/null/undefined/object reasons
without truthiness or equality-derived provenance (policy lines 266–290).

It does **not alone** cover a reservation with no checkpoint. With c=0,U=1,
`await beforeUnit()` may fulfill without entering the timer helper. Abort can
become observable before the copy continuation. Likewise credit exhaustion is
not a signal or closed-admission check at final publication. A literal consumer
that checks only checkpoint signals and the listed `finish()` credit predicates
can allocate/publish in these traces (T06/T07), contrary to the retained abort
and no-publication rules at policy lines 193–211.

This is a required binding of already-settled cancellation, **not permission for
a new policy**: check borrowed cancellation/closed admission after awaited unit
admission before allocation, and at final closeout before publication; prevent
publication after abandon/close. A bounded synchronous final copy and its guard
need no fictional concurrent host mutation. The counterexample relies on an
actual await boundary, not arbitrary preemption of synchronous work. A signal-only
guard adds no adopted work unit; if a terminal *checkpoint* is selected, its
separate step and await must be reserved as QBM-01 describes. No additional
normal diagnostic, refunds, or modification of fixed `Budget.tick` is authorized.

## Checked arithmetic and shared admission

Validate c/U types and bounds first. For U>0 test `U > MAX_SAFE_INTEGER-c`
**before** c+U, then form the safe nonnegative sum-minus-one. K*W is bounded by
that sum-minus-one; it cannot exceed the admitted sum. Before U+K, test
`K > MAX_SAFE_INTEGER-U`. Any optional terminal delta needs the same guarded
addition. An after-addition `isSafeInteger` check is not the required ordering.
O05 rejects c+U; O06/O07 admit that sum but reject U+K. O01–O04/O08/O09 reject
bad arguments. No large allocation, BigInt or product Numeric conversion runs.

The data-only remaining-budget rows describe mathematical admission states, not
an API exposing private steps or reachable full YAML invocations. Real admission
is still exactly one existing `Budget.step(total)` after all descriptor checks.
`limits.ts:53–56` checks signal **before** increment but increments **before**
maxSteps failure: an aborted admission changes nothing; a live limit failure
does change private steps, yet installs no local credits/projections or copy.
Do not invent rollback, a second Budget, or reuse after terminal failure.

Safe total alone would not generically prove safe addition to an unknown private
counter. Here the real descriptor must satisfy the existing node/value bounds.
Conditionally on faithful U enumeration, N<=100000 copied nodes, at most 2N
key/string/number payload operations and at most 8388608 compact-covered payload
bytes give U<=N+2N+8192=308192, K<=302, total<=308494 (plus at most one terminal
step). Adding to a still-live Budget at <=1000000 is safe. This conditional bound
is not validation of an implemented estimator; an arbitrary safe-integer argument
to reserve does not replace descriptor admission. The invalid arithmetic controls
are defensive private-contract cases, not new public limits or diagnostics.

Estimate work/checkpoints are charged separately first; use its **post-estimate**
pending to plan the copy. Q01's estimate leaves 1023, so copying one unit costs
2, not 1. Reserved ordinary/checkpoint credits are then consumed exactly once;
direct signal-bound immediates do not call real tick again. Actual bounded payload
fragments of one operation share its partial byte bucket; distinct operations
do not merge. Faithfulness of that descriptor/schedule remains implementation
work, not an arithmetic pass. No query, scanner, estimator, normal charge or
nested reservation may interleave while credits are active.

## Existing versus future scheduling and settlement

Fixed `Budget.tick` calls step, conditionally advances its private nextYield,
awaits the signal-bound immediate, then checks the signal (`limits.ts:58–64`).
It has no catch around timer rejection. The future prepaid helper always awaits
its own immediate and does not update nextYield; a later engine tick may therefore
yield again. The author discloses this timing difference. Equal step totals do
not prove identical scheduler timing, cancellation timing or engine state
trajectories. Existing engine code remains unchanged and bounded-sync-qualified.

Cancellation after reservation burns all credits. Failed checkpoint leaves
pending unreset; finally abandons the scope, drains its cooperative scheduled
work and forbids session reuse. Exact finish catches under/overrun before alias
publication; close must also reject late admissions. Root caller cancellation
observed before public settlement wins, then escaping execution/control failure,
then cleanup, then normal result (`command.md:104–138`). Observe late failures
without preempting opaque host work. Do not turn this into “every Shell.exec
rejects,” and do not claim a later cancellation reverses completed output.

## Evidence and disposition

`CASES.json`: **64 original records** — 52 arithmetic/control rows (including 10
discriminating mutations) and 12 prospective trace-schema records. The independent
small enumerator checks the claimed formula against literal boundary outcomes;
both terminal-policy columns are conditional alternatives, not competing product
goldens. Trace records are not event-loop simulation or runtime cancellation tests.

`node tests/commands/yq-independent-20260828/qb-mechanism-review-v1/check.mjs`
checks only this new data and selected immutable Git bytes. It imports no product
or author checker, runs no old checker, and writes no evidence. `CHECKS.json`
records the separate bounded result. No native, package, build, type, service,
performance or conformance evidence is produced. New async boundaries resolve
the earlier synchronous-role objection in design; full alias precharge is
mechanically plausible **conditional on the explicit terminal policy and guard
binding above**. Root's final decision checkpoint remains before GO, not before
another native run or a length-package replay.
