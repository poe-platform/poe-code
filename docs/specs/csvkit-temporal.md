# Agate temporal, Boolean and Text compatibility boundary

Target: csvkit 2.2.0 source SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Reference: `darwin-cpython-3.14.2-csvkit-2.2.0` in
`docs/csvkit/reference-profile.json`, hash-required runtime lock
`docs/csvkit/requirements-cpython-3.14.2.txt`. This implements a measured
subset, not complete temporal or fourteen-command parity.

## Representation and inference

Boolean accepts yes/y/true/t/1 and no/n/false/f/0 after comma removal, Python
whitespace stripping and frozen CPython Unicode 16 lowercasing. Text retains
original whitespace except null detection. Default nulls are empty, na, n/a,
none, null and dot; blanks removes them and supplied values are lowercased.
Unicode 17 case pairs must not be recognized merely because Node recognizes
them. `unicode-lower-profile.ts` holds 1,460 lowercase mappings and final-sigma
scan classes derived from CPython 3.14.2. The sigma classes were exhaustively
queried using `('AΣ' + character).lower()` and
`('AΣ' + character + 'A').lower()` over all Unicode codepoints. Unmapped
characters remain unchanged. No Intl or ambient locale casing is used.

The table retains Python date/datetime string values in tagged records and
exact timedelta microseconds in bigint. Date validation and ordinals use
proleptic Gregorian arithmetic, including year one, without Date.parse, host
Date constructors, timezone tables or Intl. The existing Boolean, Number,
TimeDelta, Date, DateTime, Text order remains intact. Explicit date/datetime
formats move Number after the appropriate temporal type. An invalid Gregorian
date can reject its candidate and choose Text; an unqualified expression throws
an explicit blocker rather than selecting Text as a purported success.

## Implemented temporal paths

Explicit formats support `%Y`, `%y`, `%m`, `%d`, `%H`, `%I`, `%M`, `%S`, `%f`,
`%p`, `%b`, `%B`, `%a`, `%A`, `%z`, `%Z` and `%%`, C/en_US English names,
required whitespace, default 1900-01-01 fields, two-digit-year pivot 69,
12-hour conversion, microsecond padding and numeric offsets. Reached directive
alternatives follow frozen CPython widths; compact 2024131 with `%Y%m%d` is
2024-01-31. Other directives and duplicate groups explicitly block.
Consecutive format whitespace collapses to one required input whitespace run,
using the frozen Python whitespace profile, including U+0085. Explicit offset
seconds and fractional seconds participate in aware DateTime ordering, and
the mixed aware/naive diagnostic recognizes these offsets.

Implicit Date recognizes measured Gregorian ISO dates, slash dates, English
month-name dates, today/tomorrow/yesterday, weekday names and next week.
Its source date is Agate's ZERO_DT, 0001-01-01; tomorrow means 0001-01-02.
Slash two-digit years use parsedatetime's pivot 50, not strptime's pivot 69.
Missing slash years below 100 follow parsedatetime's 2000-century behavior.
Implicit hyphenated numeric dates follow parsedatetime's field ordering: a first
field at most 31 is month/day/year; otherwise it is year/month/day. Its year
pivot applies after that ordering, so `0002-01-01` becomes `2001-02-01`.
Explicit `%Y-%m-%d` retains Gregorian year two. Internal Python whitespace in
month-name dates normalizes before recognition.
Relative and partial DateTime dates require an injected clock. Table reads
capture that clock once per read; UTC converts milliseconds to Gregorian
ordinals. Non-UTC clock profiles explicitly block. DateTime additionally
recognizes measured extended ISO/space-separated dates and times, Z and numeric
minute offsets, and truncates implicit fractional seconds to six digits.

TimeDelta implements the frozen pytimeparse week/day/hour/minute/second units,
ordered optional fields, comma/slash separators, minutes:seconds,
hours:minutes:seconds with optional week/day prefix, day clocks and seconds-only
clocks. Unicode decimal digits and Python whitespace are normalized explicitly.
The reference accepts the pipe sign as positive. Its fractional-unit path with
integer seconds applies the sign only to the other fields: -1.5h 2s becomes
-5,398 seconds. Integer paths remain exact; fractional paths split whole and
fractional seconds before half-even rounding, preserving binary-float behavior.
Malformed matched numeric fields raise the measured ValueError, not CastError.
Out-of-admission float magnitudes and unqualified domains remain blockers.
Python case-insensitive unit matching includes dotted I and Kelvin sign.
Direct TimeDelta casts also accept long-s and dotless-I duration units.
Agate inference tests additional surviving Date hypotheses after TimeDelta
accepts; the engine now preserves those hypotheses' Unicode unit-key KeyError
diagnostics. Earlier text rows can eliminate those candidates. DateTime catches
the corresponding lookup failure and rejects the cast normally. Scientific
numbers and standalone subday units reject temporal casts normally; measured
relative day/week forms use the injected clock for DateTime and year-one source
for Date. See [hypothesis-cast-reference.json](../csvkit/hypothesis-cast-reference.json)
for exact cast details and CLI/SDK observations. Competing errors within Python
set traversal and unmeasured parsedatetime expressions remain unqualified.

## Output and operations

csvsort orders durations by exact microseconds and aware datetimes by instants
while retaining their offsets. Mixed aware/naive ordering raises the measured
TypeError with status 1. CSV table output uses datetime ISO `T`; the public
low-level writer continues to model Python str with a space. Date CSV/JSON
uses ISO dates, Boolean JSON uses JSON booleans, duration CSV/JSON uses normalized
Python timedelta text and Text JSON uses the original string. csvformat -U2
uses Number/Text inference and therefore preserves original date/time text.

Typed csvjson arrays, keys, indentation and stream output share the table and
serialization engine. Number-to-float JSON serialization remains blocked.
Default generic csvsql DDL uses declarative Boolean BOOLEAN, Number DECIMAL,
TimeDelta DATETIME, Date DATE, DateTime TIMESTAMP and Text VARCHAR metadata.
DateTime never gets an inferred NOT NULL constraint, as in agate-sql. SQL binds,
inserts and query execution remain blocked; DDL does not qualify database effects.
Other dialects without measured typed metadata explicitly block typed schemas.

## Dependencies actually reached

| Dependency | Reached from commands | Implemented boundary / remaining blocker |
| --- | --- | --- |
| Babel 2.18.0 / CLDR 47 | Agate Number Locale.parse and latn grouping/decimal symbols via inferred table commands | en_US comma/dot profile only; other locales and unknown-locale exception parity unqualified |
| Python locale / libc | explicit date/datetime LC_TIME changes; csvstat import LC_ALL initialization and format_string | C/en_US temporal names; other LC_TIME settings/errors blocked; statistics formatting unimplemented |
| parsedatetime 2.6 | Date Calendar.nlp with ZERO_DT; DateTime nlp and parseDT with source clock and timezone None | measured English dates/relative subset; broader NLP, locale fallback, multiple matches, date arithmetic, locale grammars and diagnostics unqualified |
| isodate 0.7.2 | DateTime fallback parse_datetime | measured extended calendar dates, time fractions and minute offsets; basic/ordinal/week ISO dates, expanded/reduced precision, unusual timezone/time forms unqualified |
| pytimeparse 1.1.8 | TimeDelta cast parse, integer/float result paths and Python timedelta | measured grammar and binary rounding; Unicode case-insensitive unit aliases, large float/overflow diagnostics and exhaustive durations unqualified |
| SQLAlchemy 2.0.54 / agate-sql 0.7.3 | typed schema type map, interval emulation and DateTime nullability | generic measured DDL only; dialect typed constraints, interval bindings and real drivers blocked |

Input numeric locale defaults to en_US independently of the operating system.
It must never be taken from LocaleServices.profile. csvstat is different: it
calls Python `locale.setlocale(LC_ALL, '')` at import and formats through libc
`locale.format_string(format, value, grouping=...)`, stripping trailing zeroes
and dot. Under the frozen LC_ALL=C/LANG=C environment, decimal point is dot,
grouping is empty and thousands separator is empty. `--locale` controls input
inference, not this output locale. No statistics output implementation or
cross-platform libc locale parity is claimed.

## Explicit remaining blockers

Full strptime (`%j`, week/ISO-week directives, composite/alias directives,
backtracking of adjacent variable-width fields, duplicate groups,
Unicode directive digits and platform locale failures), full parsedatetime,
full ISO fallback, non-English locales, timezone database/DST behavior,
exhaustive overflow/diagnostic paths, numeric JSON float conversion, typed SQL
dialects/binding effects, and all unmeasured cases remain unqualified. Finite
regressions do not certify these paths. The command suite remains unfinished;
existing format, encoding, compression, workbook, statistics, network,
interactive and database blockers remain tracked in implementation-status.md.
