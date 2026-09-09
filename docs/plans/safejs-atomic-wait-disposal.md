# Atomic waiter disposal

A built-runtime probe creates an infinite `Atomics.waitAsync`, exposes its
managed buffer to a host binding, then aborts the sandbox run. The run rejects
with the requested abort reason, but native `Atomics.notify` afterward reports
one remaining waiter. The probe explicitly notifies that waiter and drains a
turn, so it does not leave an infinite native registration behind.

This proves cancellation ends the guest await without removing its native wait
registration. The new source regression asserts zero remaining registrations
and performs explicit cleanup even on failure. Do not implement disposal by
blindly notifying all waiters: other runs or host agents may share the same byte
location and their waits must remain unaffected. An ownership-preserving cleanup
design is still required.

## Ownership probe and implementation direction

A Node 22.23.2 probe registered one infinite waiter in a worker and another on
the main thread, both at the same shared byte location. After awaiting worker
termination, native notify reported exactly one remaining waiter and the main-
thread wait resolved `ok`. This provides concrete evidence that worker lifetime
can remove owned waits without waking or removing unrelated registrations.
The first probe attempt inherited `--input-type=module` and failed before wait
registration; the corrected probe set explicit worker execution arguments.

Node documents that `worker.terminate()` resolves on worker exit:
https://nodejs.org/api/worker_threads.html#workerterminate

SafeJS already has `withRunResources`, whose cleanup callbacks are awaited after
the run finishes or aborts. A lazily created per-run worker can own native wait
registrations, acknowledge registration before returning the guest wait record,
forward settlement messages, and terminate through this lifecycle. Existing
coercion and bounds checks stay in the guest intrinsic; primitive values and
managed backing storage cross the worker boundary. Snapshot source replay must
recreate waits through the same path, not serialize native worker handles.

Before integration, cover unrelated native waiters, BigInt64Array and offsets,
immediate `not-equal`/zero-timeout results, notification before first guest await,
worker startup/exit failures, cancellation during registration, and repeated run
cleanup. Avoid one worker per waiter and avoid emitting unhandled rejections
when disposal rejects an unobserved settlement promise. SDK calls without a run
lifecycle need an explicit lifetime policy. Startup overhead and the package's
runtime portability also require validation; the probe alone is not a fix.

## Worker-backed implementation in progress

`atomic-wait.ts` now lazily owns one worker per `RunResources` instance. A native
zero-timeout probe handles immediate results without worker startup; actual
pending waits are registered in the worker and acknowledged before the guest
receives its wait record. Settlement messages resolve guest capabilities.
Abort rejects pending registrations and requests termination; run cleanup awaits
termination and releases retained buffer roots and registry accounting. Calls
outside a managed run retain the native direct-call path and its caller-owned
lifetime. No worker or its handles are serialized into snapshots.

Initial wait/disposal/shared-buffer tests pass 37 cases (29653). Expanded tests
confirm cancellation leaves another native wait intact and normal completion
removes an unawaited waiter (62435: nine passes). TypeScript passes after using
the repository's existing reflective access pattern for `Atomics.waitAsync`
(40778). BigInt offset and immediate-result controls are added. Startup/exit,
cancellation-during-registration and budget-failure paths still require mocked
worker tests; this implementation remains uncommitted. The separate full gate
8033 continues against unchanged d9e6c0fe2 inputs, without this worker change.

The expanded real-worker selection passes 41 tests (41999), including BigInt
byte offsets and immediate numeric conversion results. A fake-worker unit suite
adds deterministic registration/settlement ordering, single-worker reuse,
startup and post failure, abort before acknowledgement, unexpected exit, and
cleanup-root checks. Its accounting-failure test initially failed: a budget
exception escaped the worker message handler. Accounting is now checked before
removing the registration, and failure rejects all pending waits through their
promises instead of escaping the event handler. Worker code remains fixed host
code; no guest source is evaluated in the worker.

Combined verification passes 47 tests in four files (82957), package TypeScript
(92222), and scoped ESLint (96022). The maintained selected workspace build is
running before the atomic commit. README now describes run-owned cleanup and
the standalone intrinsic lifetime boundary without claiming deterministic timeout
replay or direct restoration of native waiter continuations.

The selected build passes 23 builds and four fresh-process import checks (54583).
The built-runtime abort probe now reports zero remaining native waiters, whereas
the pre-fix probe reported one. The committed-candidate full gate remains a
separate validation of d9e6c0fe2 and cannot establish a full pass for this change.

Separately, full committed-candidate gate 8033 runs in
`/tmp/safejs-shared-commit.eCW6K7/candidate`, against d9e6c0fe2. All 1,313 tracked
SafeJS source/test files match that commit. The 1,321-file path/content digest,
including eight generated Intl JavaScript/declaration files, is
`bc50c94a8800a2abdb6696aba70e942fb886462e75df90b294ad8efa5d9739fe`.
Vitest aliases resolve workspace packages to that candidate's own sources.
This new disposal regression is main-worktree-only, outside the frozen gate.
