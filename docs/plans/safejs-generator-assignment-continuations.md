---
title: Generator assignment continuations
---

# Generator assignment continuations

## Validated gaps

Sixteen initial native comparisons failed because restoration repeated member
target/key evaluation or getter reads while resuming an assignment's right-hand
value. Four initially passing cases served as controls.

Correction to an intermediate interpretation: Node 22 converts compound keys
twice, but that is not the ECMAScript 2026 requirement. The existing reference-
key tests correctly enforce reuse of the converted key. The attempted change
to reconvert it caused 49 full-suite failures and was withdrawn before delivery.
The new restoration tests use a primitive-key arithmetic oracle where Node's
object-key conversion diverges, independently asserting one conversion.
See [GetValue and PutValue](https://tc39.es/ecma262/2026/multipage/ecmascript-data-types-and-values.html#sec-getvalue).

## Change

Preserve the selected object, property value, converted read key (when present),
previously read value and optional super receiver across right-hand suspension.
Reuse the converted key for compound writes; simple assignment still performs
its first key conversion when writing.
Restore validates assignment ancestry and the presence of the super receiver.
Retain the target and property values during restored evaluation and coercion.

## Verification

The 28 sync/async restoration cases cover logical assignment, changed keys,
successive yields in both the key and right-hand value, null-target errors,
and super setters. The focused standards/restoration cohort passed 138 tests.
The maintained SafeJS workspace unit route passed 15,428 tests (41 skipped).
Changed-file ESLint, package TypeScript checking, and the selected workspace
build passed. The skill-guided CLI harness passed with zero spawns; its PNG
was inspected and showed no warnings. Publication is tracked separately from
these local checks.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-generator-assignment-continuations.md` and inspect the screenshot.
Expect a passed harness, no warnings and zero spawns. It asserts the original
read value and converted key are retained: a becomes 6, b remains 10, and the
conversion count is 1. No capabilities are granted.
Repeated low-level restoration is independently validated against native JS
by the unit tests, not inferred from this CLI smoke check.
