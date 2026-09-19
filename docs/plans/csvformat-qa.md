# csvformat implementation and QA

Implement the literal csvkit 2.2.0 executable in the domain command file. Keep
its source-derived argument actions and independent input/output dialects.
Do not stage, commit, publish, or alter README content.

1. Verify the downloaded source archive against the requested SHA-256 and inspect
   csvformat.py, inherited reader arguments, and original utility regressions.
2. Reproduce the original German number-locale regression with in-memory unit
   input, then implement the fix and rerun the test.
3. Restore the frozen CPython 3.14.2 environment under out using hash-locked
   dependencies; verify the interpreter hash and capture exact observations in
   docs/csvkit/csvformat-reference.json. Reference processes are research only.
4. Exercise CLI and SDK dialect independence, ASV/tabs precedence, generated and
   omitted headers, raw ragged rows, number/text/null inference, custom quote,
   escaping failures, arbitrary terminators and invalid character lengths.
5. Have an independent agent stress the real safe-bash registry and virtual
   filesystem, including completed redirection effects and input preservation.
6. Run maintained csvkit build closure, workspace tests and lint. Run focused
   safe-bash registration/writer tests, inventory discovery and file lint.
7. Inspect an ad hoc screenshot of actual shell output. Purge only this task's
   temporary reference environment, archive, observations and screenshot evidence.

Unsupported input quoting types, warning deployment identities, other locales
and the unmeasured older CPython profile remain blockers, not compatibility
passes. The existing suite's unrelated skips/todos retain that status.
