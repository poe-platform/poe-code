# MonthDay conversion from a YearMonth calendar

## Validated failure

`PlainMonthDay.from()` treated an owned PlainYearMonth as an ordinary bag for
calendar lookup. A throwing public `calendar` getter therefore aborted the
conversion; absent that property, a non-ISO YearMonth could be read as ISO.

Native Node 26.8.1 accepts a Buddhist YearMonth with an added public `day: 29`
and a throwing calendar getter, returning `1972-02-29[u-ca=buddhist]`.
SafeJS instead propagated `Error: calendar read` in the same-process probe.
Three regression tests failed before the fix, covering base/subclass instances
and ordered public field access.

The [calendar-default operation](https://tc39.es/proposal-temporal/#sec-temporal-gettemporalcalendarslotvaluewithisodefault)
uses the private calendar of every calendar-bearing Temporal type, including
YearMonth. MonthDay conversion still obtains the actual date fields through
ordinary property access; this is not a private-field clone of a YearMonth.

## Fix

Add owned YearMonth to the existing input reader's private-calendar branch.
Keep its field getters, overflow validation and partial-input brand rejection
unchanged. Commit the previously pending input adapter and existing from-tests
with the correction and new regression file. Public MonthDay factory and other
integration remain pending, especially the known host ICU locale failures.

## Verification

- Before fix: all three new regression cases failed on the shadow getter.
- After fix: 32 tests across five MonthDay input/conversion files passed.
- Node 18.20.8: ten tests across the regression and from files passed.
- Native Node 26.8.1 confirms field order: day, era, eraYear, month, monthCode,
  year, overflow; the private calendar does not cause a calendar getter read.
- Package TypeScript check with `--noEmit` passed.
- Focused ESLint passed for the input adapter and both committed test files.

Tests use the current working tree, including pending Temporal factories and
namespace wiring. No standalone HEAD completeness or full-suite pass claimed.
## Confirmed follow-up

A separate same-process Node 26.8.1 probe used a Buddhist YearMonth with public
`day: 29`, `timeZone: 'UTC'` and a throwing `calendar` getter. Native
PlainDate.from, PlainDateTime.from and ZonedDateTime.from each preserve the
Buddhist calendar; Duration({days: 1}).total in hours returns 24. The equivalent
SafeJS calls all incorrectly propagate `Error: calendar read`. These four
additional adapter failures are validated but not fixed by this commit.

No visual CLI changes. Pushes, releases and issue closures remain paused.
