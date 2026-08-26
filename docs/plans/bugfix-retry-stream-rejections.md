# Retry stream rejection ownership

## Scope

Only `packages/agent-spawn/src/retry.ts`, new
`packages/agent-spawn/src/retry.test.ts`, and this document.
No queue sentinel fix, README edits, commits, pushes, or release actions.

## Plan

1. Add deferred-promise regressions before changing production code.
2. Observe attempt result and event forwarding concurrently with `Promise.all`.
3. Verify rejection ownership, unchanged success behavior, and package tests.

## Behavior

Sequential awaits left event-forwarding rejections unobserved while the result
was pending or after it rejected. Both promises now have rejection handlers
immediately. Either failure rejects both public channels without retrying;
later failure of the other promise remains observed. Success still waits for
both channels and preserves result identity and attempt-prefixed events.

Tests use deferred promises and `setImmediate` event-loop checkpoints, not sleeps,
child processes, filesystem writes, or LLM calls. Both public rejection channels
are handled before triggering failure. Vitest's unhandled-error detection remains
enabled, including for the late stream rejection regression.

## TDD evidence

- Red: `npx vitest run packages/agent-spawn/src/retry.test.ts --reporter=verbose`
  before the patch exited 1: one failed assertion, three passing tests, and two
  unhandled rejections. The pending-result case had no public rejection callback;
  the result-first case produced an orphaned late stream rejection. Test time: 5 ms.
- Green: the same command after the patch exited 0: four passing tests, no
  unhandled errors. Test time: 3 ms.
- Package validation: `npm run test:unit --workspace=@poe-code/agent-spawn`
  exited 0: 505 tests across 22 files passed, no unhandled errors.
- Static validation passed:
  `npx eslint packages/agent-spawn/src/retry.ts packages/agent-spawn/src/retry.test.ts`,
  `npm run lint:types`,
  `npx prettier --check packages/agent-spawn/src/retry.ts packages/agent-spawn/src/retry.test.ts docs/plans/bugfix-retry-stream-rejections.md`,
  and `git diff --check`.

No CLI presentation changes; screenshot validation is not applicable.
