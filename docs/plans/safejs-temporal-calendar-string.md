# Temporal calendar-string parsing

The PlainDateTime calendar-input adapter rejected valid ISO calendar strings.
Eleven public regressions reproduced the gap before the parser change
(22603d). Direct backend delegation was also rejected after concrete probes
showed acceptance of February 30, month 13 and overflowing offset minutes.

Extract a shared ISO parse result from the existing time-zone scanner, exposing
calendar parsing without changing the time-zone entry point. Calendar parsing
accepts syntactically valid ISO forms or bare annotation identifiers; supported
calendar canonicalization remains the caller's responsibility. ISO parsing does
not impose the representable Temporal value range.

Specification: https://tc39.es/proposal-temporal/#sec-temporal-parsetemporalcalendarstring

This atomic change contains only the parser and direct regression tests. The
public Temporal integration remains a separate, uncommitted workstream.
Before this split, 127 public/parser tests passed on Node 18.18.2 (dec67f),
the maintained build passed 23 tasks plus five ESM checks (a27596), and the
two original pinned Test262 calendar-input fixtures passed both modes (acac46).
Direct parser regression checks and scoped lint are recorded below when terminal.
No remote delivery or release is authorized while the release hold remains.

Direct parser plus public calendar-input checks passed 107 tests (f17c17).
Two initial direct-test expectations were incorrect: date-shaped strings such
as 2020-02-30 can fall back to bare AnnotationValue syntax. The specification
explicitly separates syntactic parsing from supported-calendar canonicalization.
Corrected those test expectations, without changing production behavior; the
public adapter still rejects both unsupported identifiers. This is not a newly
fixed parser defect.

Scoped ESLint completed successfully (fa819f). The production parser is unchanged
since the successful 23-task workspace build and five import checks (332692).
