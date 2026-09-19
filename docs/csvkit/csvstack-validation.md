# csvstack validation

The archive was downloaded and verified against the required SHA-256. The frozen
CPython 3.14.2 reference produced 26 exact stdout/stderr/status observations in
`csvstack-reference.json`. Canonical tests read those observations with injected
in-memory inputs; they never invoke Python or create host files.

Before implementation, three frozen cases failed: an input `line_number` column
under `-l`, a grouping column named `line_number` under `-l`, and the same input
collision spanning files with different header orders. The SDK regression failed
too. For example, the old engine emitted `1,original,x`; the source emits `1,1,x`.
The command now uses the existing DictionaryWriter primitive, reproducing Agate's
dictionary overwrite semantics. All 28 initial domain regressions pass.
An additional backpressure regression verifies that the second pass cannot
reopen an input until the union-header sink write completes.

The engine is implemented in `packages/csvkit/src/commands/csvstack.ts`; the
superseded generic operation was removed. The existing safe-bash plugin already
registers all fourteen executable names and uses the same SDK/CLI engine.
No root export or provider registration change was necessary.

See `../specs/csvstack.md` for source behavior and explicit qualification limits,
and `../plans/csvstack-qa.md` and `../plans/csvstack-stress-qa.md` for QA procedures.
Reader quoting modes 2/4/5 and exhaustive verbose traceback compatibility remain
blockers; they are not included in successful source differential counts.

## Verification

- Csvkit maintained workspace build closure and lint passed. Workspace tests:
  44 files, 1991 passes, one skipped case and six TODO cases; unqualified cases
  remain excluded from parity claims.
- Safe-bash maintained workspace build closure passed, including native
  pre/event/post build stages. The focused serial csvkit integration run had
  195 passes, zero failures and one explicit temporal TODO.
- Independent csvstack stress tests had 15 behavior/resource checks and one
  explicit assertion that quoting modes 2/4/5 return blockers. The latter is
  not an original differential success.
- Maintained discovery explicitly includes the new stress file. Its focused
  inventory assertion passed. Changed-file ESLint and the maintained safe-bash
  typecheck route passed, including all 26 current consumer groups and expected
  negative TypeScript cases. These checks are compilation evidence only.
- Ad hoc screenshot inspection verified the actual injected safe-bash help and
  output `line_number,line_number,line_number,name` with rows `1,1,1,Ada` and
  `2,2,2,Grace`. The temporary screenshot is removed after review.

Broader integration testing exposed a stale csvjoin blocker-message assertion.
The actual join engine delegates header validation to the shared Agate header
normalizer, which reports `Agate duplicate/unnamed column warning provenance`.
The assertion was corrected to match that inspected execution path; no csvjoin
product behavior was changed.

No files were staged and no commit, push or publication was performed.

## Additional user edge review

An independent agent added thirteen frozen-reference-observed safe-bash cases
in `csvstack-user-edge.test.ts`, with exact output/status, one cooperative stdin
return and no VFS effects. These cover blank versus quoted-empty cached records,
empty groups and group names, blank dictionary headers, repeated stdin at EOF,
negative physical skips, initial spaces and tabs overriding delimiters. All
passed the existing engine; no new product defect was validated.

Two additional domain regressions verify that changed second-pass headers are
read again and can fail after earlier output, and that a rejected union-header
write preserves the injected failure identity without reopening inputs.
The domain suite now has 31 passing csvstack cases. The maintained csvkit
workspace suite passed 1993 cases, with one skip and six TODOs kept explicit.
The focused safe-bash registration, stress and user-edge run passed 37 cases;
one stress case asserts the existing quoting blockers rather than compatibility.
Both selected workspace build closures and csvkit lint passed, as did changed
safe-bash file ESLint, the maintained test-discovery assertion and safe-bash
typecheck (source/tests, 26 current consumer groups and expected negative cases).
Typecheck is compilation evidence, not runtime qualification.
Ad hoc screenshot inspection confirmed collision output,
the ungrouped quoted-empty cached row and partial output before repeated-stdin
failure; the temporary preview and screenshot were removed after inspection.

See `../plans/csvstack-user-edge-qa.md` for the additional procedure and limits.
This review does not establish exhaustive edge coverage or remove the documented
quoting and verbose traceback blockers. No Git delivery or release occurred.
