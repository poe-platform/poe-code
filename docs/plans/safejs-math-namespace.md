---
title: Math namespace descriptors
---

## Validated gap

Fourteen native-comparison tests failed: Math constants had writable,
enumerable and configurable flags, methods were enumerable, and the namespace
lacked its standard Symbol.toStringTag property.

## Implementation

Set the standard constant and method property flags and install the Math tag.
Register namespace state with the existing intrinsic tracker so mutations remain
visible to snapshot validation after the methods become non-enumerable.
Preserve native method calls and seeded random behavior unchanged.

## Verification

- Seventeen namespace tests include strict mutation rejection and pending/completed
  serialized and direct checkpoint round trips after method/tag mutations.
- Focused Math and legacy compatibility tests: 97 passed, one skipped.
- Explicitly add the Math symbol tag to legacy expectations; preserve captured
  fixtures and exact graph comparisons.
- Maintained package unit route: 16,112 passed, 41 skipped (457 passed files,
  one skipped). Scoped ESLint and TypeScript checks passed.
- Selected workspace build passed, including four built-import checks.
- Actual CLI harness passed with zero spawns; screenshot inspected. Its
  prerequisite root build passed all 70 tasks uncached.

## Remaining validated Math gaps

Independent runtime probes show `Math.abs({valueOf(){return -7}})` and
`Math.pow` with guest valueOf methods throw TypeError rather than invoking the
guest conversions. Math method name/length properties also return undefined.
Thirty-five new regression tests reproduce numeric conversion failures across
every supported deterministic Math method. Leave those next-issue tests outside
this commit. Address conversion and function metadata in separate improvements.
