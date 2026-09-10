# Instant formatting with ZonedDateTime time-zone options

## Validated gap

The pending Instant formatting adapter rejected every non-string `timeZone`,
including owned ZonedDateTime objects. TC39's
[ToTemporalTimeZoneIdentifier](https://tc39.es/proposal-temporal/#sec-temporal-totemporaltimezoneidentifier)
requires reading an initialized ZonedDateTime's private time zone before the
string-only check. Node 26.8.1 independently confirms the expected UTC,
fixed-offset and America/New_York output, even with throwing public accessors.

Before the fix, the focused regression file had three failing accepted-value
cases and one passing guest unbranded/proxy rejection case. An initial raw host
Proxy probe was replaced with a guest Proxy test: passing a raw host proxy
directly into an internal adapter does not represent the supported guest path.

## Change

Read the owned ZonedDateTime private time zone before existing string parsing.
Do not coerce arbitrary objects, read shadowed public fields, or accept proxies
and objects merely inheriting from a ZonedDateTime. Include a guest subclass
case with a non-ISO calendar; neither that calendar nor its epoch selects the
Instant being formatted.

This commit also brings the previously uncommitted Instant formatting adapter
and its existing rounding/option-order tests under version control. Public
Temporal namespace integration remains unfinished and uncommitted.

## Validation

- Before fix: 3 failed, 1 passed (696b3d).
- After fix: focused Instant formatting/rounding/time-zone cohort, 146 passed
  across 5 files (2fafc4), before adding the final guest-subclass test.
- Node 18.20.8: all 5 final regression cases passed (1ad535).
- Final Node 22 cohort with the subclass test: 147 passed in 5 files (ddb207).
- TypeScript package check passed (e0d026).
- Focused ESLint for the formatter and both test files passed (25656b).

No locale-calendar substitution was applied. Fresh native probes confirmed that
ISO month names are still missing with full date fields, `dateStyle: 'long'`
and `formatMatcher: 'basic'` in en-US, en-GB, pl-PL and ru-RU (73e399).
That separate limitation and the full-package gate failures remain open.

No push or publication is authorized during the release hold. This internal
runtime correction has no visual CLI impact.
