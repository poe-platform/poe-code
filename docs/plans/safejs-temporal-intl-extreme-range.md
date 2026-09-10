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

## Ongoing qualification

The matching `formatRange` selection completed: 14 fixtures, 24 passing
executions, four failures, zero unsupported (064b93). Both script modes fail
temporal-objects-no-time-clip.js and temporal-objects-no-time-clip-weekday.js.
The same-revision `formatRangeToParts` selection has 15 fixtures and is live in
session 57322. It has emitted the same four failures (8b6774); no final totals
are available yet. Do not count a started fixture or silent interval as a pass.

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
