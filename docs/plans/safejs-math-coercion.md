---
title: Math guest numeric conversion
---

## Validated gap

Thirty-five tests demonstrated that every supported deterministic Math method
rejected guest numeric conversion hooks instead of invoking them.

## Implementation

Convert arguments through sandboxNumber in order, using the shared runtime
budget and callback context. Fixed-arity methods ignore extra arguments;
max/min/hypot convert all arguments. Preserve synchronous primitive calls and
errors, await interpreter callbacks without assimilating guest promises, and
release retained inputs on success or failure. Charge each conversion.
Direct factory calls without an interpreter context retain native synchronous
coercion, including native host hooks; guest runtime calls use sandbox hooks.

## Verification

- Forty-eight conversion tests cover all deterministic methods, accessors,
  inherited hooks, fallback conversion, receiver binding, abrupt completion,
  NaN/Infinity, ignored arguments, BigInt/Symbol rejection, missing arguments,
  async-hook ordering, checkpoints and budget exhaustion.
- Focused conversion, Math and namespace cohort: 101 passed.
- Expanded cohort with existing direct host-call and f16round coverage:
  167 passed, two skipped. The first package run exposed seven host-call
  compatibility failures; preserve synchronous native coercion without changing
  those existing assertions.
- Final maintained package unit route: 16,160 passed, 41 skipped (458 passed
  files, one skipped), no unhandled errors. Scoped ESLint and TypeScript passed.
- Selected workspace build passed, including four built-import checks.
- Actual CLI harness passed with zero spawns; screenshot inspected. Its
  prerequisite root build passed all 70 tasks uncached.
- Remote main advanced with independent SafeFS/Safe Bash changes during
  verification. Fast-forwarded them without modifying unrelated staged changes;
  dependency rebuild passed and the Math/FS integration cohort passed 1,108
  tests with 35 skipped across 13 files.

## Remaining gap

Math method name/length metadata remains absent, as independently observed
before this fix and reproduced by 36 failing tests after final verification.
Those next-issue tests remain outside this commit. Address metadata separately
with mutable properties and checkpoint coverage.

The runtime also returns `undefined` for `typeof Math.sumPrecise`. It is listed
in the [ECMAScript 2026 Math specification](https://tc39.es/ecma262/2026/multipage/numbers-and-dates.html#sec-math.sumprecise),
so exact iterable summation remains a distinct completeness requirement.
