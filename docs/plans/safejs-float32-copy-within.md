---
title: Float32Array copyWithin
---

# Float32Array copyWithin

Candidate next gap after fill: copyWithin is absent from the typed method list.
Reproduce the missing behavior against native execution before implementation.
Use the published [ECMAScript 2026 typed-array copyWithin algorithm](https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-%typedarray%.prototype.copywithin)
for callback ordering and resizing. It captures initial length, converts target,
start and end in that order, then revalidates and shortens a positive copy after
callbacks. Zero-count copies do not perform that second bounds check. Preserve
overlap direction and raw byte encodings, including NaN payloads; do not copy
through floating-point reads/writes that can canonicalize payload bits.

Required coverage: overlap both ways, offset views, guest coercion ordering,
resize/detach callbacks, empty ranges, subclass/return identity, bit preservation,
step budgets, retention and snapshot/direct-call behavior. Keep this separate
from the current fill commit. No implementation or executable RED evidence yet.

Fill is now verified on remote main as 9ca33eeeadd7ff1ede4997e7d258d9e54e98a233.
Six native copyWithin comparisons were added afterward and all failed, covering
overlap directions, negative bounds, offset storage, coercion order and shrink
callbacks. RED log: `/tmp/poe-safejs-float32-copy-within-red.log`. No copyWithin
implementation change yet.

Implemented guest target/start/end coercion against initial length, conditional
post-callback validation and shrink clamping, then budgeted byte copies with the
correct overlap direction. Added 22 passing focused tests covering the original
six comparisons plus bounds, resize, subclass identity, exact NaN payload bytes,
callback detachment for empty/positive copies, direct getter calls, two snapshot
round-trips, retained storage and per-byte step charges. Focused log:
`/tmp/poe-safejs-float32-copy-within-qualified.log` (1.57 seconds).

All Float32/buffer tests passed: 343 tests across 25 files in 14.30 seconds.
Scoped TypeScript and ESLint passed afterward. Broader log:
`/tmp/poe-safejs-float32-copy-within-broad.log`.

Actual harness passed after 70 uncached build tasks (58.071 seconds). Inspected
`screenshots/harness-run-docs-plans-safejs-float32-copy-within.md.png`: clean
pass, expected fields, zero spawns. Native Node 18.18.0 also passed overlapping
copy and return identity via the rebuilt run API.

Fill scoped publication verified: @poe-platform/safe-js@0.1.324, run 34097856762,
receipt 2026-09-07T07:59:28.4240732Z. Fill CLI run 34097857070 is still under
observation; latest actual CLI publication remains poe-code@14.0.84.
