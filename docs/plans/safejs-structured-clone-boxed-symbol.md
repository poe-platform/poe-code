---
title: Structured clone boxed symbol rejection
---

# Validated boxed-symbol cloning gap

Seven native-comparison cases fail before this change: boxed symbols are accepted
at the root, in arrays/maps/sets and in getter results. Invalid clones detach
listed buffers and continue to later getters. A general sandbox-copy control
passes and must remain supported.

Reject the intrinsic boxed-symbol brand only in structured-clone mode, before
property traversal or transfer. Do not invoke valueOf or Symbol.toPrimitive.

## Manual validation

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-structured-clone-boxed-symbol.md` and inspect the screenshot.
The real harness uses no model spawns. Run focused boxed-value and clone tests,
TypeScript and ESLint before committing this atomic fix.

## Results

Seven regressions failed before the fix, with the ordinary-copy control passing.
Afterward all 199 focused tests in seven files passed. TypeScript and ESLint
passed. The real harness passed after 70 uncached build tasks; screenshot inspected.
