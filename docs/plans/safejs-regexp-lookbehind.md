---
title: RegExp lookbehind assertions
---

Native comparisons fail in 22 of 23 initial cases because lookbehind is rejected.
Add backward matching for positive/negative lookbehind, including variable-length
quantifiers, reverse sequence evaluation, and forward-ordered capture spans.
Nested assertions choose their own direction without resetting the shared regex
execution counter. Lookbehind cannot be directly quantified.

Reference: [ECMAScript CompileAssertion](https://tc39.es/ecma262/multipage/text-processing.html#sec-compileassertion).

Validate native matching/capture comparisons, mixed assertion directions, checkpoint
replay, compilation-depth and backtracking limits, maintained SafeJS tests, lint/types,
and the selected build. Run this actual CLI harness and inspect its screenshot before
the atomic commit and push. Monitor releases while continuing the remaining gaps:
Unicode regex mode, named captures, backreferences, and broader JavaScript coverage.
