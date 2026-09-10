# Intl DateTimeFormat Temporal admission

## Validated bug

All four guest DateTimeFormat methods admitted a ZonedDateTime as a number when
its valueOf returned zero. Native Node 26.8.1 throws TypeError without invoking
that hook. The six rejection/order regressions failed before the fix.

Native range probes establish that both inputs pass through conversion before
formatting rejects a ZonedDateTime: a numeric object's hook runs in either
operand position, while the ZonedDateTime's hook does not. Do not reject the
first zoned input before converting the second operand.

## Fix and integration

Include owned ZonedDateTime in the Temporal input discriminator to bypass
primitive coercion, then reject it explicitly in the formatting operation.
This preserves range conversion ordering. Duration is deliberately not included:
native DateTimeFormat still permits its ordinary overridden numeric coercion.

Reconcile the pending public DateTimeFormat Temporal input adapter, its two
Temporal interop test files and the requested-options accounting assertion.
Supported Temporal types continue through private-field formatting; numeric
dates retain the native path.

The [Temporal Intl specification source](https://github.com/tc39/proposal-temporal/blob/main/spec/intl.html)
separates ToDateTimeFormattable conversion from the subsequent formatting
operation. The native probes verify the observable rejection and range order.

## Separate confirmed follow-up

The new proxy control exposed an independent cached-bound-format defect.
Native formats a proxy with an explicit Symbol.toPrimitive hook as `1970`;
SafeJS throws `Proxy operations require guest property access`. Number(proxy)
succeeds in SafeJS. The DateTimeFormat bound-call callback discards invocation
context except stack and receiver. Preserve the test in
`intl-bound-proxy-coercion.test.ts` for a separate correction; do not claim the
formatter is completely conformant after the zoned fix.

## Delivery constraints

Verification: the final default Node 22 cohort passed 86 tests across seven
files. Node 18.20.8 passed 18 of 19 selected tests, including all six new zoned
rejections; its existing reversed PlainTime range test throws RangeError from
the host-backed formatting path. That additional portability gap remains open,
with its assertion unchanged. Package TypeScript checking with `--noEmit`
passed.
Focused ESLint passed for both runtime files and the four included test files.

Current-worktree validation includes pending snapshot and object-model changes.
No full-suite green result or complete Intl support is established. Known ICU
locale and extreme-range defects remain open. No CLI appearance changes.
Commit locally only; pushes, releases and issue closures remain paused.
