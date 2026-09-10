# ISO locale month data: repair constraints

## Validated current failure

The completed default-Node package gate has six month-day/year-month locale
failures, recorded in safejs-post-year-month-integration-gate.md. They remain
open after the independent Temporal.Now addition.

A fresh native formatToParts probe on Node 22.23.2 (b2f044), with UTC and
2000-02-29, compares ISO and Gregorian calendars in en-US, pl-PL and ru-RU.
For ISO long month/year, the parts contain only year and a trailing space.
Long month/day contains only a leading space and day. Standalone long month
returns an empty parts array. There is no empty month part to replace.
Gregorian formatters return month data on the same runtime.

## Why copying Gregorian parts is insufficient

The same ISO probe on patched Node 26.8.1 (fe7e3a) produces these month forms:

| Locale | ISO long month/year | Gregorian long month/year on Node 22 |
| --- | --- | --- |
| en-US | 2000 February | February 2000 |
| pl-PL | 2000 lutego | luty 2000 |
| ru-RU | 2000 февраля | февраль 2000 г. |

For Polish/Russian ISO month/day, month precedes day and is inflected; Gregorian
patterns put day first. Standalone month uses a different grammatical form.
Therefore neither appending a standalone month name nor copying the entire
Gregorian parts list preserves the observed ISO calendar formatting behavior.
The Node 18 versus Node 26 ordering difference is already recorded elsewhere;
these observations are runtime-specific, not universal CLDR output constants.

A separate patched-runtime era probe (0b51db) finds ISO/Gregorian output
differences for years -1, 0, 1 and 2000 as well. These differences must not be
silently overwritten by a calendar substitution. This probe is not itself a
normative ruling on which era output is correct.

## Next repair requirements

Use maintained locale/calendar data or a formatting implementation that can
represent the requested ISO pattern and grammatical context. Verify month widths,
standalone versus formatted context, numbering systems, calendar compatibility,
format/parts/ranges, locale methods, requested/resolved options and replay.
Keep non-ISO calendars on supported paths rather than replacing all Intl with
a Gregorian-only implementation. Do not remove the six failing tests, change
the default runtime or claim that a native expected-value assertion is a fix.

No dependency, runtime source or test source changed during these probes. This
record rejects incomplete repair strategies; it does not claim a repair.

## Primary-source clarification during the post-source-identity gate

The [CLDR 46 release notes](https://cldr.unicode.org/downloads/cldr-46) document
the addition of root ISO-calendar patterns, using localized names with their own
initially unlocalized separators. The pinned
[CLDR 48 root data](https://raw.githubusercontent.com/unicode-org/cldr/release-48/common/main/root.xml)
has an ISO-calendar month-name alias to Gregorian names but independent date
patterns: `yMMMM` uses `y MMMM`, and `MMMMd` uses `MMMM d`. This supports reusing
the appropriate month-name data, not replacing the entire formatted result with
Gregorian ordering. CLDR distinguishes format and standalone name contexts;
see [date/time patterns](https://cldr.unicode.org/translation/date-time/date-time-patterns).

A fresh native-only probe on Node 22.23.2 / ICU 78.2 confirmed all three affected
forms for en-US, pl-PL and ru-RU. A long month alone yields no parts; year/month
yields the year and a trailing space; month/day yields a leading space and day.
`resolvedOptions()` still reports `month: long`. Thus a repair must restore an
absent field, not replace an empty existing month part.

Next implementation candidate: a maintained ISO pattern/name-data path that
resolves the month-name alias with its required grammatical context and preserves
the requested ISO layout. Any candidate must still satisfy the earlier range,
locale, numbering-system and calendar checks. No new dependency or runtime
change was made during this research; the full package gate remains running.
