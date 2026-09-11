---
title: Exact iterable summation
---

## Validated gap

Thirteen initial tests failed because Math.sumPrecise was absent. Its required
behavior is specified by [ECMAScript 2026, 21.3.2.34](https://tc39.es/ecma262/2026/multipage/numbers-and-dates.html#sec-math.sumprecise).

## Implementation

Consume the synchronous iterable protocol using existing sandbox iterator helpers.
Reject non-number elements without coercion and close the iterator on that
rejection; preserve the original exception if cleanup fails. Do not close after
abrupt next/done/value operations or assimilate synchronous iterator results.

Accumulate finite values as integer multiples of 2^-1074. Round once to binary64
with ties to even. Track NaN, infinities and the all-negative-zero case separately,
while continuing to consume and validate all elements. Count elements and charge
work/data budgets; retain live iterator state and release it on all exits.

Install the function with standard metadata and automatic intrinsic tracking.
Explicitly extend legacy expectations while leaving captured fixtures unchanged.

## Verification

- 67 summation tests: exact cancellation, extreme exponents, rounding ties,
  intermediate overflow, signed zeros, infinities/NaN, generators and sets,
  protocol access order, cleanup and rejection rules, checkpoints, budgets and
  retained-state cleanup.
- Added sumPrecise to the common Math metadata/mutation/identity/checkpoint matrix.
- Focused summation, metadata and legacy cohort: 297 passed, one skipped.
- Maintained package unit route: 16,413 passed, 41 skipped (460 passed files,
  one skipped). Scoped ESLint and TypeScript passed.
- Fast-forwarded an unrelated playground resource-disclosure commit from remote
  main, preserving local staged changes. Selected workspace build passed,
  including four built-import checks. The actual CLI harness passed with zero
  spawns; screenshot inspected. Its prerequisite root build passed all 70 tasks
  uncached.

## Next validated gap

Map and Set constructor name/length/prototype properties are undefined. Runtime
probes also show Object.getPrototypeOf rejects their instances and repeated
method lookups produce unequal function identities (`m.get !== m.get`,
`s.add !== s.add`). Their standard collection object/prototype model needs a
separate implementation and checkpoint audit.
Ten failing regression tests reproduce those constructor/prototype/method gaps;
leave that next-issue test file outside the summation commit.
