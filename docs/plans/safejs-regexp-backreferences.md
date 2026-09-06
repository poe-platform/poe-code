---
title: RegExp numbered backreferences
---

All 25 initial native comparisons fail. Resolve decimal escapes using the total
number of capturing groups, including later groups while excluding escaped/class
parentheses and noncapturing assertions. Match captured ranges in either execution
direction, preserving unmatched/forward-reference empty matches and case folding.
Charge comparisons against the shared regex execution limit.

When no numbered capture exists, preserve non-Unicode legacy octal and identity
escapes, including class escapes and the quantification of trailing digits.
Unicode mode and named captures remain open work.

Reference: [ECMAScript BackreferenceMatcher](https://tc39.es/ecma262/multipage/text-processing.html#sec-backreferencematcher).

Validate native comparisons, numeric-escape controls, checkpoints, compilation and
execution budgets, maintained SafeJS tests, lint/types, and the selected build.
Run this actual CLI harness and inspect its screenshot before the atomic commit
and push. Continue remaining JavaScript gaps while monitoring publication.
