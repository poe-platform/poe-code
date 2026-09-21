# Independent formatter stress findings

The independent reviewer validated the shared formatter against the separate Gnumeric 1.12.61 oracle using the root's captured GOffice/plugin profile, C locale and UTC. Original formula TEXT fixtures and captured output bytes/hashes are reduced in `number-format-independent-profile.json`; procedure is `../plans/ssconvert-formatting-independent-qa.md`.

Validated repairs used failing in-memory tests before code changes:

- Decimal binary64 rounding no longer pre-rounds positive-precision inputs by multiplication. Native TEXT(2.675,"0.00") yields `2.67`; previously the product returned `2.68`.
- Explicit decimal separators remain visible when fractional placeholders are optional or absent: `0.` on 12 yields `12.`, `#.##` on zero yields `.`.
- Integer-only optional placeholders preserve native zero: `#` and `?` yield `0`; `??` yields space followed by `0`.
- Conditional sections now follow GOffice's sign inhibition and implicit numeric fallback rules. `[<0]0;0` on -12 yields `12`; `[>=10]0;0` retains `-12`.
- Negative elapsed values below one whole second retain fractional digits without a negative zero sign: `[h]:mm:ss.000` on -0.0000001 yields `0:00:00.009`.
- String TEXT applies real `@` placeholders, quoted prefixes/suffixes, repeated substitution and an empty fourth section. Numeric masks, literal-only masks and escaped `@` retain the input string.

The final corrected numeric stress cohort contains 45 cases, including grouping, engineering notation, explicit/variable fractions, elapsed and fractional times, escaped literals, conditional selection and scientific carry. All 45 match captured bytes after repairs. The separate 10 string cases also match. Three additional scientific carry cases match without requiring a carry repair. The first two exploratory cohorts remain recorded separately: initial A11/A17 had invalid formula-string quote encoding, and initial escaped E/e/m lacked doubled Gnumeric formula backslashes. Those observations are fixture defects, not semantic product passes or repair evidence.

The independent test file has 39 tests, including a cancellation regression. A focused run with maintained formula TEXT/general regressions passed 284 tests. Maintained workspace lint exited 0; concurrent root locale work temporarily left one unused `rendered` import warning, reported to root. Root retains uncached maintained build/test, final lint, integration and Git ownership.

This cohort does not measure finite-font preserve fill/padding, arbitrary locales, themes/styles serialization, all malformed grammars, arbitrary currency/date locale tags, localized month names, numeral shaping, arbitrary rich text, or all precision/round-trip boundaries. Existing explicit unsupported grammar remains unsupported. These gaps are not passes, and unlimited-width TEXT measurements do not establish finite-font preserve display parity.

## Independent SDK text-selection follow-up

Two native automatic-export cohorts contain 15 cases, recorded separately in the profile JSON. Original SDK-only `cell-text-independent.test.ts` adds 23 tests. Eight initially failed: five repeated-width elapsed cases, standalone AM/PM and A/P detection, and UTF8 pattern admission. Repeated-width elapsed formats incorrectly selected calendar dates; native 1.125 with `[hh]:mm:ss`, `[mm]:ss`, `[ss]` or `[hhh]:mm:ss` emits `27:00:00`. Standalone AM/PM and A/P on .5 emit `12:00:00`. Pattern `"€€"0` occupies nine UTF8 bytes but five UTF16 units and was incorrectly admitted under a six-byte pattern cap. Root owns these fixes.

Fifteen initial follow-up checks passed: quoted/escaped date letters do not imply dates; rounded date, phantom serial and out-of-range fallbacks match native; captured display is used only in preserve mode; cached numeric values feed raw/automatic rendering; German punctuation and error bytes match captured root oracle profiles in all three modes; injected formatter output remains byte-bounded; cancellation after an injected formatter resolves preserves the exact borrowed reason. These checks do not establish stale-display invalidation across every workbook operation or command lifecycle; root retains engine/integration ownership.

After root repaired elapsed-width recognition, AM/PM and A/P detection, and UTF8 pattern admission, the independent reviewer re-ran both independent test files: all 62 tests passed (39 formatter tests plus 23 cell-selection tests). No remaining mismatch appears in these measured cohorts. Root separately verified and repaired DOLLAR's rounded negative-zero sign against fresh native evidence, and corrected the exact older zero-placeholder and uncaptured-locale assertions after the measured behavior changed. Those root-owned full-workspace checks remain separately reported by root.

## Latest-candidate bounded recheck

The original 62 independent cases remained green after root's later optional/mandatory fractional digit and explicit German scalar-matching repairs. Ten fresh native fractional cases (`#`, `?` and `0` mixed after the decimal separator) all matched. Eight of nine fresh German string TEXT cases matched, including grouped decimal strings, mandatory/optional digits, localized booleans and nonnumeric dot-spelled strings.

One fresh regression failed: German TEXT("1.234,50","\"x\"@") first matches the string as a number; native renders numeric General `1234,5`, ignoring the text-only mask, while the candidate threw unsupported-feature for `"x"@`. This failure was reported to root before any product changes; the independent test file contains the concrete failing regression. Both latest native cohorts exited zero without diagnostics; the German cohort used the isolated root LOCPATH. Case/output bytes and fixture hashes are recorded under `mixed-fraction` and `german-strings` in the profile JSON.

Root repaired numeric General fallback for text-only masks; all 81 independent cases then passed. A further bounded nine-case native cohort measured exact halves and long precision. The six halves confirm native rounding away from zero: 2.5→3, 3.5→4, -2.5→-3, -3.5→-4, .125→.13 and .375→.38. These already matched the candidate. Three fresh high-precision cases failed: 1e-110 with 110 or 115 fractional zeros and 1.234e-110 with 115 fractional zeros incorrectly lost every nonzero digit after the JavaScript toFixed 100-digit cap. Native retains the digits at positions 110–113. Concrete failing tests were added and reported before root repairs. The `halves-precision` profile record retains actual bytes and hashes; native exited zero without diagnostics.

After root implemented exact binary64 rational rounding for long precision, the independent reviewer reran both independent suites: all 90 cases passed (67 formatter tests and 23 cell-selection tests). No remaining mismatch occurs within the recorded corrected native cohorts. This final scoped result does not broaden the documented unmeasured grammar, locale, finite-font display, serialization or lifecycle coverage.
