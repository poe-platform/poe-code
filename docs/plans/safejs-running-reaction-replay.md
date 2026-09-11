# Running reaction replay

## Validated failure

CLI workflow 34188819065 failed after the resource-declaration delivery.
Its unit log identified the two-in-flight-promise recovery case in
packages/agent-harness/src/testing/recovery-e2e.test.ts. Local run 5388
reproduced SnapshotNotReadyError during backend serialization, with seven
other recovery cases passing.

The durable guest-heap guard correctly rejects a running reaction. The trusted
in-memory replay classifier, however, checked only missing/unrepresented
continuations, not this explicitly non-durable phase. This allowed a connected
promise graph to enter durable capture even though it required replay.

## Fix and evidence

New focused regression 57268 failed with the same active-reaction error.
Classify pending running reactions as replay-only when traversing their
connected promise component. Keep the existing trusted WeakSet admission and
all untrusted durable-capture guards unchanged.

Run 2473 passed all 13 focused and harness recovery cases after the change.
The new test verifies trusted serialization, component-wide replay metadata
and rejection of an untrusted copied snapshot. Broader snapshot tests, lint,
build and maintained package validation remain before an atomic commit/push.

Writable globals were delivered separately as
c18d71b447a275cbeb1120ca4a2c1adfebbd9ce0, verified on remote main. Its releases
34190350229 (scoped) and 34190350389 (CLI) are running; do not wait for them
before completing this fix.

## Delivery checks

- Snapshot directory: 1,406 tests in 84 files passed (40604).
- Maintained agent-harness unit route: 163 tests in 13 files passed (10976).
- Public dump/restore, completed/failure replay, signal dump and interpreter
  promise replay: 85 tests in six files passed (30734).
- TypeScript and candidate ESLint completed without diagnostics (22363).
- Maintained safe-js build closure passed 23 workspace builds and four
  fresh-process import checks (46817).
- No timeout, fixture or exclusion was changed for this fix. Validation is
  focused on the snapshot classifier and its public persistence consumers;
  it is not represented as a new repository-wide unit run.
