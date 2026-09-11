---
title: Generator for-loop continuations
---

# Generator for-loop continuations

## Evidence and change

The initial regression showed restoration repeating a for-loop initializer,
returning 2 rather than 1. Expanded sync/async comparisons reproduced ten
failures across sixteen cases. Tests repeatedly serialize and restore each
generator, comparing its next result with native JavaScript.

Capture the loop phase, loop scope and active iteration/update scope. Resume
the suspended phase without replaying previous phases. Keep distinct iteration
bindings so closures retain their own values. Snapshot readers validate the
phase against source ancestry and allow internal scope references only in
the dedicated continuation fields, never as guest data.

## Verification

Twenty-two sync/async restoration cases and four public snapshot validation
cases pass. The maintained SafeJS unit route passed 15,468 tests (41 skipped).
Changed-file lint, package types, and the selected workspace build passed.
The skill-guided CLI harness passed with zero spawns; its screenshot was
inspected with no warnings. Release publication is tracked separately.
Subsequent uncommitted for-in/for-of regressions validate the next atomic fix
and are not included in this change's passing verification cohort.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-generator-for-continuations.md` and inspect the PNG.
Expect a passed harness with zero spawns and no warnings. No capabilities are
granted. The skill-guided pair checks generator iteration and closure values;
the unit tests independently cover repeated low-level snapshot restoration.
