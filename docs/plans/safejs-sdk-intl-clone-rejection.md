# SDK structured-clone Intl private brands

## Validated gap

The SDK structured-clone copy path accepted Intl private-state objects that the
guest structured serializer rejects. Ten constructor cases failed before repair
(9e07fb); the expanded matrix had eleven failures and one passing ordinary-
record control (223054), including the Segmenter segments object.

Reject the existing private brands before treating these objects as records:
Locale, Collator, DateTimeFormat, DisplayNames, ListFormat, NumberFormat,
PluralRules, RelativeTimeFormat, Segmenter, its segments result, and
DurationFormat. Do not infer these brands from the prototype chain. Tests check
direct/nested values and null prototypes; an ordinary object inheriting an Intl
prototype must still clone as an ordinary record.

## Verification

- Node 22: all 171 tests in the 15 filename-selected structured-clone files pass.
- Package TypeScript no-emit checking passes.
- Node 18.18.2: all twelve new cases pass.
- Focused lint passes for values.ts and the new regression file.

The guard changes only structured-clone admission, not ordinary copying or
Intl formatting. It does not fix the separate extreme-date and locale failures,
nor prove full structured-clone or JavaScript conformance. Only the Intl guard,
its regression file and this plan are staged; other values.ts changes and
unrelated staged Safe Bash work remain untouched. Local commit only under the
release hold, with no push, release or issue closure. No CLI appearance changes.
