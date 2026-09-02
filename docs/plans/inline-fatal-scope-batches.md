# Inline-input fatal-scope batches

## Scope and execution profile

- Change only the existing inline-input fatal-scope test and this document.
- Preserve all 30 script fixtures, original leaf names and assertions. Four
  expansion/operator groups contain six cases each; the six nested-environment
  cases form the fifth group. Node reports 35 tests including five batch parents.
- Use the existing, unchanged `runVirtualBatch` helper. Await every batch and every
  named subtest serially; no concurrency flags, production code or shared helpers
  change. A rejected outcome fails its original named leaf. A shared execution
  refusal fails all six affected leaves, without retry or fallback.
- This is an explicitly batch-scoped authentication/process-isolation profile:
  30 isolated children and 60 fresh source censuses become five isolated children
  and 10 fresh censuses. It does not preserve per-case source-observation windows
  or module/process isolation. Before/after batch source hashes remain diagnostic.
- Each row still creates a fresh Shell, registry and MemoryFileSystem, disposes
  its Shell, and retires its independent watchdog before advancing. All 30 native
  watchdogs remain. Existing 3500 ms row cancellation, 4000 ms cooperative and
  4500 ms independent watchdogs remain; the 5000 ms outer process deadline and
  1 MiB combined output ceiling now apply to the entire six-case batch. Thus later
  rows have less remaining outer time, not an extended deadline.
- Only pure virtual scripts are enrolled. The external-command cat case uses
  the virtual registry, not a native process. No probe, custom host callback,
  process/global/prototype mutation or native-liveness case joins these batches.

## Qualification

Runtime captures confirm fixed revision
`ac45cacfbf10ef1f2895f3c3f31c460f21007a7e`. The candidate test is a separately hashed,
uncommitted patch atop that revision, not a committed-candidate proof.
Measurements use Node 22.23.2 on Darwin arm64 after the parent's September 1,
2026, 22:18 CDT co-load boundary.
No Git mutation, installation, shared-helper change or full-suite run is part of
this work. Temporary qualification artifacts remain outside normal discovery at
`/tmp/poe-inline-fatal-batches-20260902.6fe8g9/`.

- Structural TDD: the original passes fixture/name parity and fails four new
  batching/failure-attribution checks; the candidate passes all five. These are
  mocked structural controls, not runtime evidence. An initial harness-only
  default-import interop defect was corrected before the valid red run; both logs
  are retained.
- Current original route: 30/30 pass; 20.153599 s wall, 20.107896 s isolated worker.
- ABBA wall seconds: A1 20.318358, B1 3.986994, B2 3.725061, A2 19.851155.
  Mean A 20.084756 s versus B 3.856027 s: 16.228729 s saved (80.8%). All 30 original
  cases pass in each run. Original children number 30; candidate children number
  five, each carrying six fixtures, with no child overlap or surviving PID/group.
  This sequence ran 22:18:26–22:19:15 CDT, before the parent's 22:23 small control
  job. That job does not overlap the measured pair.
- ABBA uses symmetric temporary entry-source substitution at the original test
  URL, with source maps; production imports and child arguments remain original.
  It is not a compiler integration. Fresh source checks before/after each sample
  and separate helper/test/build-input hashes pass at the same revision.
- Reverse batch and row order: all 30 leaves pass in 4.523562 s. The second B run
  provides a fresh-process repetition, not reused results.
- Intentional wrong-observation and real maxCommands=0 rejection each fail only
  the original brace-group leaf and its enclosing parent; all other 29 leaves
  pass. The wrong-observation stack points to the actual assertion at line 32 of
  the original test path, and identifies the named leaf. Neither failure is retried.
- Complete fixture and observation comparison passes across both A runs, both B
  runs and reverse order: 150 observations, including stdout/stderr text and raw
  base64, status and complete VFS snapshots. Reverse order is checked exactly,
  not normalized into a weaker unordered comparison.
- The applied ordinary tsx route, without temporary source substitution or spawn
  instrumentation, passes all 30 leaves / 35 Node tests: 4.104173 s wall,
  4.043077 s worker, with stable source and unchanged helper bindings. This ran
  22:22:53–22:22:58 CDT and is separate confirmation, not part of the ABBA mean.
- All 14 existing `tests/shell-stress/process.test.ts` tests pass: fresh censuses,
  empty/oversized refusal, source drift, timeout/stderr/truncated/reordered outcome
  refusal, fresh Shell/FS/raw bytes, synchronous-loop kill, native no-write pipeline
  deadline, output ceiling and descendant cleanup. No control file changes.
- The instrumented late-signal control passes in 4.551486 s. It deliberately
  retains earlier signals, without changing their timers, while row five runs a
  supported virtual busy loop. Earlier rows' signals really expire during row
  five; row five's own 3500 ms signal also expires before its rejection/retirement.
  Row six then succeeds with fresh state. All six watchdogs retire serially;
  the child and process group disappear, leaving only two standard PipeWrap
  resources at child exit. The unchanged 5000 ms outer bound is retained.
  Two invalid probe versions are preserved, not counted as passes: an unescaped
  shell variable prevented launch; a subsequent sleep-based probe did not create
  lateness because sleep is absent from this minimal standard registry. The
  qualified probe uses the supported busy loop, not a changed registry or deadline.
- Scoped ESLint and strict, no-emit TypeScript checks pass with empty diagnostics.
  Typechecking starts from the changed test with the package's strict flags; it
  is not a full-workspace typecheck.

## Evidence and reproduction

All paths below are relative to the temporary artifact directory above:

- `runtime-MoewbD/`: baseline, ABBA, reverse and intentional-failure runs, with
  exact commands, source/tool hashes, TAP, raw events, per-file/per-case profiles,
  child requests/results and `comparison.json`. Candidate leaf durations measure
  assertions only; shared execution time belongs to the batch parent, not each leaf.
- `applied-vdCJgj/` and `applied-DY2mRs/`: ordinary applied test and unchanged
  helper controls, including commands, source checks and profiles.
- `late-qOIIGd/`: qualified signal/watchdog trace and complete observations.
- `tdd-red-corrected-harness.log`, `tdd-green.log`, `eslint.log`, `typecheck.log`:
  structural TDD and scoped static checks. Initial invalid harness/probe logs
  remain beside the qualifying evidence rather than being overwritten.

From `packages/safe-bash`, the ordinary focused commands are:

```sh
node --import tsx --test --test-concurrency=1 tests/shell/inline-input-fatal-scope.test.ts
node --import tsx --test --test-concurrency=1 tests/shell-stress/process.test.ts
```

Original test SHA-256:
`6170e81d762a6d2069f375157288ffe67c5c32fa8d3026d4108a2ccd5b8ddf5a`.
Applied test SHA-256:
`33c754438d16813caafcd22dc44b1349ca39bfa08b23bee99b3580ca844908a9`.

## Limits

The batching authorization changes observation boundaries. A transient source
mutation wholly inside a batch may escape its endpoint checks; module-level state
is shared by its six rows. Repeat/reverse and adversarial-signal controls bound
specific risks but do not establish arbitrary shared-process equivalence. Local
timings are not a CI guarantee, a full-suite result or proof of a stable global
15-minute target. No existing negative control is removed or weakened.
