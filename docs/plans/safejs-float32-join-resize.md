---
title: Float32 join during buffer resize
---

Native comparisons reproduced three cases where shrinking a buffer during join
separator conversion produced literal undefined text instead of empty fields.
Retain the initial element count, but render missing indexed values as empty
strings. Growth and shrink/regrow cases remain passing controls. Existing
allocation and step-budget checks stay unchanged.

Run this pair with the real harness runner. It checks full and partial shrink
and a fixed view becoming out of bounds. This is a runtime-only check and does
not spawn an agent or claim model validation.

Validation:

- Five native comparisons: three failing shrink cases before the fix, two passing
  growth/regrowth controls. Focused join/resize/storage/snapshot tests: 45 passed.
- All 196 Float32 tests passed across 13 files with the unfinished species file
  excluded. An earlier run concurrent with TypeScript and lint hit the unchanged
  camera test's five-second timeout; rerunning the identical test command without
  those processes passed. No timeouts, budgets, fixtures or assertions changed.
- Scoped TypeScript and ESLint passed. The real harness check is running.
- Real harness passed after 70 uncached build tasks (58.543 seconds). Inspected
  `screenshots/harness-run-docs-plans-safejs-float32-join-resize.md.png`: expected
  result fields, Harness passed, zero spawns and no errors.
