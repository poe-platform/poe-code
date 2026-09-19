# csvclean user edge QA

## Procedure

1. Verify the released source archive SHA-256 against the original task.
2. Load the archive's unmodified `csvkit/cleanup.py` in a reference-only
   CPython process. Exercise every three-row sequence from blank, one-cell,
   two-cell, three-cell, four-cell, empty-cell and multiline records, under
   seven check/fix profiles. Use in-memory CSV streams with newline output.
3. Compare all 2,401 cases with SDK engine execution: exact stdout, stderr
   and status, including partial output and released join exceptions.
4. Run canonical in-memory regressions for companion options that do not
   enable a check/fix, and overridden shared or historical output flags.
5. Have an independent agent extend literal safe-bash invocation coverage.
   Run its stress cases, including cooperative cancellation, awaited sinks
   and injected filesystem redirection.
6. Run the maintained csvkit unit, lint and selected workspace build closure.
   Remove this run's temporary scripts, archive and differential output from out.

## Results and limits

On 2026-09-18 all 2,401 source RowChecker differentials passed under CPython
3.14.2. The archive matched SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`. This is a
reference-only comparison of the released cleanup class using standard-library
CSV string-mode reading/writing, not an additional full Agate executable capture
or qualification of every shared parser, codec or runtime profile. Existing
frozen full-executable captures remain canonical.

Two domain regression groups and nine independent safe-bash edge cases were
added. No product defect was reproduced; no engine fix was needed. The csvkit
unit route passed 1,855 cases, with one skip and six TODOs remaining explicit
unqualified cases. The independent safe-bash stress suite passed 24 cases.
Maintained csvkit lint (ESLint and both TypeScript configurations), its selected
workspace build closure, and focused safe-bash stress-test ESLint passed.
Unsupported input quoting modes 2/4/5 and previously documented external
driver/locale/TTY/encoding qualification gaps remain blockers. This finite
cohort does not claim exhaustive compatibility.
