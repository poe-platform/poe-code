# Cached Intl bound-function call context

## Validated defect

DateTimeFormat.format, NumberFormat.format and Collator.compare all failed when
coercion required a guest Proxy's Symbol.toPrimitive hook. The ordinary numeric
conversion path worked; the cached Intl functions threw `Proxy operations
require guest property access`. Four regressions failed before the fix,
including a retained DateTimeFormat function used through completed replay.

## Fix

Extend the internal bound-call callback with an optional current call context.
Forward it during calls and construction while retaining the existing bound
receiver, arguments and new-target substitution. Existing callbacks can ignore
the added optional argument.

The three Intl cached-function callbacks now forward that invocation context
to the intrinsic target, overriding stack and receiver as before. Do not capture
the format getter's context: a cached function must use its current call's
proxy-access and execution hooks, including after replay.

## Verification

- Before fix: all four new regressions failed on missing guest property access.
- Node 22: 202 tests passed across twelve Intl, bound snapshot and bind-order
  files, including the four regressions.
- Node 18.20.8: 38 tests passed across the regression, bound snapshot and
  bind-order files.
- Package TypeScript checking with `--noEmit` passed.
- Another 43 function-method, realm, receiver and SDK-construction checks
  passed on Node 22.
- Focused ESLint passed for all five runtime files and the regression file.

No runtime default or timeout was changed and no assertion was weakened to
obtain these passes. Known reversed-range behavior on Node 18, ISO month-name ICU
failures and extreme-range formatting remain unresolved. This is not a full
package pass or a complete SafeJS conformance claim.

## Delivery

Atomic local fix; no push, release or issue closure during the hold. No visual
CLI changes. Preserve unrelated staged SafeBash edits.
