# Temporal Intl extreme-range formatting gap

## Reproduction

Pinned Test262 revision 419d3e0a2273ba01a3bfcbec423f2801425b8e93, directory
test/intl402/DateTimeFormat/prototype/format, top-level filenames containing
`temporal`: 19 fixtures, 32 passing executions, six failures, zero unsupported
fixtures (2fae75). Both script modes ran with original harness includes and an
explicit completion sentinel on Node 26.8.1. This selection does not cover the
other DateTimeFormat fixtures.

Both modes fail these original fixtures with RangeError (fc0555):

- temporal-objects-no-time-clip.js
- temporal-objects-no-time-clip-weekday.js
- temporal-objects-no-time-clip-non-latin-numerals.js

The inspected original no-time-clip fixture requires formatting valid plain
Temporal values outside Date's TimeClip range, including PlainDate's earliest
day, PlainDateTime endpoints and PlainYearMonth endpoint months. It checks
calendar fields, not merely the absence of an exception.

Independent minimal probes (20f7e1) reproduced failures for
`new Intl.DateTimeFormat('en', {calendar:'gregory'}).format(value)` with:

- `new Temporal.PlainDate(-271821, 4, 19, 'gregory')`
- `new Temporal.PlainYearMonth(-271821, 4, 'gregory')`

SafeJS and temporal-polyfill/full/implementation throw RangeError. Native
Node 26.8.1 also throws for both probes. Therefore replacing the backend with
that native formatter is not a demonstrated fix. Successful focused ordinary
date formatting must not be used to dismiss this boundary failure.

## Implementation path and required repair

Current Temporal Intl amendments were checked directly in the primary
[specification source](https://github.com/tc39/proposal-temporal/blob/main/spec/intl.html)
(42bfa2). HandleDateTimeTemporalDate and HandleDateTimeTemporalYearMonth combine
the private ISO date with noon and retain epoch nanoseconds as a plain value;
they do not apply TimeClip. HandleDateTimeOthers explicitly applies TimeClip
to numeric inputs. A repair must preserve that distinction rather than relax
numeric-Date validation. The relevant published anchor is
`sec-temporal-handledatetimetemporaldate`, not `sec-handledatetimetemporaldate`.

Source inspection of interp/intl-datetimeformat.ts (d4e0dd) shows that owned
Temporal inputs are converted through private fields into backend Temporal
values and passed to BackendIntl.DateTimeFormat. The failure is downstream of
the new month-day/year-month admission, not evidence that those brands should
be rejected or their legal ranges narrowed.

After the active unchanged package candidate finishes, add focused failing
unit regressions for legal endpoints, field/weekday correctness, numbering
systems, parts and ranges. Check current normative behavior before choosing
the repair. Preserve non-ISO calendars, requested components, eras and locale
ordering; clamping to Date's range or substituting Gregorian output is not a
complete implementation. Keep invalid inputs rejected.

## Locale-method boundary probes

Six direct guest probes on Node 26.8.1 (c7ea7e) independently separate valid
construction/ISO formatting from locale failures. Every value constructs and
toString succeeds; toLocaleString('en', {calendar:'gregory'}) produces:

| Private ISO value | Locale result |
| --- | --- |
| PlainDate -271821-04-19 | RangeError |
| PlainDate +275760-09-13 | 9/13/275760 |
| PlainDateTime -271821-04-19T00:00:00.000000001 | RangeError |
| PlainDateTime +275760-09-13T23:59:59.999999999 | RangeError |
| PlainYearMonth -271821-04, reference day 1 | RangeError |
| PlainYearMonth +275760-09, reference day 1 | 9/275760 |

These are four reproduced failures and two passing controls, not a claim that
every endpoint fails. The guest catches the locale exception, so successful run
completion is not counted as successful formatting. The first verbose probe's
output was truncated; c7ea7e reran the same cases with only relevant results.
Source inspection (b48c03) confirms these public locale methods call backend
Temporal locale methods separately from direct Intl admission; a complete
repair must cover both entry paths.

## Ongoing qualification

The matching `formatRange` selection completed: 14 fixtures, 24 passing
executions, four failures, zero unsupported (064b93). Both script modes fail
temporal-objects-no-time-clip.js and temporal-objects-no-time-clip-weekday.js.
The same-revision `formatRangeToParts` selection completed in session 57322:
15 fixtures, 26 passing executions, four failures, zero unsupported (08e2ce).
Both modes fail the same two no-time-clip fixtures (8b6774). These results cover
only filenames containing `temporal`, not the complete Intl directories.

Backend source inspection narrows the cause (23900c, 209b22, a2096c):
chunks/classApi.js converts private Temporal values with
temporalDateTimeToEpochMilli; chunks/internal.js computes a numeric epoch and
passes that number to native format/formatToParts/formatRange/formatRangeToParts.
The plain date conversion uses epoch-day arithmetic but does not remove the
native numeric formatter's range restriction. This explains why extending the
owned allocator's legal range cannot repair formatting. No node_modules edits
were made. The candidate fingerprint is still unchanged (7761c5).

The similarly selected formatToParts run is live in session 87723; it includes
two large calendar-consistency fixtures. No final outcome is available yet.
The full default-Node package gate remains live in session 26401 (1a7fa6).
No implementation/test sources changed during these probes. This is a validated
open gap, not a fix or delivery claim. No push or release was performed.

## Completed formatToParts qualification

The preceding live-process statements describe the historical observation,
not current process state. Session 87723 has now completed with exit 0
(dd532d): 14 selected fixtures, 24 passing executions, four failed executions,
zero unsupported. The runner reports assertion failures in its summary rather
than process status; exit 0 is therefore not a passing qualification.

Both strict and non-strict executions of
`temporal-objects-no-time-clip-weekday.js` and
`temporal-objects-no-time-clip.js` fail with RangeError (4e1022). The selection
uses filenames containing `temporal` in the top-level formatToParts directory
at test262 revision 419d3e0a2273ba01a3bfcbec423f2801425b8e93 on Node 26.8.1.
It is not the full Intl402 suite. The process loaded the pre-Now candidate;
later working-tree changes are not covered by this result.

The package gate also completed earlier and remains failing; its terminal
results are in `safejs-post-year-month-integration-gate.md`. No upstream
qualification process remains pending from this formatToParts run. Extreme
range behavior still requires a repair across all four Intl formatting entry
points and the separate Temporal locale methods. No release or push follows.
