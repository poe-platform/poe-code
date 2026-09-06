---
title: If statement generator continuations
---

## Validated defect

Six sync/async cases failed before the fix: restoration repeated side effects in
an already completed if condition and could choose a different branch, completing
the generator during replay.

## Implementation

Use the active yield location to resume its enclosing consequent or alternate.
Evaluate the condition normally when the suspension belongs to the condition or
when there is no active resumption. No new snapshot state is required.

## Verification

- All 36 focused branch cases pass after repeated JSON serialize/restore, compared
  with native JavaScript. Coverage includes nested if/else, else-if, single
  statements, condition yields, repeated yields, throw/return/finally and existing
  conditional/logical expressions.
- Maintained package tests: 15,807 passed, 41 skipped; 449 files passed.
- Scoped ESLint and TypeScript checks passed.
- Selected workspace build closure and built-import checks passed.
- CLI harness passed and its screenshot was inspected. The harness checks ordinary
  execution; unit regressions verify snapshot restoration.

## Next validated gap

Labels currently accept loops and blocks only. Parser probes reject labeled if,
switch and expression statements, whereas native execution accepts all three
and produces the expected result. General labeled statements need a separate
parser/interpreter improvement, retaining duplicate-label and invalid-continue
validation. This change does not broaden label syntax.
