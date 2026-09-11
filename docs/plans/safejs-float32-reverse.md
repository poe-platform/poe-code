---
title: Float32Array reverse
---

# Float32Array reverse

Candidate next gap after copyWithin: reverse is absent from the typed method
list. Reproduce native comparisons before implementation. Cover odd/even/empty
views, offset storage, subclass and receiver identity, detached/out-of-bounds
receivers, raw NaN payload preservation, budgets and snapshot/direct-call paths.
Keep the change separate from copyWithin. Check the published ECMAScript edition
before choosing byte-level implementation details. No implementation or RED test
evidence yet.

Five native comparisons now fail because reverse is missing, covering odd/even
and empty views, offset storage and subclass identity. RED evidence:
`/tmp/poe-safejs-float32-reverse-red.log` (1.38 seconds). The tests were added
after copyWithin qualification; no reverse implementation changes yet.

Implemented typed-receiver validation and budgeted byte swaps within the view,
returning the receiver. Checked the published
[ECMAScript 2026 reverse algorithm](https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-%typedarray%.prototype.reverse).
Raw NaN payload preservation is additionally compared against native reversal;
the standard's algorithm is expressed as element reads and writes, not as an
explicit raw-byte guarantee like copyWithin.

Fifteen focused tests passed in 1.38 seconds, covering the original comparisons,
resizable/offset views, ignored extra arguments and shadow length getters, exact
raw bytes, detached/non-typed receivers, two snapshot round-trips, and storage
retention/release both on success and step-budget failure. Log:
`/tmp/poe-safejs-float32-reverse-qualified.log`.

Broader Float32/buffer suite passed 358 tests across 26 files in 16.06 seconds.
Scoped TypeScript and ESLint passed afterward. Broader log:
`/tmp/poe-safejs-float32-reverse-broad.log`.

Real harness passed after 70 uncached build tasks (60.826 seconds). Inspected
`screenshots/harness-run-docs-plans-safejs-float32-reverse.md.png`: clean pass,
expected fields and zero spawns. Native Node 18.18.0 also passed reverse mutation
and return identity via the rebuilt run API.

CopyWithin scoped publication verified: @poe-platform/safe-js@0.1.325,
run 34098417859, receipt 2026-09-07T08:05:59.1467398Z. CLI run 34098418070
remains under observation; latest actual CLI publication remains poe-code@14.0.84.
