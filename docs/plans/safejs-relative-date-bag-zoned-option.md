# ZonedDateTime time zones in relative-date bags

## Validation before repair

The shared relative-date reader accepted a ZonedDateTime as the whole
`relativeTo` value, but rejected one in a date bag's `timeZone` field.
Three regression cases failed with `TypeError: timeZone must be a string`;
the guest proxy/lookalike rejection case already passed (0a2c9d).

TC39's [GetTemporalRelativeToOption](https://tc39.es/proposal-temporal/#sec-temporal-gettemporalrelativetooption)
uses calendar-field conversion, including
[ToTemporalTimeZoneIdentifier](https://tc39.es/proposal-temporal/#sec-temporal-totemporaltimezoneidentifier).
An initialized ZonedDateTime supplies its private zone. Its own epoch and
calendar do not replace the containing date bag's date or calendar.

Native Node 26.8.1 confirmed the same three cases with a subclass whose public
fields throw: `[23, -1, "P1D"]` for total hours, comparison against 24 hours,
and rounding 23 hours to a calendar day at the New York spring DST transition
on 2024-03-10 (09ac4a).

## Change and scope

Extract the private zone before the existing string validation in the shared
relative-date reader. Guest proxies and inherited lookalikes still fail before
reading the subsequent year field. No object-to-string coercion is added.

Commit the previously pending reader and its calendar-identifier dependency,
together with their existing calendar/private-date/replay tests and the new
regressions. Public Temporal namespace and snapshot wiring remain uncommitted;
these working-tree integration tests do not prove a standalone HEAD release.

## Checks

- Focused relative-date, Duration total/round/compare cohort: 110 tests passed
  across 7 files (17b0c8).
- Node 18.20.8: all 4 new regressions passed (0effb9).
- Package TypeScript check passed (a6a962).
- Focused ESLint on both input readers and the four relative-date test files
  passed (3f67cb).

Full-package failures remain open. Pushes and releases remain paused. No visual
CLI behavior changes.
