# Typed table implementation boundary

**Temporal update (2026-09-18):** [csvkit-temporal.md](csvkit-temporal.md)
records implemented casts, temporal ordering, typed JSON and generic DDL.
The earlier temporal blocker descriptions below are historical and superseded
only for the measured paths in that specification. Full parity remains blocked.

Target: csvkit 2.2.0 source archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
The reference environment is the existing
`darwin-cpython-3.14.2-csvkit-2.2.0` profile in
`docs/csvkit/reference-profile.json`, replayed with the hash-pinned
`docs/csvkit/requirements-cpython-3.14.2.txt` lock.

## Implemented

Inference keeps an independent surviving-type set for each column. It scans
sampled rows and columns in physical order, testing every surviving candidate
until only one remains, then selects the first survivor in preference order.
Ordinary CastError removes a candidate; other diagnostics and explicit blockers
propagate even if an earlier candidate accepts. This follows authenticated
Agate 1.14.2 TypeTester.run, rather than first-success casting. Direct TimeDelta
casts therefore accept `1 ſec`, while default table inference reports the Date
hypothesis's `KeyError: 'ſec'`. Earlier text rows can eliminate that hypothesis;
`--no-inference` bypasses it. Frozen observations and exact diagnostic details
are in [hypothesis-cast-reference.json](../csvkit/hypothesis-cast-reference.json).
JavaScript scans candidates in preference order; competing failures within
Python's set traversal remain unmeasured and are not qualified by these cases.

`packages/csvkit/src/table/types.ts` exposes typed columns, typed rows and
original raw rows. `columnTypeOrder` follows `CSVKitUtility.get_column_types`:
Boolean, Number, TimeDelta, Date, DateTime, Text; explicit date formats move
Number after Date, and explicit datetime formats move Number after DateTime.
No-inference selects Text. QUOTE_NONNUMERIC selects Number, Text.

Boolean, en_US Number and Text casting are implemented. Text retains original
whitespace except when the stripped, case-insensitive value matches the null
policy. `--blanks` removes the default null set; supplied null values are added.
Leading-zero rejection belongs only to Number. Number retains decimal values
as strings and applies precision-28 half-even rounding; it never converts exact
integer values through JavaScript Number. Currency, grouping, percentage and
Unicode decimal digit handling follow the inspected Agate cast path.

Sampling selects column types, then every row is cast. Zero sampling uses
default Text, including its default null policy, as Agate TypeTester does.
Short rows pad missing cells with null. Excess cells produce the source row
length diagnostic. Empty input produces an empty table. Null-only columns
prefer the first available type.

`csvformat -U 2` reads this table through the existing Runtime and writes through
the existing writer. Other csvformat output modes keep their raw path. The
safe-bash registration and SDK execute the same implementation. Default
csvsort now uses this reader for Boolean and Number columns, with exact
Decimal ordering and nulls at the end (reversed with `-r`). No-inference sorting
retains Unicode text ordering. NaN ordering remains a trap-profile blocker.
All fourteen
executable names remain unchanged.

The existing parser correctly models `--null-value` as ordinary store with
`nargs '+'`: a later occurrence replaces the previous array, and apparent file
operands are consumed until an option terminates the value list. Help's claim
of repeatability does not imply append semantics.

## Explicit blockers

This is **not full csvkit compatibility**. TimeDelta, Date and DateTime casts
remain unimplemented; reaching one of these inference candidates throws an
explicit blocker rather than rejecting the candidate and silently selecting
Text. Explicit date/datetime format precedence is represented, but these
formats cannot yet be cast. Default inference can therefore block on a text
column after Boolean and Number fail. Default typed operation paths beyond
the measured csvsort cases remain blocked by their existing guards.

Duplicate, missing and absent header warnings need qualified deployment
identity and warning filtering. Both the reader and direct typed-table API
block these cases, including populated zero-column tables; no warning behavior
is claimed. Non-en_US Number locales, exponent bounds outside the supported
Decimal context, full Decimal trap/underflow behavior, and all unmeasured
cases remain unqualified. No database, network, interactive or temporal
compatibility is established by these tests.

## Evidence

Source inspection: csvkit `cli.py:get_column_types`,
`utilities/csvformat.py:main`; Agate `type_tester.py`,
`data_types/{base,boolean,number,text}.py`, and `table/__init__.py`.
Native development-only probes used the frozen lock and CPython 3.14.2 with
LC_ALL=C, LANG=C, TZ=UTC, PYTHONIOENCODING=utf-8, COLUMNS=80, LINES=24.
Canonical tests contain in-memory expectations; they invoke no native oracle.

The original red regression returned status 78 for `csvformat -U 2` on
`a,b\n001,yes\n2,NA\n`; the reference returns status 0 and
`"a","b"\n1,"yes"\n2,""\n` with empty stderr. Independent safe-bash tests
also reproduced the quiet-NaN blocker before its correction.

Tests: `packages/csvkit/src/table/{inference,types}.test.ts` and independent
`packages/safe-bash/tests/commands/csvkit-table-stress.test.ts`. These compare
exact output/status, VFS preservation, full-column inference, decimal scale,
wide integers, Unicode digits, numeric normalization, parser consumption and
failed producer cleanup.
