---
title: Structured clone symbol rejection
---

# Validated symbol cloning gap

Seven native-comparison tests fail on remote main's transfer implementation:
symbol primitives, nested values, map keys/values and set entries are accepted.
Native structuredClone rejects these with DataCloneError (code 25), preserving
the original buffer when a transfer list is supplied.

Reject symbols during clone validation, before the ownership-transfer pass.
Keep ordinary guest symbols supported elsewhere; do not impose this restriction
on general sandbox copying or persistence.

## Manual validation

Run the paired harness using the real runner through `npm run screenshot-poe-code
-- harness run docs/plans/safejs-structured-clone-symbol.md`. Inspect the PNG.
No model spawns are needed; this is runtime validation only. Run the focused
symbol, transfer, miscellaneous clone and Date clone tests, TypeScript and lint.

## Results

All seven new tests failed before the fix. After the fix, all 58 tests across
the four focused files passed. TypeScript and ESLint passed. The real harness
passed after 70 uncached build tasks, and its screenshot was inspected.
