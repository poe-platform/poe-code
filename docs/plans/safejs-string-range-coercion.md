# String range argument coercion

## Validated defect

Native comparisons failed 22 of 26 cases before the repair (ca0f87). Slice and
substring bypassed guest conversion hooks for their bounds, lost thrown values,
and rejected callable arguments even when those arguments were ignored.

## Repair

Both methods now use guest numeric conversion in receiver/start/end order.
Undefined end remains distinct from a converted NaN or zero. Both conversions
complete even for ranges that ultimately produce an empty string. Native
substring extraction preserves each method's clamping, negative bounds and
reversed-bound behavior. Primitive-only direct calls stay synchronous; guest
conversion retains receiver/arguments and output allocation remains budgeted.
Legacy substr is not covered by this repair and requires separate validation.

## Verification

The initial regression and existing string-method suite passed 48 tests
(2cf9b1). Expanded tests add pending/completed checkpoint replay for reversed
bounds and direct context-free calls including output-budget rejection.
The final four-file selection passed 67 tests, including all 30 range
regressions (ce8904). Targeted ESLint and package TypeScript checks passed
(1f1f11).

No CLI visual changes, push or release. The preceding full-package result
predates this repair and its 14 ISO/Temporal/Promise failures remain unresolved.
