# Await settlement allocation validation

Status: validated independent main repair under qualification. This is not the
pending imported-Promise snapshot feature; keep its atomic commit separate.

## Reproduction

The pending prototype's public future-settlement tests returned lengths 129 and
65 despite stringLength=128 and arrayLength=64. Both boundary controls passed,
and the failures persisted after the Promise allocator unification in 74f834f68.

Main's await-allocation-budget.test.ts reproduced four failures (d182d7):
oversized string/array fulfillment and rejection bypassed allocation limits in
awaitSandboxValue's intrinsic SandboxPromise path. Four boundary controls and
three existing SandboxError identity controls passed. Two additional managed/
unmanaged cancellation identity controls passed before implementation (25f07a);
the other eleven cases were intentionally deselected in that control-only run.

## Repair

Validate settlement data with the shared descriptor-safe allocator before
passing it from the intrinsic await path to guest code. Preserve existing
SandboxError rejections and the active signal's exact abort reason instead of
reclassifying their internal strings as a new allocation failure. Keep host-call
consumption, thenable preparation and cancellation ordering unchanged.

All 124 tests across await budgets, Promise allocation, existing Promise behavior
and cancellation passed on main (6b5d88). The same runtime diff is in the isolated
pending candidate, where all eight public future-budget, pending-cancellation
and nested-proof cases passed (a386fb). Oversized late values now reject before
the test's subsequent guest effect; at-limit values still succeed.

## Remaining qualification

Main's broader async-function cancellation, public reconciliation cancellation,
retained-callback and nested-host replay selection is running. Keep runtime
fixed until terminal, then run scoped lint and maintained build/native imports.
The candidate's earlier 92-test compatibility result predates this await fix;
refresh that qualification before integrating its pending-node format.
No push, release or full-package success is claimed.

The broader main selection passed all 30 tests across four files (a8fb5d),
including all 21 retained-callback cases. Scoped lint and the maintained
workspace build have started after that run terminated; collect their results
before committing. No fixtures, limits or timeout values changed.

Scoped ESLint passed (affc84). The maintained closure passed all 23 builds and
five fresh native ESM import checks (5fbc68). Commit only cancel.ts, the new
await-allocation-budget.test.ts and this plan as the independent await repair.
The pending-node format remains isolated and needs refreshed qualification.
