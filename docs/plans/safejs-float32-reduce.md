---
title: Float32Array reduce
---

# Float32Array reduce

Next independent improvement after filter. The installer omits reduce; validate
the missing behavior with failing native comparisons before implementation.

Published ECMAScript 2026 section 23.2.3.23 validates receiver and callback,
captures internal length, and distinguishes absent initialValue from explicit
undefined. Empty input without an initial value throws; otherwise the first
element seeds the accumulator only when initialValue was omitted. Callbacks get
undefined this, accumulator, live element, index and receiver. Results are not
numerically coerced and returned promises must not be awaited as accumulators.
https://262.ecma-international.org/17.0/#sec-%typedarray%.prototype.reduce

Cover callback/seed semantics, mutation, resize/detachment, error order, promise
identity, snapshots and accumulator retention/traversal budgets. Keep this
separate from filter delivery.

Validated before implementation: 10 native comparisons fail and two coincidental
TypeError controls pass (1.27 seconds). RED log:
/tmp/poe-safejs-float32-reduce-red.log. The regression file remains uncommitted
until the independent reduce improvement is implemented and checked.

Implementation validates callback and seed presence, then traverses the initial
length with live element reads. The accumulator is retained alongside source
storage and arguments, without conversion or promise settlement. Tests cover
throwing then/valueOf accessors, promise identity and job order, BigInt and
negative-zero/NaN results, direct source detachment with a retained object
accumulator, two snapshot round-trips and traversal cleanup.
The paired harness is a zero-spawn runtime/schema check, not model behavior QA.

Verification: 630 focused Float32Array/ArrayBuffer tests passed in 41 files
(20.52 seconds), including 20 reduce tests. Package TypeScript and exact-file
ESLint passed. The actual harness completed 70 uncached build tasks (59.867
seconds); its PNG was inspected and showed Harness passed, zero spawns. Built
SDK smoke passed on Node 18.18.0. No matching open GitHub issue was found.
The reduceRight regression file was added after the passing suite and is
intentionally RED, outside this commit/claim.

Fresh post-build method inventory compared native Node 22 typed-array function
descriptors with callable guest members. Still absent: reduceRight, sort,
toReversed, toSorted, with. This presence-only check does not establish behavioral
conformance of existing methods or support for other typed-array element types.
