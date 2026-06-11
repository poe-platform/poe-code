# Agent Script Does Not Own Detached Promise Rejections

## Provenance

- [Bun #953](https://github.com/oven-sh/bun/issues/953)
- [Bun #970](https://github.com/oven-sh/bun/issues/970)
- [Bun #14624](https://github.com/oven-sh/bun/issues/14624)

## Problem

`run()` checks a rejected promise only when that promise is the script's final
return value. A rejected async call whose promise is discarded can let the run
resolve successfully. Validators also reproduced the rejection escaping to the
host's `unhandledRejection` event.

This is distinct from the final-microtask-checkpoint bug: draining reactions is
not sufficient unless the run tracks which sandbox promises remain unhandled.

## Reproduction

```js
const fail = async () => {
  throw "boom";
};

fail();
return "completed";
```

Expected: `run()` rejects with `UnhandledRejectionError` whose reason is
`"boom"`.

Current: static inspection and validator reproduction show that `run()` can
return `"completed"`; async-function rejection may leak to the host runtime.

## Required Behavior

- Register sandbox promises created during a run.
- Mark promises handled when awaited, returned, or connected to a consuming
  rejection handler.
- At deterministic checkpoints and final completion, surface rejected unhandled
  promises as `UnhandledRejectionError`.
- Never emit a host-level `unhandledRejection` for sandbox-owned promises.
- Preserve normal recovery through `.catch()` and Promise combinators.

## TDD

Add failing public `run()` tests for a discarded rejected async call, a handled
discarded rejection, a rejection handled in a later microtask, and multiple
detached rejections with deterministic selection/reporting.
