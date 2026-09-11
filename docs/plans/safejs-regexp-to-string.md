---
title: RegExp string conversion
---

Native comparisons reproduced a missing direct/borrowed toString method and
ignored source/flags getters and conversion hooks. The initial suite had ten
failures, including a budget-retention check. Stronger controls subsequently
identified duplicate retention of an already-converted string.

Expose RegExp toString and share its implementation with implicit conversion.
Require an object receiver, read and convert source before reading and converting
flags, honor guest descriptors, preserve getter receivers, and avoid cursor reads.
Retain intermediate values through callbacks, releasing raw values after their
conversion. Keep native accessor admission and sandbox call-depth controls intact.

Validate direct and borrowed calls, primitives, property order, throwing getters,
symbols, large/bounded conversion pairs, and recursive conversion. Run maintained
package unit tests, changed-file lint, types, selected workspace build, and this
zero-capability, zero-spawn harness with a screenshot.

Full RegExp intrinsic prototype graphs, species/exec dispatch, and advanced regex
syntax remain separate gaps; this fix does not claim they are complete.
