# Retry queue undefined rejection

## Scope and plan

Only `packages/agent-spawn/src/retry.ts`, `packages/agent-spawn/src/retry.test.ts`,
and this document. Leave the committed `Promise.all` fix unchanged. No README
changes, commits, pushes, or release actions.

1. Add fast in-memory regressions before changing queue implementation.
2. Distinguish terminal failure state from its original rejection reason.
3. Run targeted tests, ESLint, typecheck, formatting, and package validation.

## Fix and invariants

The queue used `undefined` for both no failure and a valid rejection reason.
Existing waiters rejected, but subsequent reads waited forever; late producer
events could also enter the failed queue.

Store failure as an optional `{ error: unknown }` record. The record marks terminal
failure even when its error is `undefined`; readers reject with the original error,
not the record. Buffered events still drain before failure. Pushes after failure
are ignored, and existing waiters and new iterators receive the same reason.

## TDD evidence

Command: `npx vitest run packages/agent-spawn/src/retry.test.ts --reporter=verbose`.

- Red, before the production patch: exit 1, four failed and nine passed; 12 ms
  test time. Delayed consumption, buffered-then-failed consumption, and a new
  iterator after an existing waiter rejected all failed to settle. A late producer
  event was incorrectly delivered after failure.
- Green, after the patch: exit 0, all 13 tests passed; 5 ms test time. No unhandled
  errors. Existing concurrency and success tests remain green.
- Controls: `null`, `false`, `0`, empty string, and an `Error` preserve their exact
  rejection reasons. Buffered event order and attempt prefixes are asserted.
- Tests use deferred promises and `setImmediate` settlement checkpoints, not
  timeout waits, child processes, filesystem writes, or LLM calls. Potentially
  hanging reads are observed by callbacks rather than awaited directly.

## Validation

- `npm run test:unit --workspace=@poe-code/agent-spawn`: passed, 514 tests across
  22 files, no unhandled errors.
- `npx eslint packages/agent-spawn/src/retry.ts packages/agent-spawn/src/retry.test.ts`: passed.
- `npm run lint:types`: passed.
- `npx prettier --check packages/agent-spawn/src/retry.ts packages/agent-spawn/src/retry.test.ts docs/plans/bugfix-retry-undefined-failure.md`: passed.
- `git diff --check -- packages/agent-spawn/src/retry.ts packages/agent-spawn/src/retry.test.ts docs/plans/bugfix-retry-undefined-failure.md`: passed.

No CLI presentation changes; screenshot validation is not applicable.
