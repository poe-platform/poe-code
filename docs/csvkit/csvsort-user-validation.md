# csvsort user edge validation, September 18 2026

This additional review exercised the existing implementation as an SDK caller
and through the actual safe-bash registered executable. No product defect was
validated, so product behavior was left unchanged. Tests and exact maintained
integration inventory membership were added without staging or committing.

Four original SDK tests cover supplementary Unicode uppercase ties, datetime
offset equality and microseconds under an explicit format, equal Decimal scales
with secondary keys and signed zeros in reverse, and names-only cleanup after a
complete frozen 8192-byte decoder window. Body bytes remain unparsed and later
windows unread. The decoder intentionally reads ahead across smaller transport
fragments; names-only is not a promise to read only the header's transport bytes.

A different agent authored 13 independent Shell tests. These replay the 21
frozen differential observations with shell quoting and test multiline CSV,
supplementary Unicode order, reverse expansion ties, reached/unreached NaN keys,
null tuples, inference controls, raw names, header-only input, blanks/custom
nulls, equal timezone instants and CRLF metadata skipping. A refusal test keeps
input quoting mode 2 and unqualified verbose errors explicit status-78 blockers.
Passing that test verifies refusal behavior, not support for those cases.

Validation completed uncached:

- Csvkit maintained workspace test: 42 files; 1889 passed, one skipped, six TODO.
  Skips and TODOs remain unqualified. The csvsort file now contains 34 tests.
- Csvkit maintained lint: ESLint and source/test TypeScript checks passed.
- Selected maintained safe-bash workspace build closure: ten declared builds and
  guarded build/postbuild passed.
- Safe-bash maintained runner checks: 536 passed, including exact admission of
  the new csvsort user test file.
- Final focused Shell run: 27 passed across the existing stress suite and new
  independent user suite. Focused ESLint on the new Shell test passed.
- Maintained safe-bash strict typecheck: source/tests, 26 current consumer groups
  and expected negative diagnostics passed. This is compile acceptance only.

The maintained screenshot renderer displayed the built Shell's reverse Decimal
tuples, quoted multiline output and zero-based names. Inspection confirmed
expected order, quoting and spacing. Owned visual artifacts in out were purged.

These are additional original regression cases, not new native differential
measurements or exhaustive acceptance. Other documented shared blockers,
unmeasured domains/locales/encodings and the remaining executable suite retain
their existing qualification limits. README content and Git staging were
preserved; no commit, push or publication was performed.
