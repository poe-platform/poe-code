---
title: Float32Array lastIndexOf
---

# Float32Array lastIndexOf

The missing method is validated by 10 failing native comparisons (two error-only
controls passed coincidentally), before any lastIndexOf implementation change.
RED log: `/tmp/poe-safejs-float32-last-index-of-red.log` (1.25 seconds).

Follow the published [ECMAScript 2026 algorithm](https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-%typedarray%.prototype.lastindexof):
validate/capture length, short-circuit empty receivers, distinguish omitted
fromIndex from explicit undefined, convert and clamp the starting index, then
search backwards with property-presence checks and strict equality. Preserve
the captured length across conversion callbacks and skip removed elements.
Return positive zero for index zero, even with negative-zero/fractional input.

The separate indexOf negative-zero correction was discovered while checking
these boundaries and delivered first. lastIndexOf now shares the typed search
loop, with backwards iteration and its own start-index calculation. Tests cover
direct calls, detachment, two snapshots, retention and step-budget exhaustion.
Keep lastIndexOf as its own atomic commit and qualify all typed search methods.

The harness checks omitted versus explicit undefined, and finds a surviving
element after a shrink callback. It crosses an await boundary, makes no agent
calls and does not test model behavior.

Qualification: all 430 tests across 30 buffer/Float32 files pass (16.01 seconds),
including 21 lastIndexOf tests. TypeScript and scoped ESLint pass. No matching
open GitHub issue was found.

The real harness passed after 70 uncached build tasks (59.014 seconds); its
screenshot was inspected. The built SDK passed omitted/explicit start-index and
positive-zero checks on Node 18.18.0.

Post-build presence audit against Node 22's typed-array prototype still finds
these non-callable methods in SafeJS: every, filter, find, findIndex, findLast,
findLastIndex, forEach, map, reduce, reduceRight, some, sort, toReversed, toSorted,
with. This is a presence inventory only, not proof that all callable methods
have correct typed-array semantics. Each next implementation still needs
failing behavioral tests and specification validation.
