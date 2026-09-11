# Intl year-month admission

## Validated gap

All five new tests failed before implementation (292008). DateTimeFormat
attempted primitive coercion of owned year-months, read public shadows, rejected
valid formatting/ranges and failed the mixed-operand observation-order check.

## Change

Include owned PlainYearMonth in the existing Temporal input predicate. Select
the same-kind predicate for ranges and reconstruct backend values solely from
private ISO year/month/reference-day/calendar fields. Reuse the formatter's
existing requested-options and calendar/component validation paths.

## Verification

All 19 selected year-month/month-day/Temporal formatter tests passed (880826).
TypeScript passed (b65a1c). Tests cover private-field reads, formatting parts,
range source labels, mixed-operand coercion order, calendar/component rejection
and captured formatter snapshot replay.
All five year-month cases also passed on Node 18.18.2 (5fd35b); scoped lint
passed (ee10bd), and whitespace validation passed (ce9133). The source-CLI
screenshot (2030b7) was inspected for direct Buddhist year-month formatting.

This isolated admission change depends on the wider local Temporal integration,
including public year-month constructors and snapshot support. Committing this
change does not commit all of that integration or establish a clean full-package
gate. The known native ICU ISO-month bug remains separate. No push or release
is authorized while the release hold remains in effect.
