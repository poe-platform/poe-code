# Owned Temporal.PlainMonthDay implementation

## Validated missing type

Current source reflection (61688c) found no public PlainMonthDay constructor.
Original upstream ZonedDateTime until/since calendar-temporal-object fixtures
fail in both modes when their shared helper constructs PlainMonthDay. Their
source was inspected (8f457f); the missing type is not an inferred arithmetic
defect. The prior difference baseline contains 396 passes and four such failures.

## Private core

PlainMonthDay retains isoYear, isoMonth, isoDay and calendar, including the
reference year rather than just a repeating month/day. The internal allocator
requires own primitive ISO numeric data, validates exact integer date/range
semantics, canonicalizes calendar identifiers, and stores a copied frozen
null-prototype record in a private WeakMap. Guest objects are extensible and
null-prototype until public integration selects their intrinsic prototype.
Proxies, getters, coercible objects and forged receivers do not gain admission.

Host admission captures native/backend PlainMonthDay intrinsic toString methods.
The specification's calendarName=always form includes the exact ISO reference
year; a maintained PlainDate parser and captured private date readers recover
that ISO date and calendar without calling public properties on the host value.
Reference: https://tc39.es/proposal-temporal/#sec-temporal-temporalmonthdaytostring
Direct backend probes (38657d) preserved reference year 2000, Buddhist calendar,
and the valid range endpoints; neighboring invalid dates raised RangeError.
Only tracked exports retain host admission after prototype removal; arbitrary
custom prototypes and untracked null-prototype host objects are not admitted.

## Verification and remaining work

The test-first run failed because the core module did not exist (6dcfb7).
All 17 core tests then passed on Node 22.23.2 (5499fb) and Node 26.4.0
(fd8869), and all 17 passed on Node 18.18.2 (47fd51). TypeScript passed
(f2b8ba), scoped lint passed (f04bd4), and whitespace checks passed (c711d4).
No CLI screenshot is applicable to this private, currently unexposed module.

Public construction/getters/methods, budgets, copying, host boundaries, heap and
replay codecs, related calendar readers, and PlainDate conversion still require
implementation and qualification. This core alone does not fix the upstream
fixtures, expose PlainMonthDay, or prove full Temporal conformance. No release
or remote delivery is claimed.
