# Parallel falsy failure preservation

## Scope and plan

- Modify only this document, `packages/agent-spawn/src/parallel.ts`, and
  `packages/agent-spawn/src/parallel.test.ts`; do not commit or push.
- Add deterministic regressions for `undefined`, `null`, `false`, `0`, `''`,
  `NaN`, `0n`, and `-0` through result rejection, synchronous throw, and event
  stream rejection, using both thunks and tuples.
- Verify the exact first reason survives a peer's abort rejection, queued calls
  do not launch, and `failFast: false` aggregates all reasons while continuing.
- Run the focused suite before implementation, replace ambiguous failure state
  with an explicit presence representation, then rerun the suite.

## Root cause

`primaryFailure` stores an arbitrary rejection reason, but truthiness checks
mistake falsy reasons for success, returning sparse result arrays. Nullish
assignment also lets later abort errors overwrite `undefined` or `null`.
The aborted group already prevents queued thunks from actually launching.

## Evidence

Command used for both runs:

```sh
npm run test:unit -- packages/agent-spawn/src/parallel.test.ts --no-cache
```

- Red, before implementation: exit 1; 56 failed, 13 passed (69 total), 973 ms
  overall and 91 ms in tests. All 48 thunk/tuple failure-path cases failed by
  resolving sparse arrays. Eight peer-abort cases failed: `undefined` and `null`
  were replaced by `AbortError`; the other six reasons resolved sparse arrays.
- Green, after implementation: exit 0; 69 passed, 958 ms overall and 85 ms in
  tests. This includes the 10 existing tests and 59 new regressions; the three
  aggregation cases also passed before the fix.
- New regressions use settled promises and abort listeners, without sleeps,
  filesystem writes, or LLM calls. Exact fail-fast reasons use `toBe`, preserving
  `NaN` and distinguishing `-0` from `0`.
- `git diff --check`: exit 0.

## Resolution

`primaryFailure` now holds either `undefined` (no failure) or `{ reason }`.
Presence checks and first-write assignment operate on that wrapper, while the
final rejection throws its unchanged reason. Abort propagation, aggregation,
and result ordering retain their existing behavior. No CLI presentation changes
or screenshots are required. No commit or push was performed.
