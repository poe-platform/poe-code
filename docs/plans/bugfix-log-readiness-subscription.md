# Log readiness subscription lifecycle

## Scope

Fix `waitForReady` log-pattern setup for the public `ReadinessLogSource`, which
allows synchronous delivery during `subscribe`. Change only the health-check
implementation, its tests, and this evidence document. Leave TCP unchanged.

## Plan

1. Add deterministic fake-timer regressions for synchronous replay with and
   without a signal, swallowed callback exceptions, abort during subscription,
   and subscription exceptions.
2. Initialize cleanup before subscribing, observe abort during setup, and release
   a returned subscription exactly once even after synchronous settlement.
3. Run the focused regressions and existing process-launcher suite; record results.

## Evidence

- Red: `node_modules/.bin/vitest run --config vitest.config.ts packages/process-launcher/src/health/health-check.test.ts -t 'log subscription lifecycle'`
  failed all seven new cases before implementation changes (17 existing tests
  skipped). Replay rejected with uninitialized `unsubscribe` or `onAbort`;
  swallowed exceptions and abort without replay remained pending; both
  subscription-error cases retained a timer. Test execution took 12 ms.
- Green: the same focused command passed all seven regressions (17 skipped),
  with 8 ms test execution. Fake time advances by zero before checking prompt
  settlement; cleanup checks cover unsubscribe exactly once, no remaining log
  or abort listeners, and no timers. Late logs and aborts cannot change results.
- Suite: `node_modules/.bin/vitest run --config vitest.config.ts packages/process-launcher/src`
  passed all 178 tests across eight files, including all 24 health-check tests
  and unchanged TCP coverage (1.03 s total).
- Static checks passed:
  `node_modules/.bin/eslint packages/process-launcher/src/health/health-check.ts packages/process-launcher/src/health/health-check.test.ts`,
  `node_modules/.bin/tsc --project packages/process-launcher/tsconfig.json --noEmit --incremental false`,
  and `git diff --check`.
- Implementation registers abort handling before subscription, makes cleanup
  safe before the unsubscribe callback is returned, releases that callback after
  synchronous completion, and clears resources before rejecting subscription
  errors. Failed subscriptions ignore retained callbacks.
- Tests use in-memory log sources and fake timers, with no disk or network I/O.
- Commit, push, and release are handled by the parent task.
