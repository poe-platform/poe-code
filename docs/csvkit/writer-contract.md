# Writer contract

Target: csvkit 2.2.0, archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Writer source: Agate 1.14.2 `agate/csv_py3.py`, verified source archive SHA-256
`7f29841c39d84b1de7fde762b8d792085371515324f3a01413b20f810398225b`.
Runtime observations use the existing darwin-cpython-3.14.2-csvkit-2.2.0 profile in reference-profile.json. No runtime dependency or native fallback is introduced.

`writeCsvRow`, `Writer` and `DictionaryWriter` share the byte serializer.
Writers return strings; streaming callers encode and await their own sink writes.
`writerows` yields one record at a time. Neither writer acquires or closes a sink.
The actual command engine continues to await writes, account budgets, observe
cancellation and register invocation cleanup. Each writer snapshots its dialect
and owns its numbering counter. Headers are copied into writer-owned storage.

`CsvWriteCell` accepts strings, integer-valued JS numbers, bigints, booleans,
null and explicit typed cells. Decimal/date/datetime cells carry their canonical
Python str value in `value`; this is supplied by the typed producer, not inferred
from text or converted through JS Number/Date. Datetime preserves its timezone,
naive/aware status and six-digit microseconds in that canonical string.
Timedelta cells carry exact bigint `microseconds`; serialization uses Python's
normalized days/seconds/microseconds representation and day range.
Arbitrary objects and undefined are outside this contract. General Python float
repr parity is unqualified; JS number has no separate integer/float type.

Default serialization uses comma, double quote, LF and a trailing record
terminator. Supplied string values replace each CR with LF, including the CR in
CRLF. DictionaryWriter normalizes supplied values before missing-key substitution:
its `restval` does not undergo that conversion. Duplicate headers repeat the
same dictionary value; missing keys use restval, explicit null stays null, and
inherited JS properties are not dictionary keys. Extra-key errors use Python
repr. Multiple-extra-key error ordering from Python hash-set iteration remains
unqualified. Numbered dictionary rows override a supplied line_number value.
Agate advances numbering before serialization, including failed numbered rows.

CPython 3.14.2 reference observations (repr of actual output):

- QUOTE_NONNUMERIC booleans: `True,False\n` (numeric classification).
- Decimal('1.2300'): `1.2300\n` under QUOTE_NONNUMERIC.
- Date/datetime/timedelta: quoted under QUOTE_NONNUMERIC.
- Single null under QUOTE_STRINGS/QUOTE_NOTNULL: Error, `single empty field record must be quoted`.
- Single empty string under either newer mode: `""\n`.
- Missing restval `x\ry` with fields a,b and a=ok: `ok,"x\ry"\n`.

Writer `--linenumbers` has header `line_number` and emitted-row ordinal.
The csvgrep reader has header `line_numbers` and the record's ending physical
line number minus one when a header is present. Multiline and filtered records
must not collapse these into one counter. Existing engine input modes 2/4/5
remain explicit blockers. The CPython 3.9.6 writer profile and runtime-specific
admission differences are unmeasured here; passing 3.14 tests does not qualify them.

## Validation

The writer observations were repeated with executable SHA-256
`3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`,
matching the frozen CPython 3.14.2 profile. Research execution used an empty
inherited environment with LC_ALL=C, LANG=C, TZ=UTC and
PYTHONIOENCODING=utf-8, plus isolated Python startup. The hash-verified
Agate csv_py3 source was loaded directly; only its unused field-limit exception
import was stubbed. This measures the writer component, not an installed full
Agate/SQLAlchemy/database stack. An initial exploratory system-Python 3.14.7
run is not the qualified reference; the hash-matched rerun supplies the results.

Original regression run: four writer tests failed before implementation.
Independent dictionary edge regressions: two failed against the initial
implementation (null and CR restval), then passed after correction.

Uncached maintained checks completed:

- csvkit workspace test: 1370 tests passed, five TODOs remain unqualified.
- csvkit workspace lint, including production and test TypeScript checks: clean.
- selected csvkit and safe-bash workspace build closures: successful.
- focused registered safe-bash csvkit command tests: 99 tests passed; these
  include explicit blocker-contract checks and do not establish full parity.
- safe-bash maintained test:runner route: 536 tests passed.
- focused ESLint for the new shell test and edited inventory assertion: clean.
- ad hoc writer-output terminal screenshot inspected; temporary evidence purged.

Independent agent stress covered typed defaults, exact escape bytes, special
and duplicate dictionary keys, multiline filtered numbering, invocation dialect
isolation, newer output modes and virtual-file byte effects. No native program
is used by the canonical regressions. No README edits, staging, commits, pushes
or publication were performed.
