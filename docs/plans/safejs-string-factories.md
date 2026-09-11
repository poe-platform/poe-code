---
title: String factory guest coercion
---

## Validated gap

Eight cases failed because String.fromCharCode and String.fromCodePoint passed
guest objects directly to native conversion. Objects with valueOf, toString or
Symbol.toPrimitive hooks threw TypeError instead of producing A.

## Implementation

Convert each argument using sandbox numeric coercion, in order. Apply the native
single-number conversion immediately, so an invalid code point prevents later
arguments from being coerced. Retain inputs and partial output during callbacks,
charge per-argument work, and bound the growing output. Do not invoke the native
variadic factories with a potentially large argument array.

Keep the primitive fast path synchronous, including its RangeError and budget
failures. Resume the same loop asynchronously only when guest coercion requires
it. Existing direct-call tests remain unchanged.

## Verification

- 55 focused cases pass: guest hooks, primitives, UTF-16 truncation, code point
  validation, abrupt completion, job ordering, checkpoint host-effect replay and
  output budgets.
- Run scoped lint/types, maintained SafeJS package tests and selected build.
- Scoped lint and TypeScript pass. Maintained package tests pass: 16,058 passed,
  41 skipped. The focused cohort passes 70 tests, including the unchanged direct
  factory tests.
- Run this CLI harness and inspect the screenshot before committing and pushing.
- Selected workspace build and real CLI harness pass. The inspected screenshot
  shows Harness passed and zero spawns.

## Remaining validated gap

JSON method names remain absent through the public function property model, as
recorded in the raw JSON plan. Review metadata and descriptor mutation separately.
