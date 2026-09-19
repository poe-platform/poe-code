# CSV reader qualification procedure

1. Preserve unrelated working-tree/index edits and read root/scoped instructions.
2. Add original in-memory failures before changing reader behavior. Cover numeric
   quoting, disabled quote/escape characters, iterable boundaries, escaped CR/LF,
   multiline physical line numbers and Unicode field limits.
3. Independently compare the reader with the authenticated CPython 3.14.2 profile
   in docs/csvkit/reference-profile.json. Keep native oracle use out of canonical
   tests and product code. Record measured cohorts and explicit gaps separately.
4. Have a different agent stress/fix reader state transitions. Root owns public
   exports and operation integration; preserve command blockers for unqualified
   typed-cell consumers.
5. Run uncached csvkit workspace tests/lint and the maintained explicitly selected
   workspace build closure. Run the four maintained safe-bash csvkit command test
   files through Node's test runner with tsx and test concurrency 1.
6. Render actual Shell csvcut multiline numbering and field-limit diagnostics via
   terminal-png, inspect the image in out, and delete owned temporary evidence.
7. Report reference cohort scope, test TODOs and remaining suite blockers. Do not
   edit README content, stage, commit, push or publish.
8. On subsequent reader stress passes, include empty iterator items and ordinary
   characters after escaped CR/LF. Preserve CPython's continuation state until
   a delimiter, escape or unescaped newline changes it. Distinguish public
   reader iterator cases from the command engine's normalized physical lines.
