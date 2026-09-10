# Temporal time-zone string conversion

## Confirmed gap

Built guest a2d149 rejected valid time-only, year-month and month-day strings
as Instant.toString timeZone inputs. The same backend conversion is used in
Duration relativeTo.timeZone bags. New public tests failed ten cases (c63b51),
including accepting the invalid date 2020-02-30[UTC]. This is not only missing
syntax; extraction must validate the date/time and annotations before using a
bracketed zone.

The alternative @js-temporal/polyfill 0.5.1 was tested in an isolated temporary
directory, not installed in the repository. Its constructor and
Instant.toZonedDateTimeISO rejected the missing forms (b01a5b/00dd99), so adding
it would not repair this gap. No dependency or node_modules patch was retained.

## Normative requirements

[ParseTemporalTimeZoneString](https://tc39.es/proposal-temporal/#sec-temporal-parsetemporaltimezonestring)
first parses a TimeZoneIdentifier, then the union of complete date/time,
Instant, time-only, month-day and year-month strings. A bracketed zone wins over
Z, which wins over a numeric offset. Absence of all three is an error. Numeric
offsets selected as identifiers must have minute precision, even if sub-minute
offsets are valid inside the surrounding date/time syntax.

[ParseISODateTime](https://tc39.es/proposal-temporal/#sec-temporal-parseisodatetime)
validates Gregorian calendar dates without imposing Temporal value range limits,
allows clock leap seconds, checks annotation order and critical flags, and
requires ISO calendar annotations for partial dates. Unknown noncritical
annotations can be ignored after their syntax is checked; their count has no
arbitrary limit. A syntactically valid IANA-style name must subsequently be
checked for availability, not silently reparsed as another format.

## Implementation and controls

The standalone regex-free parser implements these string forms and returns a
syntactic zone identifier. Existing backend IANA resolution validates names.
Instant formatting and Duration relativeTo.timeZone share it; guest inputs stay
primitive-only and input length is charged before parsing. No public Temporal
objects are delegated to a host parser, and the five missing Temporal classes
remain missing rather than being simulated through this operation.

Tests cover signed years beyond value limits, leap years, time/date ambiguity,
mixed separators, minute versus sub-minute offsets, annotation precedence,
unknown calendars, duplicate/critical annotations, and availability separation.
Initial focused integration passed 102 tests (801019); parser/public selection
passed 90 (9bcb13), with scoped lint passing (0dc89f). Selections overlap.

## Native discrepancies — do not copy blindly

Node 26 accepts T1234+0100 and T12Z as clock-like zone inputs (ef48c3), although
they match the named TimeZoneIdentifier grammar that the specification tries
first. The parser preserves these syntactic names; IANA availability checking
then rejects them. T1234+01:00 includes a colon and therefore unambiguously takes
the ISO time route. The public control was corrected to use that form.

Two initial expectations treated 2020-0101[UTC] and 202001-01[UTC] as malformed
dates. They are also valid undesignated times with offsets (20:20 -01:01 and
20:20:01 -01). The current grammar's early-error test applies to the complete
time-plus-offset substring; neither is a valid DateSpecYearMonth/MonthDay.
The raw specification confirms this (732a27). Node 26 rejects them (fd7dce),
but those native results do not justify rejecting the grammar's valid time
alternative. Controls now require a following T00:00 to test genuinely invalid
date separators, and retain explicit positive tests for the time alternatives.

This is focused string-conversion work, not full Temporal/JavaScript conformance.
The parser can be committed independently; public integration remains within the
larger uncommitted Temporal change. Releases and pushes remain held.

## Qualification

Minimum Node 18 selection passed 102 tests (ae878c). The broader Temporal,
private-value, snapshot and lint selection passed 933 with four native-only
skips across 49 files (07317f). Selected workspace build 3ba8ac passed 23 tasks
and all five fresh ESM import checks. These are working-tree checks, not clean
commit or full-package conformance claims.

A rebuilt guest/native Node 26 matrix covered 144 combinations (0a9689): 137
matched. Six differences were time-only Z strings, which the current
TemporalTimeString grammar excludes through DateTimeUTCOffset[~Z]; native
accepts them. The other was 202001+01:30, a time-plus-offset string that does not
match the complete partial-date productions but native rejects. Keep these
explicitly classified differences rather than claiming 144 passing comparisons
or changing the parser to fit the native result.

Built CLI validation on Node 18 (1f3fea) returned the expected clock shifts for
time, year-month, month-day and annotation-precedence inputs, and rejected the
invalid February date. Its screenshot was captured and visually inspected:
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-zone-parser.QlO9K3-zone-strings.ajs.png`.
