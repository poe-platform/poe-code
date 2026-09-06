---
title: Do-while generator continuations
---

## Validated defect

Restoring a generator suspended in a do-while condition executed the completed
body again before consuming the pending yield. Twelve native-comparison cases
failed before the change, including nested loops and continue/finally paths.

## Implementation

Determine whether the active suspension belongs to the condition. On restoration,
skip the completed body once, then resume normal body/condition iteration. Keep
the existing snapshot format and matching break/continue behavior.

## Verification

- JSON serialize/restore after each suspension and compare with native JavaScript.
- Cover synchronous/asynchronous generators, body and condition yields, nested
  loops, condition side effects, continue/finally, throw and return: 36 cases pass.
- Maintained SafeJS package tests: 15,754 passed, 41 skipped; 448 files passed.
- Scoped ESLint, TypeScript and selected workspace build closure passed.
- CLI harness passed and its screenshot was inspected successfully. This smoke
  check exercises ordinary execution; the unit cases verify portable restoration.

## Next validated gap

A generator with `switch(++count){case 1:yield 1;return count;default:return 9}`
cannot be restored after its yield: it re-evaluates the discriminant and completes
during replay. Native resumption returns 1. Switch selection and case progress
need a separate continuation fix; they are not changed here.
