# csvsort independent stress QA

Execute the actual safe-bash registered executable with injected UTF-8/C/UTC,
noninteractive capabilities and in-memory input/filesystem. Do not use native
oracles, host fixture files, databases, network or Python in canonical tests.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvsort-stress.test.ts`.
2. Compare complete stdout, stderr and status for reverse selected tuples with
   duplicate keys and nulls. Nulls move first under reverse and ties retain their
   input order; all-column sorting compares successive columns.
3. Use 512 original integer rows spanning negative and positive values, and
   precision-sensitive Decimal values above JavaScript's exact-integer limit.
4. Verify Python uppercase expansion and stable ties for sharp s, ligatures and
   dotless i, and Kelvin sign ordering without locale collation or lowercasing.
   Confirm frozen Unicode16 uppercase does not adopt Unicode17 case pairs.
5. Verify `-I`, `--zero`, duplicate column selectors and names-only return before
   malformed-body materialization or selected-column validation.
6. Sort a Boolean/date/duration tuple and check normalized output for every column.
7. Check `-H`, tabs overriding the explicit delimiter, line numbers and BOM.
8. Feed reused mutable byte buffers and verify retained input ownership plus one
   producer finalization. Read a named virtual source, redirect output and compare
   the preserved source bytes and exact output file bytes.
9. Inject warning provenance and compare exact ordered duplicate/unnamed header
   warnings and normalized headers. Verify missing provenance remains status 78
   and explicit injected suppression permits output without stderr.
10. The root integration owner registers the exact test path in the maintained
   integration inventory and runs maintained uncached build/test/lint checks.

Initial independent reproduction: 10 of 11 original cases passed. Unicode
ignore-case returned status 78 with `Python Unicode uppercase profile` instead
of sorted output. That is an explicit compatibility blocker, not a pass. The
root implementation owner received the failing case for correction.

After the root rebuilt the corrected csvkit engine, all 14 current stress tests
passed through the actual registered safe-bash executable. This includes the
additional Unicode16/17 distinction and warning capability tests. The missing
warning provenance case deliberately verifies an explicit unsupported refusal;
it does not establish compatibility for a host without that injected profile.

This focused stress suite does not certify untested flags, the full executable
suite, other encodings/locales, database drivers or all cancellation scenarios.
