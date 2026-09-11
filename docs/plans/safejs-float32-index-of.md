---
title: Float32Array indexOf
---

# Float32Array indexOf

Nine native comparisons failed before implementation (two error controls passed
coincidentally), confirming the missing method. RED log:
`/tmp/poe-safejs-float32-index-of-red.log` (1.15 seconds).

The published [ECMAScript 2026 algorithm](https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-%typedarray%.prototype.indexof)
captures length before converting fromIndex, returns -1 immediately for empty
arrays, checks property presence and compares without coercion. NaN does not
match. Elements removed by callback resize or detachment are skipped, unlike
the undefined reads used by includes.

Share the existing bounded search loop with includes, keeping explicit matching,
presence and return-value differences. Preserve guest conversion, per-element
step accounting and receiver/argument retention. Test native parity, precision,
coercion boundaries, resize, direct calls, detachment, two snapshot round-trips,
retention success/failure and budget exhaustion. Run includes regressions too.

The paired harness checks a found index, NaN non-matching and absent elements
after a resize callback, across an await boundary. It has no agent calls and
does not validate model behavior.

Qualification: all 406 buffer/Float32 tests across 29 files pass (15.06 seconds),
including 17 indexOf tests. TypeScript and scoped ESLint pass. No matching open
GitHub issue was found.

The real harness passed after 70 uncached build tasks (60.446 seconds); its
screenshot was inspected. The built SDK passed NaN rejection, first-match and
negative-start checks on Node 18.18.0.
