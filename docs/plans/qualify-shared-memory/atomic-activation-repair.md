# Owned atomic-wait restoration

Product contract owner: qualify-shared-memory. Source inspected on local main
`e044be891151cf6f4b3ff20eaaf8838b687e3869`, Node 22.23.2 / ICU 78.2.

Two fast ownership regressions first failed (1.89 s): activation without a run
resource owner succeeded, and a second owner accepted an activation whose original
owner had already disposed. The repair requires a live owner for pending waits,
binds activation to it, and preserves same-owner idempotence. An unowned rejected
attempt does not consume the activation opportunity. Combined ownership, native
FIFO/cancellation/remaining-time and controlled public replay checks passed 27
cases after the repair (2.74 s).

An independent worker-schedule regression then failed (1.87 s): a store after
restore's load but before registration caused activation to succeed and produce
a `not-equal` settlement. The original already-registered waiter remains queued
after the same store. ECMA-262 edition 16 DoWait separates initial comparison
failure (step 20) from queue insertion (step 28); recreating the former is not
restoring the latter. The repair explicitly rejects this observed race. The
race, ownership, and existing continuation selection passed 19 cases (2.35 s).

Reproduce with:

```sh
npx vitest run packages/safe-js/src/snapshot/atomic-wait-race.test.ts packages/safe-js/src/snapshot/atomic-wait-ownership.test.ts packages/safe-js/src/snapshot/atomic-wait-continuation.test.ts packages/safe-js/src/interp/atomic-wait.test.ts
```

The worker schedule delegates actual comparison/notification to native Atomics;
it does not use a wall-clock race or replace successful wait results with canned
answers. Owners must still dispose their scopes on failure. This does not claim
capture of arbitrary concurrent histories, external waiter queues, or transfer
between owners. Public replay and low-level reconstruction remain distinct.
See `qualification.md` for commands, retained red/green receipts, the independently
reproduced unrecorded host-write defect, and the incomplete task disposition.
