---
title: Float32Array toSorted verification
---

# Float32Array toSorted

Next independent improvement after toReversed. The installer omits toSorted;
validate the gap with native comparisons before implementation.

Published ECMAScript 2026 section 23.2.3.33 validates comparator and receiver,
captures internal length, creates the same element type without species lookup,
then stably sorts captured source values into an independent result.
https://262.ecma-international.org/17.0/#sec-%typedarray%.prototype.tosorted

Reuse the budgeted stable numeric sorter, without writing its result to source
storage. Empty/single-element input must still return fresh storage. Cover
source independence, NaN/signed zero/stability, custom coercion/errors/promises,
ignored species, source mutation/resize/detachment, snapshots and resource limits.
Keep this independent from toReversed delivery.

Validated before implementation: 13 native comparisons fail and one coincidental
invalid-comparator TypeError control passes (1.25 seconds). RED log:
/tmp/poe-safejs-float32-to-sorted-red.log. The regression file remains uncommitted
until the independent toSorted improvement is implemented and verified.

Implemented using the shared stable merge sorter, returning its independent
storage instead of writing back. Empty and singleton results allocate fresh
storage without a scratch buffer. Species and shadowed constructor/length are
not consulted.

Verification: 25 focused toSorted tests pass; all 718 focused Float32/ArrayBuffer
tests pass across 45 files (23.65 seconds). Package TypeScript and exact-file
ESLint pass. The real harness pair passed after 70 uncached workspace build
tasks (62.931 seconds); its PNG was inspected. This zero-spawn harness verifies
runtime/schema integration, not model behavior. Built SDK numeric/default and
object-comparator checks also pass under Node 18.18.0. No matching open GitHub
issue was found. Other typed-array types and the separate with gap remain.
