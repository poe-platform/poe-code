# Bugfix 665: bounded brace-reservation bookkeeping

## Scope and evidence

Own only `packages/safe-bash/src/shell/brace-expansion.ts`,
`packages/safe-bash/src/shell/value-state.ts`, dedicated tests, and this plan.
Root owns inventory registration, Git, builds, lint, and integration.

The bounded current-source witness for literal `{a}` repeated 8, 32, and 128
times retains 82, 322, and 1,282 arena records while yielding the unchanged word.
Charges are respectively 3,008, 11,648, and 46,208 bytes. Cleanup releases all
records; this is bookkeeping amplification, not a demonstrated leak. Reported
OOM ratios and host-memory thresholds remain unverified.

## Implementation

- Add scope-owned cumulative byte reservation with one enrollment record and
  one growing payload record, independent of admission count.
- Admit each increment before mutation or allocation, using the existing arena
  capacity and cancellation checks. Keep ordinary independently releasable and
  committable reservations unchanged.
- Use cumulative reservations for both brace parsing and per-result
  materialization. Preserve every existing byte charge, parse admission, field
  limit, yield checkpoint, and generator `finally` cleanup.
- Do not modify runtime callers, public contracts, defaults, or other issues.

## TDD and verification

1. Add failing bounded tests for constant record counts and cumulative scope
   reservations, including the existing literal witnesses.
2. Cover exact byte/parse boundaries, refusal before slicing, independent scope
   ownership, invalid growth, cancellation, early iterator return, and failure
   cleanup.
3. Run the dedicated tests RED, implement, then rerun GREEN with adjacent
   value-state and brace-expansion tests only, using the assigned Node 22
   toolchain, cache-disabled tsx, unset `NO_COLOR`, and the assigned `TMPDIR`.
4. Report exact files and results to root; leave inventory and broader gates to
   root, then freeze the owned files.

## Completed evidence — September 8, 2026

- The apparent loader failure was not an import failure: direct execution loaded
  both files and exposed their assertions. Process-isolated execution inside the
  sandbox initially reported only file-level failures. Before product edits, the
  maintained reporting runner with `--experimental-test-isolation=none` ran all
  16 dedicated tests: five passed and 11 failed. The three literal witnesses
  failed with actual allocation counts 82, 322, and 1,282 versus two expected;
  nested/materialized bookkeeping checks and the not-yet-added API also failed.
- Added `ValueScope.reserveBytes` and guarded `ValueArena.grow`. Each scope keeps
  its existing enrollment plus one cumulative payload record, without a closure
  per increment. Ordinary reservation release/commit behavior is unchanged.
- Converted all brace admission and materialization scratch reservations without
  changing their byte expressions, parse admissions, or cleanup boundaries.
  The dedicated run is now 16/16 GREEN. Literal witnesses retain two records at
  every tested size, with the same 3,008/11,648/46,208-byte charges and unchanged
  output. Exact byte/parse boundaries, pre-slice refusal, cancellation identity,
  early iterator return, and cleanup tests pass.
- The standard maintained runner passed all 144 tests across the five files
  below, with no failures, skips, or cancellations. The first sandboxed adjacent
  attempt denied the native Bash oracle with `spawnSync /bin/bash EPERM`; the
  same command passed with execution approval, without changing test logic.

Run from `packages/safe-bash` with the assigned toolchain on `PATH`,
`TSX_DISABLE_CACHE=1`, unset `NO_COLOR`, and the assigned `TMPDIR`:

```sh
node scripts/test-reporting.mjs --import tsx --test-concurrency=1 \
  tests/shell/brace-reservations.test.ts \
  tests/shell/value-scope-reservations.test.ts \
  tests/shell/value-state.test.ts \
  tests/shell/brace-expansion.test.ts \
  tests/shell/brace-expansion-differential.test.ts
```

Root must register the two new dedicated test paths in the maintained inventory.
No runtime.ts, README, inventory, Git, build, lint, or full-suite changes/runs are
part of this fix. No reported OOM ratios or heap thresholds are claimed verified.
