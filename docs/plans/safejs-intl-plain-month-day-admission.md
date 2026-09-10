# PlainMonthDay admission to Intl.DateTimeFormat

## Validated gap

All five public tests failed before implementation (789260). Intl numeric
coercion invoked month-day public shadows or its rejecting valueOf instead of
admitting private Temporal data. Range processing consequently failed before
observing the second operand, and calendar incompatibility raised the wrong
exception. This was independently missing from the shared input classifier and
private backend conversion path, despite public toLocaleString support.

## Change

Admit the owned month-day brand to the existing Temporal path. Require matching
Temporal types for ranges and construct backend month-days from their four
private fields, without public getters or primitive conversion. Existing
formatter state, backend calendar compatibility, component filtering, parts and
range source labels remain in use. No host prototype or global Intl mutation.

## Verification

- All 18 focused Intl temporal/month-day/date-time tests passed (4dbb35).
- All five new public cases passed on Node 18.18.2 (459233).
- TypeScript passed (12838c); whitespace validation passed (e982c9).
- Scoped lint passed (8ce88a). The patched Node 26.8.1 CLI screenshot (eb5c6d)
  was visually inspected and shows Intl format: February 29.
- Cases cover format/parts, range/parts, mixed-operand observation order,
  incompatible calendars/components, and captured formatter snapshot replay.

This change depends on the wider local Temporal integration. A local commit of
these files does not mean the full implementation has been committed, pushed or
released. ISO month names remain affected on buggy ICU runtimes as recorded in
the month-day implementation plan; this admission fix does not repair native ICU.
