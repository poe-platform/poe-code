---
title: Float32Array sort
---

# Float32Array sort

Next independent improvement after reduceRight. The installer omits sort;
validate behavior with native comparisons before implementation.

Published ECMAScript 2026 section 23.2.3.29 validates an optional comparator,
validates the receiver, captures all elements, performs stable numeric sorting,
then writes the sorted values back and returns the original receiver. Default
comparison puts NaNs last and negative zero before positive zero. Custom results
undergo ToNumber; NaN is treated as equal. Species is not consulted.
https://262.ecma-international.org/17.0/#sec-%typedarray%.prototype.sort

Do not assert native comparator-call order: the algorithm can differ. Cover
stability, numeric edge cases, coercion/errors, snapshot-before-comparison and
writeback-after-comparison semantics, resize/detachment, snapshots and budget
limits. Use scalable bounded sorting rather than unbudgeted native callbacks.
Existing generic Array sort is insertion-based with string default comparison;
do not blindly proxy it for typed arrays or expand into unrelated Array changes.

Validated before implementation: 13 native comparisons fail and one coincidental
invalid-comparator TypeError control passes (1.48 seconds). RED log:
/tmp/poe-safejs-float32-sort-red.log. The regression file remains uncommitted
until the independent sort improvement is implemented and checked.

Implementation uses bottom-up stable merge sorting with two budgeted Float32
scratch buffers. All source reads precede comparisons; writeback follows the
completed sort. Every copy/merge/write visits the step budget, and scratch plus
comparator results remain retained through guest coercion. Default comparison
handles NaN and signed zero; custom NaN results preserve stable equality.
Tests verify sorted results and a comparison-count upper bound, not native call
order. Additional cases cover coercion errors, promises, detachment, snapshots,
scratch limits and a step-limit failure before writeback. A data-limit test was
adjusted to allow setup to finish before exercising scratch allocation.
The harness is a zero-spawn runtime/schema check, not model behavior QA.

Verification: 678 focused Float32Array/ArrayBuffer tests passed in 43 files
(23.11 seconds), including 28 sort tests. Package TypeScript and exact-file
ESLint passed. The actual harness completed 70 uncached build tasks (61.189
seconds); its PNG was inspected and showed Harness passed, zero spawns. Built
SDK Node 18.18.0 smoke confirmed numeric order and comparator-result coercion.
No matching open GitHub issue was found. The toReversed regression file was
added after the passing suite and is intentionally RED, outside this commit.
