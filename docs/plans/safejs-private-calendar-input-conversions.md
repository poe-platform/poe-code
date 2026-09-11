# Private calendars in Temporal input conversions

## Reproduction

The follow-up probe recorded in `safejs-month-day-year-month-calendar.md`
identified four incorrect public calendar reads: PlainDate.from,
PlainDateTime.from, ZonedDateTime.from, and Duration relativeTo conversion.
An owned Buddhist YearMonth supplied a public day and timeZone but a throwing
calendar getter. Native Node 26.8.1 preserved the private Buddhist calendar
and returned a 24-hour duration total; all four SafeJS calls invoked the getter.

Four new tests reproduced these failures before implementation. The expected
behavior follows [GetTemporalCalendarIdentifierWithISODefault](https://tc39.es/proposal-temporal/#sec-temporal-gettemporalcalendarslotvaluewithisodefault):
calendar-bearing Temporal objects use their internal calendar, while ordinary
objects undergo a calendar property read and default to ISO only if undefined.

## Implementation

Add a shared calendar-with-ISO-default reader and use it in the four affected
adapters. Recognize all five owned calendar-bearing Temporal brands. Do not
unwrap proxies, use public calendarId, change date-field getter semantics, or
change the specialized private date/time copying paths. Partial `with` inputs
continue to use the receiver calendar after rejecting forbidden Temporal
partial objects.

Keep the input and intermediate calendar rooted while awaiting guest property
access. The existing calendar identifier reader handles explicit calendar
strings and calendar-bearing values returned by ordinary property getters.

## Verification

- Before fix: four new tests failed with `Error: calendar read`.
- Final focused run: 100 tests across eleven conversion, relativeTo and `with`
  files passed on Node 22.23.2.
- Nine new tests passed on Node 18.20.8, including MonthDay inputs, a proxy with
  its own calendar behavior and propagation of an ordinary getter's exception.
- Package TypeScript check with `--noEmit` and focused ESLint passed.

These are current-worktree results, not a complete full-suite rerun or proof of
standalone HEAD completeness. Other Temporal factories, namespace and snapshot
integration remain pending. No CLI appearance changes. Commit locally; pushes,
publication and issue closures remain paused.
