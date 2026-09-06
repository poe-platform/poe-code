---
title: Math function metadata
---

## Validated gap

Thirty-six initial regression tests failed because every installed Math method
lacked its standard name and length properties.

## Implementation

Install Math methods as guest-visible built-in functions with native arities
(including random's zero arity and the local f16round implementation's arity).
Register their qualified intrinsic identities before tracking their metadata,
then capture namespace and method baselines together. Keep this initialization
inside the Math factory so direct and full-realm construction stay consistent.

## Verification

- 181 metadata tests cover descriptors, mutable name/length and extra properties,
  absence of constructor prototypes, stable qualified intrinsic identities,
  pending/completed serialized and direct checkpoints, and forged-wrapper rejection.
- Focused Math and legacy compatibility cohort: 384 passed, two skipped.
- Update the existing security test's obsolete prohibition on Math.abs user
  properties while preserving host-constructor/internal-field checks and adding
  explicit checks for Math.abs's hidden kind/properties fields.
- Final maintained package unit route: 16,341 passed, 41 skipped (459 passed
  files, one skipped). Metadata/security cohort: 218 passed. Scoped lint and
  TypeScript checks passed.
- Selected workspace build passed, including four built-import checks.
- Actual CLI harness passed with zero spawns; screenshot inspected. Its
  prerequisite root build passed all 70 tasks uncached.

## Next gap

Math.sumPrecise is absent from the runtime. Exact summation over an iterable,
iterator closing, non-number rejection, rounding and signed zero handling remain
required by the [ECMAScript specification](https://tc39.es/ecma262/2026/multipage/numbers-and-dates.html#sec-math.sumprecise).
Thirteen initial tests now reproduce the missing behavior, including precise
cancellation, rounding ties, signed zero, special values, generators and cleanup.
Keep these next-issue tests outside the metadata commit.

A finite-input prototype using integer multiples of the smallest subnormal and
one final ties-to-even rounding step correctly handled cancellation, intermediate
overflow cancellation, half-ULP ties, tiny residuals and subnormal addition.
It still needs integration, iterator semantics, special-value handling and tests;
this prototype is not a completed implementation.
