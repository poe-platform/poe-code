# Parallel result checking

`createSpawnParallel(spawnOnce)` constructs the parallel scheduler used by SDK
spawn helpers. Its options are:

| Option | Default | Behavior |
| --- | --- | --- |
| `maxConcurrent` | `4` | Positive integer limiting concurrent calls. |
| `failFast` | `true` | Stop scheduling and cancel siblings after a thrown failure or checked nonzero result. |
| `check` | The effective `failFast` value | When true, reject nonzero results with `SpawnParallelError`. Must be a boolean when supplied. |
| `signal` | None | Parent cancellation, forwarded alongside each tuple's optional signal. |

`check: false` returns nonzero results without treating them as exceptions.
Transport and event-stream failures still reject. `check: true, failFast: false`
waits for all calls before checking results. The first nonzero result in input
order becomes a `SpawnParallelError` containing `index`, `result`, and `results`.
Fast-failure arrays may have holes; delayed checking has every returned result.
The error's `result` is the same object as `results[index]`.

With `failFast: false`, thrown failures are collected in `AggregateError.errors`
and take precedence over nonzero result checking. A pre-aborted parent prevents
calls from starting. Forwarded signals preserve the original cancellation reason.
Empty call lists return an empty array after validating scheduling/check options.

SafeJS deliberately overrides this scheduler's historical checking default with
`check: false`; this does not change the default of other SDK consumers. There
are no environment variables for parallel result checking.
