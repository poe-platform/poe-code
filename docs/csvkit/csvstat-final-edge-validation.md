# Independent csvstat final edge validation

An independent stress agent measured original csvkit behavior and exercised the
registered safe-bash executable. No serializer mismatch was validated, so no
serializer product changes were made.

## Frozen reference

- csvkit 2.2.0 source archive SHA-256:
  `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
- CPython 3.14.2 executable SHA-256, independently checked:
  `3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`.
- Hash-pinned runtime lock, independently checked:
  `7ecb88fddc47bb86867cf738670b24ed88f11f671feef127246b0d422a71d7a8`.
- Agate 1.14.2 and SQLAlchemy 2.0.54 were installed from that lock using
  `uv pip sync --require-hashes` in a task-owned oracle environment.
- Exact reference environment: `PATH=/usr/bin:/bin`, `LC_ALL=C`, `LANG=C`,
  `TZ=UTC`, `PYTHONIOENCODING=utf-8`, `COLUMNS=80`, `LINES=24`.

Original CSVStat was invoked with in-memory input/output streams; this reference
capture instrumented locale.format_string only to retain original formatting
results, without replacing its implementation. Canonical tests contain the
frozen observations and injected formatter responses, and invoke no native code,
network, real databases or Python fallback. The source/lock reference provenance
remains `reference-profile.json` and `reference-requalification-20260917.json`.

## Executable observations

`packages/safe-bash/tests/commands/csvstat-final-edge.test.ts` freezes 96 original
observations: eight independent column inputs across twelve argument profiles.
The inputs cover Boolean values and nulls; tied Text/null frequencies; Decimal
equal spellings and signed zero; dates; durations; supplementary Unicode and
combining characters; infinities/NaN/null; and all-null columns. Profiles cover
default detailed output, CSV, JSON, scalar frequency with default/zero/negative/
two-value limits, and scalar min/sum/median/length/MaxPrecision.

All 96 observations matched exact stdout, stderr and status through Shell and the
registered csvstat command. Every case also verified an empty virtual filesystem
after execution. Zero frequency count uses the original default five; negative
counts produce an empty result. Stable ties retain first appearance, including
null. Boolean numeric/ordering/length aggregations remain unavailable. JSON,
CSV, scalar and detailed output retain their distinct observed conversions.

The direct focused command was
`node --import tsx --test packages/safe-bash/tests/commands/csvstat-final-edge.test.ts`:
96 tests passed, zero failed. Root owns maintained build/lint checks and integration
registration; direct focused testing alone is not a repository-wide gate.

## Independent Decimal square QA

Root's Decimal.square change was independently compared with pinned Python
`Decimal(value) ** 2`. Random seed was `147318`: 5,000 signed values with 1–100
coefficient digits and exponents uniformly selected from -1000 through 1000.
Nine additional admitted probes covered positive/negative zero, zero scale,
positive/negative infinity, NaN payload/sign and an sNaN InvalidOperation trap.

All 5,009 admitted probes matched exact Decimal result spelling or trap class.
No floating-point tolerance was used and no mismatch was found. The test used
current TypeScript source, independently of the domain unit expectations.

Twenty-one additional probes combined three 28-digit coefficients with exponents
-500014, -500013, -500000, 499985, 499986, 499999 and 500000. Every JavaScript
probe was explicitly blocked by the existing Decimal admission budget. Python
returned finite extreme-exponent results or Overflow. These 21 are compatibility
blockers, not arithmetic passes, and this square QA does not qualify the blocked
exponent range.

This finite cohort does not establish all csvkit executable parity, interactive
behavior, cancellation, real driver/database behavior or arbitrary Decimal inputs.
Temporary task-owned oracle environment, scripts and captures were purged after
recording; unrelated files under out were preserved.
