# Coordinate concurrent pipeline runs (POE-005)

## Failure and intended behavior

Two runs can select the same open task before either records completion. Runs
targeting different tasks can also overwrite one another's status updates.

Coordinate execution per canonical plan path using the injected filesystem, not
an in-process map or filesystem-object identity. Use optional filesystem realpath
support to coordinate directory aliases, falling back to normalized absolute
paths for minimal custom adapters. Keep long-lived run locks under the runtime
temporary directory so they do not dirty an agent's checkout or depend on caller
home/log-directory settings. Hold the run lock from initial
plan inspection through setup, task execution, teardown, and archiving. A waiting
run must read the current plan after acquiring ownership. Different plans remain
independent. Explicit paths that disappear while waiting still report a missing
plan; this change does not invent a completed result for a removed document.

Protect the public status writer's complete read-modify-write transaction with a
separate per-plan lock. Runs may hold execution ownership while taking short
status locks, without blocking independent status updates for the entire agent
execution. Retain the existing atomic temporary-file replacement and document
formatting behavior.

## Lock lifecycle

- Use exclusive filesystem creation so separate clients/processes coordinate.
- Bound contention waits to 30 seconds and report the plan and lock path.
- Honor cancellation while waiting and after acquisition, before agent work.
- Release ownership on every normal result, callback error, agent exception,
  cancellation, and persistence failure.
- Preserve both operation and release errors if both fail.
- Do not automatically expire or delete another run's lock. After an abrupt
  process exit, an abandoned lock may be removed only after confirming that no
  pipeline operation using that plan is active.

## Verification and delivery

Add failing SDK/core concurrency tests and direct writer transaction tests with
memfs and deferred agents/writes. Validate fresh reads, same-task deduplication,
distinct-task completion, independent plans, phase coverage, cancellation,
bounded waiting, and ownership cleanup. Run the normal build, focused and root
tests, strict type checks, compiled public-SDK checks on local supported Node
versions, controlled two-process probes, and CLI screenshot QA sequentially with
build-dependent tests. Commit only this finding with normal hooks and report
publication separately from the existing shared native prerequisite blocker.
