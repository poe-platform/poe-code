---
title: Switch generator continuations
---

## Validated defect

Six native-comparison tests failed before implementation. Generator restoration
re-evaluated switch selectors and case tests, repeated earlier case statements,
and could complete during replay instead of returning the expected result.

## Implementation

Preserve the discriminant, lexical scope, case index, statement index and test/body
phase in the generator continuation. Resume the suspended expression or statement
without repeating completed selection or fall-through work. Encode/decode the
scope and value through the existing heap; validate exact fields and source-owned
case/statement positions before accepting public snapshots.

## Verification

- Compare sync/async generators against native execution after JSON restoration
  at each suspension, including case tests, fall-through, default positioning,
  nested switches, lexical declarations and abrupt completion.
- Reject malformed scope, phase, case/statement indices, missing and extra state.
- All 33 focused cases pass; scoped ESLint and TypeScript checks pass.
- Maintained package run: 15,787 tests passed, 41 skipped; 449 files passed.
- Selected workspace build closure and built-import checks passed.
- CLI harness passed and its screenshot was inspected. The harness is an ordinary
  execution smoke check; unit tests provide restoration coverage.

## Next validated gap

An `if(++count===1){yield 1;return count}` generator also re-evaluates its completed
condition during restoration and reports completion during replay; native
resumption returns 1. Branch restoration needs a separate fix and is not changed
by switch continuation records.
