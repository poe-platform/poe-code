# Bound array measurement without materializing own-key lists

## Evidence and scope

- September 9, 2026: investigate the unchanged 600,000-element spread regression
  that timed out in remote release 34312551079. Preserve the original failure,
  native host-overflow proof, all values/output assertions and five-second limit.
- Profiling the actual Vitest-transformed regression with a bounded forked
  worker records about 883 ms of self-time in `measureSandboxData`'s visitor and
  414 ms in garbage collection. Profile directory receipt:
  `/tmp/kamilio-spread-vitest-cpu-directory.txt`; execution log:
  `/tmp/kamilio-spread-vitest-cpu.log`. The normal maintained pool stays unchanged.
- This atomic change covers only `src/interp/values.ts` and
  `src/interp/array-index-capture.test.ts`. Synchronous push-write handling is a
  separate improvement, documented in `safejs-push-sync-writes-20260909.md`.

## Withdrawn experiment

- Independent review and the complete maintained package unit route exposed a
  regression in the existing sparse-array work invariant: a 2,048-length array
  with one occupied index incurred 2,048 descriptor reads instead of one.
  The full run exited 1 with exactly this failure, 21,654 passes and 37 skips;
  `/tmp/kamilio-spread-repair-package-unit.log` retains the failure. Scoped lint
  and types passed, but do not override this failed correctness/work gate.
- Withdraw the two-line measurement shortcut and its two experimental tests.
  Preserve the original sparse-array test without reducing its requirement.
  The following records describe the rejected candidate, not current behavior
  or a validated performance improvement. Independent review evidence remains
  in `/tmp/array-allocation-review-20260909.json`.

- Unmanaged arrays of at most 1,000,000 indices use direct own-descriptor capture
  instead of retaining an intermediate own-key list. That is a finite scan
  ceiling, not a data-budget waiver. Larger ordinary sparse arrays retain the
  key-based route, so huge sparse lengths do not become enormous index scans.
  Managed descriptor accounting is unchanged. Proxy arrays retain their existing
  index-lookup semantics, including traps that hide indices from ownKeys.
- Capture values before visiting retained callbacks. Never execute accessors;
  retain raw descriptor values. Numeric values contribute no data units and need
  not be retained in the capture array. Preserve array-length, key, symbol,
  nested-object, accessor-closure and prototype charges.
- Added a failing allocation regression proving the old code materializes an
  own-key list for a bounded ordinary array, plus a passing-before-and-after
  control where a retained callback mutates a later index. The latter preserves
  the original captured value and exact 11-unit accounting.
- Red: `/tmp/kamilio-remote-spread-key-lists-red.log`. Green:
  `/tmp/kamilio-remote-spread-key-lists-green.log`, 19 selected checks pass,
  including managed descriptors, non-enumerable/numeric-looking keys, the last
  possible array index, spread budgets and the unchanged 600,000-element fixture.
  That fixture measured 1,860 ms in this local sample, versus the original
  2,482 ms. Cohost variation and profiling/pool differences prevent treating
  these samples as a benchmark guarantee or a successful CI release.

## Historical gate launch

- Independent descriptor/proxy/accounting review and complete maintained SafeJS
  validation were pending at this checkpoint. Scoped ESLint, package types and the native npm
  pretest:unit/test:unit route ran under supported Node 22.23.2, with
  before/after hashes for all four files in the combined two-change candidate.
  Receipts use the `/tmp/kamilio-spread-repair-` prefix.
- No fixture or timeout has been reduced, no accounting has been intentionally
  relaxed, and no remote delivery or publication recovery is claimed.
