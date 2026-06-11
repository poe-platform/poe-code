# Agent Script Can Finish Before Queued Promise Reactions Run

## Provenance

- [Bun #122](https://github.com/oven-sh/bun/issues/122)
- [Bun #127](https://github.com/oven-sh/bun/issues/127)
- [Bun #5220](https://github.com/oven-sh/bun/issues/5220)

## Problem

Promise reactions scheduled with `.then()`, `.catch()`, or `.finally()` use the
interpreter's internal microtask queue. That queue is drained while evaluating
an explicit `await`, but normal root completion returns without a final
microtask checkpoint. Lint permits a handled `.then()` expression statement, so
valid code can silently lose its final reaction.

Relevant paths:

- `packages/agent-script/src/interp/promise.ts`
- `packages/agent-script/src/interp/interpreter.ts`
- `packages/agent-script/src/interp/async.ts`
- `packages/agent-script/src/run.ts`

## Reproduction

```js
const events = [];
Promise.resolve("done").then((value) => events.push(value));
return events;
```

Expected: `returnValue` is `["done"]`.

Current static control-flow validation indicates the run returns `[]` because no
later `await` drains the queued reaction.

## Required Behavior

- Perform a final microtask checkpoint before successful interpreter completion.
- Drain chained reactions until the queue is empty.
- Surface a rejection produced by a final reaction instead of returning success.
- Preserve budget accounting, cancellation, snapshots, and deterministic order.

## TDD

Add failing tests first for a final fulfilled `.then()` side effect, a chained
reaction, and a final reaction that throws. Existing tests that add explicit
`await Promise.resolve()` calls do not cover this boundary.
