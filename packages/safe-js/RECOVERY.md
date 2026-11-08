# Failure checkpoints and host budgets

`run()` still rejects when a resource limit is exceeded or execution throws.
Sandbox catches, promise handlers, and retries cannot catch fatal budget errors
or raise limits. A failed run never becomes a successful partial result. Resource
cleanup completes before the returned promise settles.

The host can explicitly request a recovery checkpoint after observing failure:

```ts
import { Budget, dump, restore, run } from "@poe-code/safe-js";

const execution = run(source, { bindings, budget: new Budget({ maxSteps: 1000 }) });
try {
  await execution;
} catch (failure) {
  const json = await dump(execution, { onFailure: "checkpoint" });
  const snapshot = restore(JSON.parse(json), { source });
  const recovered = await run(source, {
    bindings,
    snapshot,
    budget: new Budget({ maxSteps: 10000 })
  });
}
```

Keep the original `run()` promise: `.catch()` and `async` wrappers do not preserve
its dump controller. Request this dump after awaiting failure; while active,
`dump()` still requests the next yield checkpoint. `onFailure: "throw"` is the
default; historical data-size-error dumps remain supported, but explicit
`"checkpoint"` works across failure categories.

## Guarantees and boundaries

- Failure snapshots capture the current host-call journal, original inputs,
  random state, and promise replay history, not an older periodic checkpoint.
- Completed journaled operations replay recorded outcomes without reexecution.
  Pure code reexecutes and counts against the new host budget. Unchanged limits
  can fail again. Budgets are never silently raised; supply new deadlines too.
- Ordinary recorded rejections and deterministic throws can recur. Checkpoints
  do not rewrite source or turn errors into successes.
- Pending effects still need their declared reconciliation policy. A write can
  happen before its outcome is durable; this is not a global exactly-once
  guarantee. Idempotent operations may be reissued.
- Cancellation and fatal-budget termination are not ordinary promise replay
  outcomes. Resume with a fresh signal.
- Parse, import, configuration, or input failures can precede checkpoint
  creation. Unregistered returned capabilities, unsupported values, or graph
  depth can prevent serialization. `dump()` rejects instead of substituting
  an older checkpoint with a stale effect ledger.
- Data-depth is an internal safety limit, not a configurable allowance. Raising
  another budget cannot make an unsupported graph serializable.
- Memory checkpoints can survive backend write failure. Warnings do not prove
  durability; handle storage failures separately.

## CLI and SDK parity

`poe-safe-js --snapshot state.json --max-steps 1000 script.ajs` attempts to save
current failure state and still exits unsuccessfully: budget 3, runtime 1,
SIGINT 130. Resume with `--restore state.json` and an explicit larger
`--max-steps` or `--data-size`. Serialization/write failures are reported; an
existing file may be stale and is not silently deleted.

`poe-code harness run run.md --snapshot-path state.json --max-steps 1000` uses
the same core checkpoints. Resume with `--resume` and explicit limits. Both
CLIs expose `--max-steps` and `--data-size`. Paired-harness and legacy SafeJS
harness SDK runners accept `budget: new Budget(...)` for all supported host
limits. Successful paired runs remove their snapshot unless the SDK requests
`preserveSnapshotOnSuccess`.

## Manual QA

Run top-level, synchronous-default, and asynchronous-default throws after a
recorded effect. Restore failed checkpoints repeatedly: the error must recur
without repeating that effect. Include a prior yield to detect stale journals.
Test storage failure and unsupported returned capabilities; neither may present
an older checkpoint as current.

Exercise steps, deadlines, call depth, string length, array length, and data size.
Unchanged budgets must fail; larger explicit limits must complete without
reissuing completed effects. Put failures inside catches and promise handlers;
neither may bypass limits. Include concurrency, SIGINT, pending reconciliation,
actual process termination, installed consumers, and CLI screenshot inspection.
