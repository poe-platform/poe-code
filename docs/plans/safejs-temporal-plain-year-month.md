# Owned Temporal.PlainYearMonth

## Validated missing type

Pinned upstream PlainMonthDay.with qualification completed with 40 passes and
two failures across 21 fixtures (a5f01b). The original monthdaylike-invalid.js
builds an input using Temporal.PlainYearMonth.from before running assertions;
the source was read (b41a3e). PlainMonthDay.toPlainDate passed all 24 cases across
12 fixtures (d5e4ec). Both runs used unchanged fixtures/helpers and both modes
at 419d3e0a2273ba01a3bfcbec423f2801425b8e93, with no exclusions.

The absent year-month type also prevents the shared calendar-bearing object
helper from running. This is a concrete missing dependency, not evidence of a
calendar-merging defect that should be patched in PlainMonthDay.

## Private core and range distinction

Store copied frozen null-prototype ISO year/month/reference-day/calendar records
in a private WeakMap. Internal allocation requires own primitive numeric data,
normalizes negative zero, validates integer/date/calendar constraints through
the maintained year-month constructor, and does not invoke guest accessors.

Year-month limits differ from PlainDate limits: -271821-04-01 and +275760-09-30
are valid reference dates for their boundary months. Direct backend probes
confirmed both and rejected neighboring months (c9cfda). The normative boundary
operation is https://tc39.es/proposal-temporal/#sec-temporal-isoyearmonthwithinlimits.

Host admission captures intrinsic toString and calendarId readers. The always
format contains the exact reference ISO day. Read its canonical numeric fields
directly instead of passing them through the narrower PlainDate parser. This
path reads only captured intrinsic output, not arbitrary user date strings.
Public host shadows and proxies cannot supply slots. Only tracked exports remain
admissible after prototype removal; custom prototypes are rejected.

## Verification and remaining work

Test-first execution failed on the missing core module (800b5c), before any tests
ran. All 14 core tests then passed on Node 22 (fa4194) and patched Node 26.8.1
(032bf7). TypeScript passed (76f52b). Public construction/methods, budgets/copying,
host bindings, heap/replay codecs, calendar-reader integration and Intl admission
remain unimplemented. No screenshot applies to this unexposed private core.
This does not fix the upstream public fixtures yet or establish full conformance.
All 14 tests also passed on Node 18.18.2 (54d196); scoped lint passed (402b12),
and whitespace validation passed (617c15).
