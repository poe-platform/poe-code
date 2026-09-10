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

## Direct guest-API regression

New uncommitted tests exercise standalone long month names through guest
`Intl.DateTimeFormat.formatToParts`, `Temporal.PlainMonthDay.toLocaleString` and
`Temporal.PlainYearMonth.toLocaleString` for en-US, pl-PL and ru-RU. All three
locale cases fail on Node 22.23.2: Intl returns an empty parts array and both
Temporal methods return empty strings. The same tests pass unchanged on cached
Node 26.8.1 / ICU 78.3, producing February, luty and февраль respectively.
All three cases also pass unchanged on supported Node 18.20.8.

These assertions avoid the existing year/month test's native expected-value
precondition: they validate actual guest results against known standalone names.
They do not assume a universal year/month ordering across CLDR versions.
No runtime workaround has been added; the full-package run is still active.

## Width controls and extraction feasibility

The expanded standalone guest regression covers all five month widths in the
same three locales. On Node 22.23.2 it reports 12 passes and three failures:
numeric, two-digit, short and narrow work across all three guest APIs; only
long names disappear (focused run c5a2e7). This narrows the repair investigation
to wide-name resolution rather than absence of all ISO month data. The initial
attempt from the package directory could not load root test setup and ran no
tests; the reported result uses Vitest from the repository root.

Read-only inspection of the published `cldr-dates-full@48.2.0` tar archive
finds only `ca-generic.json`, `ca-gregorian.json`, `dateFields.json` and
`timeZoneNames.json` under `main/en`, and no ISO-named paths anywhere in the
archive. The generic calendar's wide month names are M01 through M12, not
localized Gregorian names. Therefore installing this package alone does not
provide the previously proposed direct ISO-pattern extraction source. Its
registry metadata reports 94,909,291 unpacked bytes; no dependency was added.

Next, evaluate whether native working-width parts can locate the missing field
without changing ISO layout, and separately resolve the required wide-name
grammatical context. Do not assume short and long patterns or range collapsing
are interchangeable: validate those boundaries before adopting this route.

## Rejected working-width substitution and range regression

A read-only Node 26.8.1 probe used the 662 supported locales from installed
CLDR units locale directories, eight component combinations, two date pairs
(same month and different months), and single/range parts. Replacing short
ISO month parts with Gregorian wide-name parts differed from native long ISO
output in 4,435 of 21,184 comparisons (f183a9). This is a comparison against
the patched runtime, not an exhaustive or normative conformance count.

For example, Afrikaans month/hour long formatting uses the literal ` om `,
where short formatting uses a space; month/era long formatting includes a
localized month label that short formatting omits. Thus even correctly sourced
month names cannot make wholesale short-part substitution sound.

The affected Node 22 runtime also collapses different-month long-name ranges:
February–March month-only parts are empty, and year/month parts contain only
the shared year and space. Retaining broken long-range parts and inserting
names cannot recover the correct range structure by itself.

Three new guest regressions require both range month names with start/end
source attribution and agreement between range text and concatenated parts.
The full focused file now has 12 passes and six failures on Node 22 (79691b),
and all 18 pass unchanged on Node 26.8.1 (ae92db). Runtime code is unchanged.
The next repair candidate must provide long-pattern selection and range
partitioning, not only month-name lookup. The direct short-part replacement
candidate is rejected.

## Published formatter capability check

The current FormatJS main-branch documentation advertises ISO calendar support,
but registry latest `@formatjs/intl-datetimeformat@7.6.1` does not provide it.
A read-only in-memory probe loaded its published engine with AST-resolved
imports and JSON-parsed en/pl/ru/af locale registration arguments. No global
Intl replacement, package installation or filesystem extraction was performed.
Every ISO request resolved to Gregorian, and year/month ordering followed
Gregorian patterns (f5301c, 4c406f). The published engine's `ToLocalTime`
explicitly requires Gregorian (dd8e67). Therefore this version is not an
ISO-preserving repair, irrespective of newer main-branch documentation.

Range regressions now also assert `resolvedOptions().calendar === 'iso8601'`
to reject a calendar-substitution implementation that merely restores names.

## Published ICU4X capability check

The published `icu@2.3.2` package was inspected and executed read-only in memory
on Node 22.23.2 (761e42). Its registry reports 23,272,786 unpacked bytes; the
archive contains a 20,547,922-byte WebAssembly module. The probe instantiated
that module with its required logging/error imports and loaded the unchanged
JavaScript bindings through VM modules. It did not install a dependency, alter
global Intl, or extract package files into the checkout.

`CalendarKind.create` reports `Iso` for en-US, pl-PL, ru-RU and af with the
`u-ca-iso8601` extension. Nevertheless, long year/month formatting of February
2000 yields `February 2000`, `luty 2000`, `февраль 2000 г.` and `Februarie 2000`:
these do not preserve the ISO root year-first layouts under investigation.
The standalone long month outputs are localized correctly, but February–March
standalone ranges contain `M02` and `M03` in English and Afrikaans. Russian
month/day and year/month/day ranges also contain those placeholder names.
The package does expose date and date/time range formatters; their formatting
methods return strings. Inspection of all 50 date/time declaration files finds
no formatting-to-parts method, leaving field identity and range-source
attribution unavailable through this public interface.

This rejects the published package as a drop-in repair for the current gap,
not ICU4X as a general-purpose library. A positive calendar-kind check and
correct standalone month text are insufficient qualification. No runtime
change was justified by this candidate.

Sources: [published package](https://www.npmjs.com/package/icu/v/2.3.2),
[Unicode's JavaScript date-formatting tutorial](https://icu4x.unicode.org/2_2/tutorials/date-picker/).
The [January 2026 ECMA-402 meeting notes](https://raw.githubusercontent.com/tc39/ecma402/main/meetings/notes-2026-01-08.md)
also discuss preserving ISO field order, separators and hour-cycle conventions.
Their recommendation to CLDR is not an enacted normative requirement and is
not presented here as one.

The full package gate recorded elsewhere has now terminated with 14 failures;
the earlier in-progress statements above are historical. The ISO failures
remain unresolved. Next investigate an ISO pattern/data implementation with
explicit parts and range partitions; neither tested published formatter is
sufficient on its own.

## Source-version and name-extraction qualification, September 10

FormatJS commit
[406fca5a8de51906f85e2f956e2cadfeabc3e3eb](https://github.com/formatjs/formatjs/commit/406fca5a8de51906f85e2f956e2cadfeabc3e3eb)
adds ISO negotiation, but explicitly shares Gregorian patterns with ISO. The
source assigns `processedData.formats.iso8601 = processedData.formats.gregory`.
This is source inspection, not execution of the unpublished engine. It does
not meet this repair's ISO-layout requirement; newer advertised calendar support
does not reverse the earlier published-package rejection.

A fresh read of CLDR release-48 XML (36d062) finds the ISO calendar node in
`root.xml`, but not in `en.xml`, `pl.xml`, `ru.xml` or `af.xml`. The root aliases
month names to Gregorian data while retaining independent patterns, including
`y MMMM` for year/month and `MMMM d` for month/day. Its standalone abbreviated
month skeleton uses `LLL`; interval data separately defines `LLL–LLL` and
`y MMMM–MMMM`. This five-file inspection does not prove that all locales lack
ISO overrides. Root-only pattern synthesis remains unqualified.

The proposed native Gregorian **field-name lookup**, independently of whole
pattern substitution, also fails qualification. Read-only native probes on
Node 26.8.1 / ICU 78.3 used all 662 supported locale directory names from
installed `cldr-units-full/main`, every month of 2000 (day 15, UTC), and three
text widths. For standalone context, they compared the ISO month-only part
with the Gregorian month-only part. For format context, they compared the ISO
year/month part with the Gregorian month/day part. No guest code or global
Intl replacement was involved.

| Width and context | Comparisons | Different month values |
| --- | ---: | ---: |
| Long standalone | 7,944 | 60 |
| Long format | 7,944 | 220 |
| Short standalone | 7,944 | 66 |
| Short format | 7,944 | 420 |
| Narrow standalone | 7,944 | 24 |
| Narrow format | 7,944 | 191 |
| Total | 47,664 | 981 |

Evidence: a33c26 and the context-grouped follow-up 885d62. Greek January
standalone is `Ιανουάριος` for ISO but `Ιανουαρίου` for Gregorian, despite both
resolving to long month width. For Buriat (`bua`), Gregorian month/day resolves
the requested long month to two digits, whereas ISO year/month supplies
`нэгэдүгээр һара`. Thus checking the Gregorian resolved width would catch some
failures, but would not fix grammatical-context mismatches such as Greek.
These are comparisons with a patched runtime, not universal normative locale
constants or a conformance pass count.

Do not implement native Gregorian month-only/month-day extraction as a complete
ISO name-data provider. The next candidate needs explicit CLDR format and
standalone names with alias/inheritance resolution, as well as pattern matching
and interval partitioning. No dependency or runtime code changed in this
qualification. Existing failing regressions remain intact. No screenshots are
needed for this nonvisual research record; publication remains on hold.
