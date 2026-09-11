# ZonedDateTime formatting: auto unit validation order

## Validated issue

The current shared string-option reader rejected `smallestUnit: "auto"`
before reading `timeZoneName`. Native Node 26.8.1 reads that option before
rejecting the recognized but disallowed unit. In particular, a getter's
exception must propagate instead of being replaced by the unit RangeError.

The [Temporal toString algorithm](https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.tostring)
reads the unit in step 9, reads the zone display in step 10, and validates
the unit category in step 11. Unknown unit strings fail during step 9.

## Change

Allow exactly `auto` through the initial recognized-unit check when reading
zoned formatting options. The existing later check still rejects it after
reading and coercing `timeZoneName`. Do not recognize `autos`; it is not a
plural Temporal unit. PlainTime and PlainDateTime validation is unchanged.

## Evidence

- Before the change: two new regressions failed, seven controls passed.
  Failures showed the missing getter/coercion and suppressed thrown sentinel.
- After the change: 83 tests passed across the new option-order file and
  ZonedDateTime, PlainDateTime, PlainTime, and Instant formatting files.
- Node 18.20.8: all nine new regressions/controls passed with no skips.
- Package TypeScript check (`tsc --noEmit`) and focused ESLint passed.
- Native Node 26.8.1: `auto`, `day`, and `hour` read `timeZoneName` before
  RangeError; `autos` and `unknown` throw without reading it.

These are current-working-tree checks, including pending Temporal namespace
and ZonedDateTime integration; they do not establish standalone committed
HEAD completeness or a green full suite. No CLI appearance changes.

## Delivery

Atomic local fix only. Pushes and releases remain paused; no issue closure
or remote-main delivery is claimed.
