---
title: JSON namespace descriptors
---

## Validated gap

Seven initial tests failed because JSON methods were enumerable and the namespace
lacked its standard Symbol.toStringTag property.

## Implementation

Make JSON's four methods non-enumerable while keeping them writable/configurable.
Install the JSON string tag as non-writable, non-enumerable and configurable.
Track the namespace and its methods as one intrinsic state group, so hiding the
methods from enumeration does not hide later mutations from snapshot validation.

## Verification

- Ten namespace tests cover descriptors, enumeration, tag rendering, mutation
  and serialized/direct checkpoints.
- Metadata and legacy compatibility cohort: 76 passed, 1 skipped.
- Namespace and comparison-helper tests: 19 passed. Explicitly compare expected
  symbol additions; reject wrong values, wrong symbols, extra and duplicate keys.
  Keep the original captured fixtures and legacy alias checks intact.
- Maintained package unit route: 16,095 passed, 41 skipped (456 passed files,
  one skipped). Scoped ESLint and TypeScript checks passed.
- Selected workspace build passed, including all four built-import checks.
- Actual CLI harness passed with zero spawns; its screenshot was inspected.
  The prerequisite root build completed all 70 tasks successfully, uncached.

## Next validated gap

Fourteen independent native-comparison tests demonstrate that Math constants
have incorrect property flags, methods are enumerable, and its namespace lacks
the standard string tag. Track that separately from this JSON improvement.
