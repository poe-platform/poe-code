# Atomic replay timing investigation

The isolated full-package run 19850 failed the pending atomic replay test with
`Atomic replay stalled`; the error comes from a test-local 100 ms Promise race,
not from the runtime's atomic wait state machine. Focused repeat 58753 passed
all tests in that file. This does not by itself establish either a runtime hang
or a harmless timeout.

A read-only built-runtime probe (53978) used the same pending host-gate source,
public pending dump, original notification, and replay notification. All five
iterations returned `[1, "ok"]` for both original and replay. Replay wall times
were 125.07, 86.36, 66.98, 68.65 and 65.11 ms. Worker registration acknowledgement
took 25.76–29.85 ms; termination took 1.62–2.50 ms. Process CPU totals include
worker/JIT threads and must not be equated to wall time.

The first correct replay exceeded the custom guard without stalling. This
validates a false-positive timing possibility; it does not prove that every
reported stall has that cause or that the runtime cannot hang. The probe used
the rebuilt isolated prototype-origin candidate, not the uncommitted weak
reference integration. Runtime, fixture, budgets and the 100 ms guard remain
unchanged.

Existing `atomic-wait.test.ts` controls worker registration/settlement and
cleanup through mocked worker messages. `globals/atomics-wait-disposal.test.ts`
separately verifies actual worker disposal and preservation of unrelated native
waiters. Before revising the replay unit test, determine which protocol
boundaries can be controlled deterministically while retaining the pending
checkpoint and notification assertions. Do not replace it with a canned replay
result, merely increase a timeout, or claim a runtime fix from warm-run timing.

The current replay test also lacks a cancellation handle for the replay promise
if its observation guard rejects. Any revised harness must await cleanup of
both original and replay runs on failure. That source observation is a test
cleanup concern, not proof of a production resource leak.

## Deterministic replay unit test

The pending replay case is moved into the existing mocked-worker protocol suite.
It still executes the original guest source, public pending dump, original
notification and replay notification. The mocked transport acknowledges each
registration only when the test permits it. Native `Atomics.waitAsync` and
`Atomics.notify` supply the actual shared-memory wait and notification results;
no canned replay result or mocked notify count is used.

The test additionally verifies that replay does not call the re-issued host gate
before worker registration, that each worker terminates once, and that no native
wait remains afterward. Both runs are aborted and awaited in failure cleanup,
and native waits are notified and settled. The private 100 ms wall-clock race is
removed with the old case, not increased. The maintained test-runner timeout is
unchanged. Real-worker timeout, FIFO notification, byte-location, completed
replay and disposal tests remain in their existing files.

The new controlled-worker case and existing protocol tests passed all nine cases
(70442), 121 ms total test time. No production runtime change is involved.
The combined native-worker, protocol and snapshot selection passed all 35 tests
in both the main tree (5845) and the isolated prototype-origin candidate (23253).
The latter excludes pending weak-reference work. Scoped lint passed for the
two changed test files (67892). The full package gate still needs a rerun after
this change and the independently committed legacy-parser comparator repair.
