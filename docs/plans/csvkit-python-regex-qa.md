# Python regex QA

1. Authenticate the CPython 3.14.2 executable against reference-profile.json.
   Capture standard-library compile/search/error/warning observations separately
   from command observations; preserve their exact scope in docs/csvkit.
2. Reproduce each implementation change with an original failing in-memory test.
   Canonical tests read frozen JSON observations and run only the TypeScript VM.
   Never launch Python, grep, other native programs or a database from unit tests.
3. Have a separate agent stress empty-match repetition, Unicode codepoint ranges,
   assertion widths, cancellation identity, work refusal and the actual Shell
   plugin. Root owns engine integration, existing integration tests and Git.
4. Run npm test and npm run lint for @poe-code/csvkit and its maintained selected
   workspace build closure. Run actual safe-bash csvgrep stress/user-edge tests
   through node:test/tsx and focused lint; build the selected safe-bash closure.
5. Render actual compiled Shell regex output, inspect its screenshot, and purge
   only the newly generated temporary evidence from out.
6. Report supported reference comparisons separately from refusal assertions.
   Skips, TODOs, unmeasured features, warning provenance, syntax-error messages,
   native service profiles and full-suite acceptance remain blockers.

Remaining implementation includes frozen Unicode word/case tables, captures and
backreferences, conditionals, scoped/verbose flags, atomic/possessive operations,
remaining escapes and exact Python error/warning disposition. This procedure
does not authorize README additions, staging, commits, pushes or publication.
