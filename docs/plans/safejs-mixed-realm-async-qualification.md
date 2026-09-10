# Mixed-realm async qualification

## Scope

Following generator realm restoration, test the existing implementation rather
than assume async continuations require another fix.

The mixed-realm matrix now includes three async generators yielding array,
object and RegExp literals. Each generator is captured before first execution,
advanced after restoration, then recaptured while suspended and advanced again.
Assertions compare each result's actual sandbox prototype with that realm's
exported prototype, not merely its shape or contents.

Three further cases create async functions already waiting on unresolved guest
promises. A restored closure resolves the promise and awaits the function result.
Both originating realms must preserve their literal prototypes. A second
checkpoint also verifies the settled result graph.

## Evidence

The initial async-generator matrix passed all 21 tests on the unchanged runtime.
The expanded 24-case matrix initially passed its resumed-value assertions but
failed three immediate recaptures on both Node 22.23.2 and Node 18.20.8: the
promise reaction had not finished cleanup, so capture correctly reported
`SnapshotNotReadyError`. The test now yields one event-loop turn before
recapture to let queued microtasks finish. This is not a runtime change or an
increase to test timeouts.

The corrected matrix passes 22 cases and fails two on both runtimes. Object and
RegExp results have the correct prototype after resuming the pending async
function, but lose it after recapturing the settled graph (first realm, round 1).
The array control passes. A focused rerun confirms those exact two identity
failures, rather than an active-reaction error.

`captureObjectState` currently serializes prototype links only when
`hasExplicitSandboxPrototype` is true. Default-origin preservation through this
path is the next investigation target. No runtime change has been made yet;
the regression tests remain uncommitted and failing. TypeScript and focused
lint passed before the final diagnostic-label change.

These are same-source, low-level snapshot checks. They do not establish arbitrary
mixed-source transport, external host-operation resume correctness, all async
queue/cancellation behavior, or full JavaScript conformance. The full package
gate remains non-green. Pushes and releases remain paused.
