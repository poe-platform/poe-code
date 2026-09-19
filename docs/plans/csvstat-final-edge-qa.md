# Independent csvstat final edge QA

1. Read root and safe-bash instructions; preserve unrelated changes and staging.
2. Recreate a task-owned oracle virtual environment under `out` with the existing
   hash-pinned CPython 3.14.2 requirements. Verify interpreter and lock hashes.
3. Run the original csvkit 2.2.0 CSVStat utility with injected in-memory input and
   output under the frozen C/UTC/UTF-8, 80-column, 24-line environment. Record
   exact output, errors, status and locale formatting inputs.
4. Independently exercise Boolean operation filters; null, first-appearance and
   equal-value frequency ordering; zero, negative and bounded frequency counts;
   numeric signed zero; date and duration columns; Unicode codepoint lengths;
   nonfinite values; and all-null columns. Compare scalar, detailed, CSV and JSON.
5. Freeze original observations into an in-memory safe-bash differential test.
   Invoke the registered executable through Shell, verify stdout/stderr/status
   exactly and assert no virtual filesystem effects. Any mismatch must reproduce
   before a code fix; no mismatch warrants a speculative product change.
6. Independently compare Decimal square with Python Decimal integer power using
   seeded random and boundary values. Compare exact result spelling and trap
   identity; record admission-budget blockers separately from arithmetic results.
7. Let the root integration owner register the literal test path and complete
   maintained focused build/test/lint checks. Record outcomes in
   `docs/csvkit/csvstat-final-edge-validation.md`, then purge task-owned temporary
   oracle environment, scripts, captures and logs only.

No README, Git, integration exports or shared metrics edits belong to this agent.
