# csvpy object contract independent stress QA

Use the actual registered safe-bash `csvpy` command with an explicitly supplied
`PythonSession`, MemoryFileSystem and terminal line capability. Do not substitute
host JavaScript expression evaluation, Python processes or a seeded `table` object.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvpy-object-contract-stress.test.ts`.
   Check exact stdout, stderr and status and unchanged virtual filesystem effects.
2. Verify iterator identity, header flag, physical multiline `line_num`, repeated
   exhaustion and a guest generator that consumes the underlying reader once.
3. Verify duplicate DictReader names, writable rest cells, missing cells, extra
   cells and exhaustion through interpreter-native expressions.
4. Import error classes and configuration functions in the interpreter; verify
   field errors, continued console execution, printing, mutable config and
   isolation between independent sessions. The authenticated `exceptions.py` defines
   `FieldSizeLimitError` as a direct `Exception` subclass, not `ValueError`.
5. Verify guest mutation of `reader.line_numbers` and `reader.header` against the
   frozen Agate 1.14.2 `csv_py3.py` implementation, including physical multiline
   numbering. This case initially failed: returned rows lacked inserted numbers.
6. Compare raw-reader dialect attributes, readonly assignments, module aliases,
   configuration exports and exception construction with the selected native
   transcripts in `docs/csvkit/csvpy-object-reference.json`. Match exact channels
   and status. The stress suite covers eight cases; do not label an old build
   failure as a source failure while rebuilt product artifacts are pending.
7. Run the neighboring maintained csvpy stress suites and scope type/lint checks
   after the bridge owner fixes validated regressions.
8. Inspect an ad hoc console screenshot for any changed visible console behavior;
   store generated evidence in `out` and purge it after inspection.

The assertions are source-derived regressions from authenticated frozen sources,
not a completed CPython interactive differential qualification. Full Agate public
API coverage, complete `code.interact` diagnostics and optional IPython require
separate qualification. Unmeasured cases remain blockers.

## Scoped execution record

On September 18, 2026, the rebuilt-artifact registered-command run of
`csvpy-object-contract-stress.test.ts`, `csvpy-stress.test.ts` and
`csvpy-user-edge.test.ts` passed all 28 tests with no skips or TODOs (1.88 seconds).
The earlier line-number mutation failure was fixed by the bridge owner. A dialect
setter diagnostic mismatch observed during rebuilding disappeared after the
updated product artifact was available; it was not established as a source bug.
This scoped result does not remove the qualification blockers above.

## Correction: DictReader line timing

The earlier 28-test pass included an incorrect expectation that a successfully
returned record after blank lines retained `line_num == 2`. It did not validate
that case against the native reference, and it must not be cited as compatibility
evidence for that timing. The frozen CPython 3.14.2 / Agate 1.14.2 / csvkit 2.2.0
runtime was subsequently measured under `LC_ALL=C`, `LANG=C`, `TZ=UTC` and UTF-8
stdio. Its `csv.DictReader.fieldnames.fget` assigns
`self.line_num = self.reader.line_num` unconditionally, including when fieldnames
are already known.

For `x\n\n\nvalue\n`, `next(reader)` returns `{'x': 'value'}` with line number 4.
For `x\n\n\n`, exhaustion retains line number 2 until another `reader.fieldnames`
access, which advances the observed number to 3. Resetting fieldnames during
`a\nfirst\nvalue\nnewname\n` returns `{'newname': 'value'}` with line number 4.
The corrected canonical in-memory regressions initially reproduced two failures
against the old built product. Native programs are used only for this explicit
ad hoc reference measurement, never by canonical tests or the product.

## Final corrected scoped execution

After the bridge owner's unconditional fieldnames line-number synchronization fix
and rebuilt csvkit artifact, the final run of the same three registered-command
suites passed all 28 tests (2.071 seconds), zero failures, skips or TODOs. This run
includes the corrected native timing assertions and the additional blank-tail
fieldnames reaccess and reset line-number assertions. ESLint passed both changed
test files. These scoped results supersede the incorrect line-timing qualification
in the earlier execution record; broad Python/Agate/IPython blockers remain.

After removal of the fabricated public `agate.csv.Error` alias, the final three
registered-command suites passed again: 28/28, zero failures/skips/TODOs, 1.880
seconds. The error regression imports `FieldSizeLimitError` from the actual
source-shipped `agate.csv_py3` namespace and `Error` from stdlib `csv`. ESLint
passed both edited canonical test files after that import correction.
