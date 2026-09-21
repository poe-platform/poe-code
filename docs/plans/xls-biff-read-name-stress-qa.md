# Independent BIFF NAME stress QA

Run from the repository root against the current candidate, keeping all input
bytes in memory. The fixture writer in `biff-names-stress.test.ts` is independent
of the existing BIFF test helpers. No native executable, LLM, or host-file write
is part of these unit cases.

1. Inspect stable primary source under `out/ssconvert-lifecycle/gnumeric-1.12.61/plugins/excel/ms-excel-read.c`:
   `excel_read_NAME`, `excel_read_name_str`, and `excel_parse_name`.
2. Run `npx vitest run packages/ssconvert/src/codecs/biff-names-stress.test.ts`.
   A zero-token NAME must import as `=#NAME?`; a one-based local scope must
   resolve after workbook globals close. Invalid scope and token length must
   fail, the string budget must reject oversized data, and cancellation must
   preserve the caller's reason.
3. Run `npx vitest run packages/ssconvert/src/codecs/biff-names-stress.test.ts packages/ssconvert/src/codecs/biff-names.test.ts packages/ssconvert/src/codecs/biff.test.ts`.
4. Root runs maintained workspace build, test, lint, integration, native oracle
   round trips, and CLI screenshot QA against the final combined candidate.

## Recorded independent findings

The initial six-case stress run had five passes and one failure: an empty NAME
token stream caused `E Invalid Excel BIFF: formula stack did not resolve`.
Stable `excel_parse_name` explicitly converts `expr_len == 0` to a constant
`#NAME?` error. The repaired NAME materialization follows that behavior without
relaxing formula validation for worksheet formulas. The three-file focused run
then passed all 43 tests. A second regression demonstrated that untranslated
NAME formulas retained only a name and dropped their bytes. The parser now
retains the complete original NAME record through its existing bounded metadata
retention path, keeping the existing single loss warning. Independent export
checks cover plain/prefixed numeric expressions, errors, embedded equals,
XML-sensitive strings, duplicate global/local names, and positions. Replay
reassigns sheet IDs, which the scope check follows rather than treating as an
expression loss. The expanded three-file run passed 48 tests (10 independent
stress cases). An intermediate lint run found four unnecessary quote escapes in
the stress fixtures; these were corrected without changing their string values.
These are deterministic semantic checks, not bounded
performance measurements or a completed broad gate.

## Remaining limits to verify or repair

- Root's fresh native empty-token NAME round trip exited 0 without stderr but
  serialized no global name. The source-level `#NAME?` placeholder behavior
  passes its unit case; XML round-trip compatibility for this cell remains a
  verified mismatch, not a native pass.
- Unknown built-in NAME identifiers produce invented `_BIFF_BUILTIN_*` names;
  stable `excel_builtin_name` warns and returns NULL. This is a source-verified
  mismatch, not a native differential measurement.
- Hidden NAME flags and VBA placeholder behavior are not represented in the
  current NamedExpression model; this independent run does not qualify them.
- Invalid NAME scopes currently reject the file, while stable reader warns and
  may retain a workbook-scoped expression. Strict rejection has been verified,
  not claimed as exact native compatibility.
- No native-oracle, realm/host, checkpoint/replay, CLI, or screenshot cells were
  measured by this independent NAME unit run. Root retains those gates.
