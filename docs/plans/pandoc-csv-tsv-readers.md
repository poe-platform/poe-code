# CSV and TSV readers

## Scope

Implement original TypeScript document-table readers in `packages/pandoc`.
Descriptors drive SDK and existing thin safe-bash inspection availability.
No native runtime fallback, spreadsheet model, XLSX changes or writers.

## Procedure

1. Read root/scoped instructions and inspect xan's bounded scanner. Extract only
   a demonstrated shared need; its shell budgets, raw-byte provenance, permissive
   dialects and blank-record skipping do not meet this document reader contract.
2. Probe native Pandoc 3.10.1 outside unit tests with original literal inputs;
   retain captures and exact/different comparisons under `docs/pandoc`.
3. Write failing original unit fixtures for headers, literal TSV quotes, CSV
   syntax, record/cell boundaries, strings, streaming decoding and budgets.
4. Implement readers, finite configurable field/row/column ceilings, rectangular
   cell admission, and location-preserving reader diagnostics.
5. Run maintained pandoc tests, lint/typecheck and selected workspace build.
   Verify inspection via the existing byte adapter. No visual CLI layout changes.
6. Commit only owned files on main. Do not push or release.

## Reader policy

First record is the header. Empty input has no blocks; each blank record has one
empty cell. A final newline terminates its record without an extra record; further
newlines represent blank records. Later wider rows expand and pad the table.
CSV quotes must enclose the whole field, with doubled escapes. TSV quotes have no
syntactic role. Spaces and formula-looking/numeric-looking strings remain text.
The existing UTF-8 acquisition path strips an initial BOM and normalizes CRLF and
bare CR to LF, including within quoted CSV fields. Locations refer to that
normalized source in one-based lines and Unicode scalar columns.

## Status

Implemented readers and location-preserving capability errors. Initial red:
19 reader failures / 479 existing passes; the independent source-location test
also failed before the execution-boundary fix. Package tests, package lint with
source/test typechecking, and selected workspace build passed after implementation.
Final verification: 502 tests passed, package ESLint/source+test typechecks passed,
and selected workspace build passed. Implementation and verification complete;
delivery is local-only, with no push or release authorized. Native comparison: 24 exact JSON,
2 matching syntax-rejection classes, 18 explicit differences across 44 probes.

## Executed native QA procedure

1. Obtain official Pandoc 3.10.1 arm64 macOS release in a task-owned temporary
   directory under `docs/pandoc` (no executable/fixture dependency in unit tests).
2. Execute each original literal input with argv `--sandbox --from FORMAT
   --to json --wrap=none`, supplying UTF-8 bytes on stdin. Record stdout as parsed
   JSON, stderr and exit code in `docs/pandoc/csv-tsv-native.json`.
3. Build via `npm run build:workspaces -- --workspace=@poe-code/pandoc`. Use the
   built SDK `convert` on those same input strings with explicit formats and no
   native adapter. Compare parsed JSON structurally; classify rejection separately
   from identical diagnostic bytes. Retain exact/different outputs and reasons.
4. Record hashes of the oracle and relevant TypeScript source/test files; remove
   the task-owned temporary oracle before committing evidence.
5. Run `npm run test --workspace=@poe-code/pandoc` and `npm run lint
   --workspace=@poe-code/pandoc`. Stage explicit owned paths and commit on main;
   preserve the existing edits in the overarching converter plan.
