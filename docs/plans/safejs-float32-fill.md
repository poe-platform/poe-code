---
title: Float32Array fill
---

# Float32Array fill

Code inspection lists set, slice and subarray, plus join and iterators, but not
fill. After the active buffer-budget qualification is complete, reproduce this
gap against native execution before implementing it as a separate improvement.

Use the published [ECMAScript 2026 typed-array fill algorithm](https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-%typedarray%.prototype.fill),
not just an older engine oracle. It validates the receiver before coercion,
coerces the value before bounds, checks bounds again after callbacks even for an
empty range, clamps the final end to the current view length, and returns the
receiver. Preserve float rounding, NaN and signed zero, guest getter coercion,
retained receiver storage, step budgets and snapshot/direct-call behavior.

Do not mutate production code or add new test membership during the active full
unit run for buffer-capacity budgets. Focused RED cases should cover basic fill,
negative bounds, value/bound coercion order, grow/shrink callbacks, detached or
out-of-bounds storage, and return identity before implementation starts.

After the budget full suite and lint/types finished, seven native comparisons
ran: six failed because fill is absent, while the expected-TypeError case passed
coincidentally. No fill implementation change yet. RED evidence:
`/tmp/poe-safejs-float32-fill-red.log` (1.27 seconds). This test file was added
after the budget full-suite run and is not part of its passing test claim.

Implemented fill using guest numeric coercion, initial bounds, post-callback view
validation, per-write step charges and retained receiver/arguments. One initial
native comparison exposed a Node 22 quirk: it fills a suffix grown during value
coercion. Published ECMAScript 2026 captures length first, and native Node 24.14.0
agrees with the implementation's [7,7,0,0] result. That control now asserts the
standard directly instead of changing correct behavior to match the old engine.

Added invalid inputs, offsets, subclass identity, direct getter calls, detached
storage, snapshot round-trips, step limits and retention success/failure coverage.

The initial broader run found a test fixture whose empty argument never invoked
the detachment hook. Corrected the test to supply an actual valueOf closure; no
production change was needed. Final 20 fill tests and all other Float32/buffer
tests passed: 321 tests across 24 files in 12.98 seconds. Log:
`/tmp/poe-safejs-float32-fill-broad-qualified.log`. Native Node 24.14.0 also
confirmed value/start/end callback order before an out-of-bounds error.

Scoped TypeScript and ESLint passed. Real harness passed after 70 uncached build
tasks (58.677 seconds); inspected `screenshots/harness-run-docs-plans-safejs-float32-fill.md.png`:
clean pass, expected fields, zero spawns. Native Node 18.18.0 also passed basic
fill mutation and return identity via the rebuilt run API.

Buffer-budget scoped release is verified: @poe-platform/safe-js@0.1.323,
run 34097334741, receipt 2026-09-07T07:52:49.6557794Z. CLI run 34097334943
is still active. Latest actual CLI publication remains poe-code@14.0.84.
