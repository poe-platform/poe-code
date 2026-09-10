# Intl fixed-offset zones on the minimum Node runtime

## Reproduction

The same built guest program, using
`new Temporal.PlainTime(12).toLocaleString('en-US', {timeZone:'+01:00',hour:'numeric'})`,
returns RangeError on Node 18.18.2 but 12 PM on Node 26.4.0. Native Node 26 also
returns 12 PM (897eeb). This is a valid option even though PlainTime ultimately
ignores the zone for its wall-clock output.

[CreateDateTimeFormat](https://tc39.es/proposal-temporal/#sec-intl-createdatetimeformat)
accepts fixed-offset zone identifiers, parses offsets without sub-minute
precision, and canonicalizes them. The current ordered guest option reader
validates zones by constructing the host Intl.DateTimeFormat, so older ICU/V8
support leaks into the guest API.

Switching blindly to the maintained Temporal Intl backend is not a fix. A
Node 18 probe of its DateTimeFormat with +01:00, +05:30 and -23:59 failed for
numeric, Instant and PlainTime inputs alike (all nine cases, d83fb6). The backend
still delegates that option to host Intl.

## Required implementation and verification

- Preserve ordered guest option reads and validation-before-later-getters.
- Parse the specified offset grammar strictly, without regular expressions.
  Prefer maintained parsing facilities only when they validate that grammar.
- Preserve exact clock shifts, local date boundaries and resolvedOptions zone
  canonicalization for numeric dates and Instants.
- PlainTime retains its wall-clock fields and excludes zone-name output while
  still rejecting invalid zone syntax.
- Cover locale-specific zone names and digits, both parts and range methods,
  rather than replacing a formatted suffix with an English-only string.
- Persist any added formatter state through validated snapshots and account for
  private state in the budget; keep historical snapshot compatibility explicit.
- Run failing regressions on Node 18 before implementing; compare against
  independent expected shifts and supported native Node controls afterward.

## Strict validation and PlainTime locale progress

The original investigation was read-only during full test session 40015. That
session has finished; subsequent source changes invalidate its fingerprint as
the current gate. Do not increase the supported Node minimum or silently reject
valid offsets to make a check green.

Current [UTCOffset grammar](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-time-zone-offset-string-format)
requires ASCII signs. Node 26 accepts U+2212 minus, but that is not the standard
used here. A candidate using temporal-polyfill's ZonedDateTime parser failed
the new malformed-minute regression: it accepts +01:60 as +02:00, +0160 as
+02:00, and +00:99 as +01:39 (8d5707). That candidate was replaced, not retained.

The strict bounded parser now accepts only ±HH, ±HHMM and ±HH:MM, validates
ASCII digits and hour/minute ranges, and canonicalizes negative zero. Its unit
tests cover every valid minute offset in both signs and both minute syntaxes,
hour-only syntax, malformed inputs and named-zone delegation. Test-first module
failure: 19dcb8. Shared ordered option reading uses this parser before later
guest getters; IANA names retain host validation.

PlainTime.toLocaleString now discards the already-validated time zone before
invoking older host formatters. It retains timeZoneName for style-conflict
validation and preserves locale, calendar and numbering-system behavior. The
Node 18 test-first run failed eight regressions (08934e); after the strict parser
and locale integration, 76 selected parser/PlainTime/Instant locale tests passed
on Node 18.18.2 (075969). The six-file Node 22 selection passed 201 tests
(ea1bc0); 62 parser/PlainTime locale tests passed on Node 26 (e903bc). Scoped
lint passed (950e20). These selections overlap and are not a full package gate.

A broader Node 18 selection (4696a8) also exposed five other failures after
separating the now-fixed malformed-minute case: numeric Date offset support,
reversed Temporal ranges, and three assertions comparing current specified
option order to older native behavior. Keep these as explicit follow-up work;
do not report that selection as passing or copy old native order into the guest.

Numeric Date/Instant and direct Intl constructor/parts/range offset formatting
remain unresolved on older hosts. This parser is a foundation, not full offset
support. In particular, timestamp shifts alone do not solve localized zone
names, non-Gregorian calendars or valid endpoint values crossing the native Date
limit after applying an offset. PlainTime locale integration remains part of
the larger uncommitted Temporal implementation. No push or release.

Final selected workspace build passed all 23 tasks and five fresh ESM import
checks (c899e0). Built CLI validation on Node 18 (a7d198) produced unchanged
wall-clock output for +05:30, -23:59 and -00:00, and RangeError for malformed
minutes, seconds and Unicode minus. The same CLI output was captured and visually
inspected in `screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-offset-qa.gDRdF7-offset.ajs.png`.
The atomic parser/ordered-validation commit intentionally excludes the larger
uncommitted PlainTime public integration; its build and integration evidence
describe the working tree, not a clean-checkout full gate for that commit.
