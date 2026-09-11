---
title: Structured clone symbol-key omission
---

# Validated symbol-key cloning gap

Three failing native-comparison regressions demonstrate that structuredClone
retains symbol-keyed data and rejects ignored symbol-keyed getters on objects
and arrays. Ordinary host copy controls pass before the fix.

Select only enumerable string keys for structured cloning, before rejecting
accessor descriptors. Allow plain objects and arrays with managed descriptors
through the structured-clone path: their descriptors are normalized in the copy.
General sandbox copying remains unchanged, including host accessor rejection.
Guest enumerable string getters remain a separate confirmed gap.

## Manual validation

Run the paired harness with `npm run screenshot-poe-code -- harness run
docs/plans/safejs-structured-clone-symbol-keys.md` and inspect its screenshot.
This validates runtime behavior only, without model spawns. Run the focused
cloning, general value-copy and symbol-descriptor tests, TypeScript and ESLint.

## Results

Three native-comparison regressions failed before the fix; both host-copy
controls passed. Afterward all 136 focused tests across nine files passed.
TypeScript and ESLint passed. The real harness passed after 70 uncached build
tasks, and its screenshot was inspected. No matching open GitHub issue was found.
