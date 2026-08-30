# Agent results and failures

Installed consumers import these APIs from `poe-code/safe-js`; the lightweight
runtime is available at `poe-code/safe-js/core`, and `runCli` at
`poe-code/safe-js/cli`. These entrypoints share one runtime and do not require
private workspace dependencies. `poe-safe-js` is the installed stub-runner binary.

`makeAgentModule(spawnAgent, options?)` exposes the same result policy to SDK
callers and SafeJS scripts. `spawn(definition, options)` returns the validated
`{ exitCode, stdout, stderr, summary, durationMs, usage? }` result, including
nonzero exits. An omitted `check` is equivalent to `check: false`.

Use `check: true` when the next step requires success. A nonzero exit then throws
`AgentSpawnError`, whose `result` contains the complete validated child result.
The SDK exports this class. Inside SafeJS, the error has that name and is an
`instanceof Error`; it does not install an additional global constructor.
`check` and the visual `label` are not forwarded to the provider.

Transport failures, invalid provider results, retry-classifier failures, and
cancellation still reject regardless of `check`. Cancellation is not retried.
The SDK preserves explicit cancellation reasons, including non-Error values,
through one-shot calls, retry waits, and parallel signal forwarding.

## Retries

`spawn.retry(definition, options, retryOptions)` applies the retry policy before
the result policy. The same ordering applies to `makeAgentModule`'s
`defaultRetry`. An unchecked call can therefore retry and eventually return a
nonzero result. Checked calls retain the final result in their exception.

`maxAttempts` must be an integer from one through five; `backoffMs` must be
finite and nonnegative. Backoff doubles between attempts, capped at 30 seconds.
The default result classifier retries exit codes 1, 124, 125, and 137. The
default error classifier retries thrown failures except cancellation. Supply
`isRetryable(result)` or `isErrorRetryable(error)` to customize this behavior.
The real harness CLI supplies its own transient-failure classifiers and defaults
to five attempts with a one-second initial delay.

## Parallel groups

`spawn.parallel(calls, options?)` returns results in input order. SafeJS defaults
to `check: false`, `failFast: true`, and `maxConcurrent: 4`. `maxConcurrent` must
be a positive integer. A group `signal` cancels the group; tuple signals are
combined with it without replacing their cancellation reasons.

- `check: true` turns a nonzero result into `SpawnParallelError`, with `index`,
  `result`, and `results`. The failing `result` aliases `results[index]`.
- `failFast: true` stops scheduling and cancels active siblings on a checked
  result or thrown failure. `results` can contain holes for unfinished calls.
- `failFast: false` finishes every call. Group checking then reports the first
  unsuccessful result in input order, with the complete result array.
- A tuple's own `check: true` still rejects inside an unchecked group. With
  `failFast: false`, thrown failures become `AggregateError.errors`; each checked
  child error retains its own `result`.
- If calls throw and other calls return nonzero results, the aggregate thrown
  failures take precedence over group result checking.

The lower-level `@poe-code/agent-spawn` scheduler retains its historical default:
when `check` is omitted, it follows `failFast`. SafeJS explicitly chooses the
unchecked default instead. See `../agent-spawn/PARALLEL.md` for that SDK contract.

## Errors, replay, and output

The harness preserves callable helpers such as `spawn.retry` and
`spawn.parallel` when wrapping modules for durable replay. Checked result data,
nested aggregate errors, aliases, cycles, and original error-constructor identity
survive completed replay and checkpoint/restart. Changing an error's public
`name` does not change its constructor identity.

An uncaught terminal failure retains the last resumable yield checkpoint, not a
new terminal-outcome journal. Resuming can reattempt operations still pending
there under their declared `re-issue` policy. Catch failures and reach another
checkpoint to persist their handled outcomes; use explicit host reconciliation
for non-idempotent effects. The result policy does not promise exactly-once
execution across every possible crash window.

Only explicitly registered error payloads and native aggregate failure lists
are copied. Arbitrary `Error.result` properties and accessors do not grant
capabilities. Error data cannot export functions or promises, and arrays cannot
invoke accessors while being copied. Payloads obey string, array, depth, and
aggregate-data budgets; catching a checked failure cannot bypass those limits.

Snapshots use `jobs-v6`; incompatible earlier snapshots are rejected before
effects, not migrated or silently reinterpreted. See `CHECKPOINT_REPLAY.md`.

Lifecycle `spawn.failed` events include `checked`: true for rejecting failures,
false for returned nonzero results. Group checking is reflected in tuple events.
The CLI renders returned failures as warnings and rejecting failures as errors.
Scripts can catch a checked error and still complete successfully.
