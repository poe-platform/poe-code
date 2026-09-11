---
title: Float32Array toReversed
---

# Float32Array toReversed

Next independent improvement after sort. The installer omits toReversed;
validate behavior with native comparisons before implementation.

Published ECMAScript 2026 section 23.2.3.32 validates the receiver, captures its
internal length, creates the same element type (not species), and copies values
in reverse order without changing source storage.
https://262.ecma-international.org/17.0/#sec-%typedarray%.prototype.toreversed

Cover empty/single/even/odd lengths, signed zero and NaN, independence of storage,
ignored constructor/species/length shadows, subclass result type, resizable and
out-of-bounds views, snapshots and allocation/traversal/retention budgets. Keep
this independent from sort delivery and do not proxy slice().reverse(), which
would introduce species lookup.

Validated before implementation: eight native comparisons fail and one
coincidental out-of-bounds TypeError control passes (1.08 seconds). RED log:
/tmp/poe-safejs-float32-to-reversed-red.log. These regressions remain uncommitted
until the separate toReversed improvement is implemented and verified.

Implementation validates the receiver, allocates independent fixed Float32
storage without reading constructor/species, and copies numeric values in
reverse order. Source and result remain retained through allocation checkpoints
and budgeted copying. Tests cover ignored arguments, direct detached/wrong
receivers, observed backing retention during copying, two snapshot round-trips,
and allocation/traversal limits without source mutation.
The harness is a zero-spawn runtime/schema check, not model behavior QA.

Verification: 693 focused Float32Array/ArrayBuffer tests passed in 44 files
(23.01 seconds), including 15 toReversed tests. Package TypeScript and exact-file
ESLint passed. The actual harness completed 70 uncached build tasks (59.244
seconds); its PNG was inspected and showed Harness passed, zero spawns. Built
SDK Node 18.18.0 smoke confirmed ignored species and unchanged source storage.
No matching open GitHub issue was found. The toSorted regression file was added
after the passing suite and is intentionally RED, outside this commit/claim.
