# Independent csvpy user edge QA

Use the registered safe-bash csvpy executable with an explicitly supplied maintained PythonSession and cooperative terminal. Inputs and filesystem effects stay in MemoryFileSystem; no native Python, subprocess, real database, network or filesystem fixture is needed.

1. Check numeric quoting modes 2 and 4 preserve guest floats and quoted strings; modes 4 and 5 preserve null unquoted blanks.
2. Check duplicate DictReader headers use the final value, while blank records are skipped. Reset fieldnames to None after iteration and check the row is consumed before replacement headers.
3. Check DictReader line_num follows frozen CPython csv.DictReader timing: capture the first physical row before skipping blanks, including a blank tail ending in StopIteration.
4. Check skip-lines consumes physical lines before multiline parsing, and input universal-newline decoding normalizes embedded CRLF.
5. Check string SystemExit produces status 1 and its message, without traceback or EOF text.
6. Assert exact stdout/stderr/status, unchanged CSV bytes and exactly-once guest closure in every successful invocation. Make any CSV-file console attempt to consume borrowed REPL stdin fail the test.
7. Run maintained csvkit build before shell tests because safe-bash resolves its public csvkit engine from built exports. Run the new nine-case suite and existing eleven-case csvpy stress suite, followed by integration inventory assertions and scoped lint/typechecks through root integration ownership.

The original blank-record line_num regression failed before the fix (4 instead of 2), as did the blank-tail case (3 instead of 2) and reset-header timing case (reversed header/value). CPython v3.14.2 Lib/csv.py source inspection confirmed these timings: https://raw.githubusercontent.com/python/cpython/v3.14.2/Lib/csv.py, SHA-256 `7604e007804bef2693cb9705257a4ab18ab9b7a188fa3c1eb21a8a55f6ae1ddf`. This is source-derived coverage, not native interactive differential measurement. Preserve the tests; do not count unqualified interpreter/Agate/IPython, live input timing, or unsupported object APIs as passes. Root retains integration/export/Git ownership. No commit, push or publication is authorized by this QA.

## Execution record: September 18, 2026

- `npm run build:workspaces -- --workspace=@poe-code/csvkit`: all four maintained dependency-closure builds passed with the final reader changes.
- `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/csvpy-user-edge.test.ts packages/safe-bash/tests/commands/csvpy-stress.test.ts`: all 20 registered-shell cases passed; the new suite contributes nine.
- `npx vitest run packages/csvkit/src/csvpy.test.ts`: all 14 final interpreter command regressions passed.
- `node --test packages/safe-bash/scripts/integration-inputs.test.mjs`: all 109 inventory/runner assertions passed after registering the new suite by exact literal path.
- Scoped `git diff --check` passed. Root integrates final shared lint/typechecks and visual evidence separately; these observations do not imply a completed repository-wide gate or literal interactive compatibility.
