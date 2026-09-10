# Unify Promise allocation validation

Status: validated independent main repair, separate from pending-Promise snapshots.

Inspection found Promise resolution still used a private allocator duplicating
the produced-value allocator repaired in 4098d92b4. Three tests failed on main
(b13d14): hidden oversized strings were accepted in objects and arrays, and an
unrelated enumerable host accessor was invoked during validation. Two public
guest-accessor/native-comparison controls passed before the repair, so do not
claim ordinary guest getters were broken in those cases.

Replace the private traversal and its wrapper with allocateProducedSandboxValue
at the existing fulfillment/rejection/aggregation call sites. This removes the
duplicate behavior and uses descriptor-safe checking of hidden data. Preserve
thenable lookup, Promise identity, scheduling and guest accessor semantics.

The initial new/main-Promise/retained-callback selection passed all 85 tests
(af5267). Regression coverage is now expanded to fulfilled and rejected paths,
including public native comparisons. Main session 41358 covers those tests,
existing Promise behavior, produced-value allocation, reconciliation budgets
and retained callbacks. Source must stay fixed until it terminates. Scoped lint
and maintained build/native imports remain required before a local atomic commit.
The pending snapshot candidate still has the prior Promise implementation;
port this independently qualified repair after its own live checks terminate.

No push or release during the hold; no full-package or full-goal claim.

The expanded main run passed all 107 tests across five files (96133a), including
both fulfillment and rejection regressions and native guest-accessor controls.
Scoped ESLint passed (2aab2d). The maintained SafeJS closure passed all 23 builds
and all five fresh native ESM import checks (c6c303). Commit only promise.ts,
promise-allocation-accessors.test.ts and this plan as the independent local
repair. The last full package result is still non-green and predates this fix.
