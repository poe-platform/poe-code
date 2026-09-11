---
title: Array iteration protocol
---

# Array iteration protocol

## Validated defects

Three native comparisons failed: a custom array iterator was ignored, a null
iterator method was accepted, and an indexed getter was bypassed. The new
execution path always acquires the iterator protocol instead of assuming that
arrays and strings can be iterated through direct indexing.

The indexed continuation reader remains for older generator snapshots.
An explicit compatibility regression reconstructs the previous record shape
and restores it repeatedly through completion.

## Verification

The expanded focused cohort passed 85 tests, covering undefined and
non-callable methods, getter lookup count and receiver, inherited factories,
closing on break and legacy snapshot restoration. The maintained SafeJS unit
route passed 15,552 tests (41 skipped), without exclusions. Changed-file lint,
package types and the selected workspace build passed. The skill-guided CLI
harness passed with zero spawns; its screenshot was inspected without warnings.
Publication is tracked separately. A subsequently added uncommitted for-in target regression
belongs to the next atomic fix, not the completed package verification cohort.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-array-iteration-protocol.md` and inspect the PNG.
Expect a passed harness, zero spawns and no warnings. The skill-guided pair
grants no capabilities and asserts the custom iterator yields 7 and 8.
