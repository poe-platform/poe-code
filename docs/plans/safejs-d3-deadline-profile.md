# D3 workload deadline investigation

The full package gate at b4613fcbc failed both complete D3 bisector fixtures
at their five-second absolute deadlines. At current 1532017b1, the unchanged
function-arity file passes all 18 cases in isolation: original workload 2320ms,
explicit-mode control 2250ms (7.45s total Vitest duration).

An in-memory V8 CPU profile of the built SDK running the unchanged original
fixture without a wall-clock budget completed in 1494ms. It retained the
500,000-step and 128-call-depth caps. Source was extracted from the TypeScript
AST, not rewritten. Dominant samples were measureSandboxData's visit traversal
and intrinsic retained-state callbacks in object-model.ts, followed by garbage
collection. This is evidence of accounting cost, not a proven optimization.

Do not call the deadline failures fixed because the isolated run passes.
Do not raise/remove deadlines or reduce the original workload as a substitute
for investigating the measured cost. Preserve exact retained-data/depth/symbol,
prototype/private-slot, closure-capture and compile-ticket accounting.

Candidate investigation: closures currently traverse many unrelated exotic
brand/state checks before reaching their specialized measurement branch.
Moving that branch earlier would still need to preserve the preceding dynamic
source, private-slot, symbol-property and prototype traversal, plus capture
deduplication. Measure before/after and run the accounting boundary suites;
there is no validated runtime optimization yet.

The worktree's unrelated weak-collection changes in values.ts must remain intact.
At the initial profiling stage, no implementation or delivery was claimed.

Candidate follow-up: moved closure measurement ahead of unrelated exotic-state
checks, preserving the earlier private/symbol work and explicitly retaining
prototype traversal. A work-count regression initially observed an unnecessary
Intl brand lookup on the closure; it now observes none. The accounting control
was corrected to include the function's materialized property table.
117 focused measurement/accounting cases pass. D3 still produces the complete
expected results with its original deadline, but one focused run was slower
under different load; timing improvement is not established by that run.

Alternating in-process baseline-built/candidate-source SDK probes (three each)
reported baseline 1336/1204/1755ms and candidate 1229/1201/1636ms. These use
different loading routes and show only a modest/noisy possible improvement,
not proof that full-suite deadlines are resolved. The deterministic result is
less unrelated type-dispatch work with unchanged focused accounting totals.
Scoped ESLint and TypeScript passed for the candidate. No test deadline,
workload source, step cap or call-depth cap has been changed.
The snapshot-plus-unchanged-arity route passed 1,718 tests across 128 files.
The maintained selected-workspace build passed 23 builds and four fresh-import
checks. This is not a fresh full-package gate.
Three final built-SDK runs with the unchanged five-second deadline matched the
complete native result in 1013/869/1123ms. Different process/JIT/load conditions
prevent treating the difference as a precise speedup estimate. The reduced
dispatch work is validated, but the full-suite deadline failures remain open.
