# Empty intrinsic retention allocation

The full SafeJS snapshot failed six unchanged workload deadlines/timeouts. The
same three test files pass all 40 cases in isolation, before this change. This
does not clear the full-run failures.

An inspector profile uses the complete original D3 bisector source extracted
through TypeScript's parser from function-arity.test.ts. Source SHA-256:
48a385b2cc8b7a55a18daae961d849b51eafe9ed476206fb13366f7b7d859b2f.
Native output, maxSteps 500000, maxCallDepth 128 and the 5000ms deadline remain
unchanged. Initial fine-grained profiling itself exceeded the deadline. With
10ms sampling, three baseline runs pass in 952.7, 963.4 and 1043.7ms; sampled
retainedValues self-time totals 374.8ms. Do not treat profiler overhead as a
normal-run failure or loosen the deadline.

Intrinsic retention allocated empty descriptor-capture and result arrays, then
Budget delegated through an iterator even when no changed data was retained.
Three deterministic tests fail before the change; a custom empty-array iterator
control passes. Sources can now return undefined to indicate no retained values.
Intrinsic scans allocate collections only after finding a change. Every source
and every required descriptor scan still runs on each measurement, in the same
order. Removing a source still uses setRetainedValues(owner, undefined).

Verification in the current worktree:

- 107 budget, retention, mutation, callback and Intl checks pass.
- TypeScript passes.
- A post-change repeat of the 40 workload tests, concurrent with repository
  lint, passed 38 and failed both D3 deadline cases. This remains a real unmet
  timing requirement, not a passing gate. Recheck without competing validation
  work to separate runtime changes from contention; do not increase deadlines.
- With lint finished and no competing validation process, all 40 workload tests
  pass again (14.50s overall). Focused repository-configured lint also passes.
  Isolated passes still do not demonstrate reliable full-suite timing headroom.
- A concurrent post-change profile passes the same source assertions, but its
  1170.1, 857.0 and 1123.5ms timings are noisy and do not establish an end-to-end
  speedup. The deterministic allocation checks establish the narrower change;
  do not claim the full-suite timing failures are fixed.

Keep all integration assertions, budgets, deadlines and concurrency unchanged.
Isolate this improvement for its own local commit; pushes/releases remain paused.

## Controlled source comparison

In the isolated proposed-commit checkout, swap only budget.ts and object-model.ts
between HEAD and the proposed indexed versions. Keep the exact complete D3
source, native oracle and deadlines; run each variant in a fresh Node process.
Seven-run wall timings are noisy and do not show a dependable improvement.

A followup five-run comparison records process CPU as well as elapsed time.
Total user+system CPU per run, in milliseconds:

- HEAD: 907.0, 835.8, 797.3, 750.1, 788.9.
- Proposed: 838.5, 782.1, 757.8, 697.8, 695.4.

All ten runs preserve the complete native result and pass the unchanged
deadline. Every paired CPU result improves in this small sample (about 5–12%);
wall-time variation persists. This supports keeping the allocation reduction,
not declaring the full-suite timing requirement satisfied. This isolated source
comparison excludes the other uncommitted eval/exception-declaration changes.

The exact isolated proposed commit passes all 147 tests across the eight
retention/budget files and three complete workload files (24.49s). Its package
TypeScript check passes. Main-worktree focused lint and whitespace checks pass.
