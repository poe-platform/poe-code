# Issue 660: describe the checkpoint elapsed-time limit

## Scope

Replace only the existing maxCpuMs description cell in
`packages/safe-bash/README.md:292`: elapsed time includes waits, enforcement is
checkpoint-based, and this is neither CPU accounting nor preemptive enforcement.
Keep the API name, 30-second default, and runtime behavior unchanged. No new
README sections, options, or examples; no CPU-meter implementation or API rename.

## Validation completed on 2026-09-08

- The budget records its start at `packages/safe-bash/src/shell/runtime.ts:122`
  and compares elapsed time at `packages/safe-bash/src/shell/runtime.ts:154`.
  `packages/safe-bash/src/contracts/yield.ts:11` uses performance.now with a
  Date.now fallback, not a CPU-consumption meter.
- Ran inline assertions against Shell source with Node 22.22.0,
  MemoryFileSystem, mocked performance.now and node:test Date/setTimeout timers,
  disabled TSX caching, unset NO_COLOR, and the requested validation TMPDIR.
  All times below are simulated; no real one-second sleeps or artifact writes.
- With maxCpuMs 200 and maxWallClockMs 5000, actual `sleep 1; echo done` remained
  pending and unaborted at 201 ms, then rejected with maxCpuMs at 1000 ms.
- Actual `cat | wc -c` with gated asynchronous stdin rejected with maxCpuMs after
  a simulated 1000 ms input wait under the same limits.
- The maxWallClockMs 200 control interrupted sleep at 200 ms. A direct Budget
  checkpoint passed at exactly 200 ms and failed with maxCpuMs at 201 ms before
  an overdue wall timer was dispatched. Assertions passed.
- Checkpoint enforcement and wall timers are complementary, not identical:
  see `packages/safe-bash/src/shell/runtime.ts:128` and
  `packages/safe-bash/src/contracts/yield.ts:31`. The evidence warrants honest
  nomenclature, not removal of either mechanism or a new isolation guarantee.

## Delivery

Only the existing README cell and this validation note are changed for 660.
Root owns review, atomic documentation commits, delivery, and issue closure.
No Git, build, lint, or broad tests were run for this documentation patch.
