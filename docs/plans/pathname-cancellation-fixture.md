# Pathname cancellation fixture

## Failure and cause

The pre-push log `/tmp/poe-inline-fatal-push.log` records one failure at
`tests/shell/pathname-classes.cases.ts`: "unmatched bracket tokenization yields
to cancellation", with "Missing expected rejection" and a 1.132333 ms case
duration. This happened before the incoming SafeJS realm feature. The repair is
on parent-reported rebased HEAD `e524859cd`; no cause is attributed to realms.

The fixture queued `setTimeout(..., 0)` and assumed it would abort before a finite
8192-character tokenization completed. Production already yields using a real
`setImmediate` every 1024 work units and checks cancellation on resumption.
Node 22.23.2 clamps timeout delays below 1 ms to 1 ms and does not guarantee exact
timer timing/order. Completing these finite immediate checkpoints does not
guarantee the wall timer has fired. Cohort warmup can expose that scheduling hole,
but historical warmup/phase timing was not captured and is not claimed as proven.

Official scheduling reference:
`https://nodejs.org/download/release/v22.23.2/docs/api/timers.html`
(`setTimeout` and `setImmediate` sections).

## Bounded repair

Only `packages/safe-bash/tests/shell/pathname-classes.cases.ts` and this note
change. Queue cancellation with a real `setImmediate` before calling production
`matchesPattern`, and cancel that handle in `finally`. The cancellation callback
records the ordinary mutable work counter; it does not use a signal getter,
mock matcher, alternate registry or production override.

Preserve the original 8192 opening brackets, subject `x`, 1048576-unit budget,
exact rejection-reason identity and the separate 100-unit compilation-budget
negative. Add assertions that actual tokenization began before cancellation,
that cancellation happened before all pattern characters were consumed, and
that no further work was consumed after cancellation. There is no time-based
performance assertion, timeout increase, retry, bypass or production change.

## TDD and qualification

Artifacts: `/tmp/poe-pathname-cancellation-20260902.RjKdx8/`.

- Deterministic red: `not-due.test.mjs` holds only `setTimeout` timers not-due,
  leaving production immediate yields real. The original reports the same
  missing rejection; its budget negative passes (1 pass / 1 fail).
- After the fixture change, that schedule passes 2/2. This clock control proves
  the ordering defect, not historical elapsed timing or live yield by itself.
  Node's experimental MockTimers warning remains visible; it is not suppressed.
- Live, unmocked qualification after the parent's September 1, 2026,
  22:47:30 CDT build boundary uses Node 22.23.2. The direct file passes 2/2;
  the actual `shell-language.test.ts` cohort passes 160/160, including case/glob
  budgets, no-effect negatives and its other cancellation checks. These are
  scoped correctness runs, not a new full-suite or performance claim.
- An unchanged production-source copy also passes 2/2. Temporary negative copies
  then replace tokenization's immediate yield with microtasks only (1 expected
  failure), remove tokenization's abort check while preserving its real yields
  (1 expected failure), or remove its budget charge (2 expected failures).
  Thus a fulfilled microtask is insufficient, late rejection only at matching is
  insufficient, and the original finite-work negative remains effective.
- `qualification.json` records exact commands and source/fixture/cohort hashes;
  those files remain unchanged through qualification. Negative copies live only
  under the temporary directory; production `src/shell/pattern.ts` is not edited.
- Scoped ESLint and strict no-emit TypeScript checks pass with empty diagnostics.
  They target the changed case file; no workspace build, full suite or Git
  mutation was run by this worker.
- Initial co-loaded controls are separate from post-build qualification. A first
  patch command used the wrong relative path and applied nothing; the resulting
  old-fixture red and incidental old-fixture live pass remain in their original
  logs, and are not counted as candidate validation. No failing candidate was
  retried to obtain a pass.

From `packages/safe-bash`, the ordinary focused commands are:

```sh
node --import tsx --test --test-concurrency=1 tests/shell/pathname-classes.cases.ts
node --import tsx --test --test-concurrency=1 tests/shell/shell-language.test.ts
```

Root owns Git and the subsequent full pre-push gate. This fix establishes a
deterministic cancellation observation boundary, not a wall-timer latency SLA.
