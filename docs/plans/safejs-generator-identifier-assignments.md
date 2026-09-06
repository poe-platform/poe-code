---
title: Generator identifier assignments
---

# Generator identifier assignments

## Validated defect

After restoration, compound assignments reread the binding instead of using
the value captured before their right-hand expression. A generator starting
with 2, assigning 10 within its right-hand expression, and then yielding
incorrectly returned 14 instead of 6 when resumed with 4.
Logical assignments could also incorrectly short-circuit on the new value.
The expanded sync/async test cohort reproduced 12 failures with two simple
assignment controls passing.

## Implementation

Capture the previous value in an identifier-assignment continuation and retain
it during evaluation. Serialize and restore that value, validating its exact
assignment ancestry. Resume logical assignment decisions using the captured
value, not the modified binding. Ordinary assignment name inference remains.

## Validation

The 14 focused tests pass, including an object-valued previous operand.
The maintained SafeJS package unit route passed 15,442 tests (41 skipped).
Changed-file ESLint, package TypeScript checking and the selected workspace
build passed. The skill-guided CLI smoke check passed with zero spawns; its
PNG was inspected and showed no warnings. Release publication is tracked
separately. A subsequently added, uncommitted for-loop regression belongs
to the next atomic fix, not this change's verification cohort.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-generator-identifier-assignments.md` and inspect the PNG.
Expect a passed harness, no warnings and zero spawns. The pair grants no
capabilities and verifies the result is 6. Snapshot correctness is covered
separately by the unit tests; this smoke check does not prove restoration.
