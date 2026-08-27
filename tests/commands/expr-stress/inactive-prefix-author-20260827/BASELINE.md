# Author baseline before evaluator correction

Accepted immutable source is `21220b465537bf45ffcfb36740956a69f43bf75e`.
Independent inputs/driver come byte-for-byte from
`e9ff18dcdd403c68550c9ad9ea69d2edce5403a3`. Its live sealed evidence is
read-only and remains unchanged, including detection of new entries.

The existing evaluator executes inactive prefix arguments and reduces every
prefix except `match`. Guarding only the final reduction would still encode
operands, violating both frozen controls' explicit `noEncode` assertion.
The proposed narrow correction is one early return in `evaluate`'s call-node
branch, **after** its existing budget/cancellation checkpoint and **before**
argument evaluation. The existing parser still validates all skipped syntax,
argument admission and AST node/depth limits. Shared budgets are not recreated.
No syntax/async-parser architecture change is proposed or authorized here.

## Baseline capture chronology

- `baseline-01` is a preserved infrastructure-failed attempt, **not** a valid
  semantic baseline: a new test's tuple-union `includes` caused TS2345; the scoped
  build omitted the dynamically selected regex worker, and the related tests
  timed out. All logs/frozen inputs remain. Its product results are not accepted.
- `baseline-02` fixes only that TS inference issue and explicitly builds the
  runtime-selected worker. It records 191/217 passing, 26 failing, with zero
  cancelled/skipped/TODO tests. One failure was an author instrumentation
  assumption: argument-count admission throws before the first `Budget.charge`,
  so zero charged budgets, not one, must be observed. Exact limit/status/diagnostic
  assertions were already correct and were not relaxed.
- `baseline-03` fixes that instrumentation assertion. It records **192/217
  passing, 25 failing**: all 149 existing related tests pass; the new author
  file is **43/68 passing, 25 failing**. Strict scoped TypeScript and the scoped
  expr/Shell/memory/worker build pass. The unchanged independent driver reproduces
  **40/61**, with both inactive-prefix controls red; Shell overlap stays 3/5;
  the separate historical output-cap assumption stays red.

All three snapshots and drivers are retained. `freeze/refinement-02.json` and
`freeze/refinement-03.json` bind the exact corrections and source hashes;
the original freeze is not overwritten. The final canonical author test is
byte-identical to `freeze/inactive-prefix.test.revision-03.ts.data`.

This baseline is frozen before any product source edit/commit. Capture v3 accepts
only the exact single-line candidate evaluator overlay and the declared new test
overlay atop the accepted archive; it never copies other live source or tests.
It records source inventories before/after with new-entry detection, excluding
generated `dist` and the explicit development-tooling symlink. It does not claim
append-proof compiled output or fully authenticated local tooling dependencies.

Canonical tests write no evidence. Explicit captures require a fresh directory:
`node tests/commands/expr-stress/inactive-prefix-author-20260827/capture-v3.mjs --baseline UNIQUE-NAME`.
No native subprocess oracle is invoked by this author suite. Native GNU/Darwin
expectations are frozen independent evidence, not a new native acceptance run.
The original 19 parser/error-order/submission blockers and old output-cap
assumption are out of scope. No full sequencing closure, universal parity,
superiority, or elapsed-duration completion is claimed.
