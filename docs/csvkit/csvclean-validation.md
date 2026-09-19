# csvclean implementation scope

The executable grammar and implementation live in
`packages/csvkit/src/commands/csvclean.ts`. Both original-name argv execution and
SDK settings invoke this engine, including safe-bash's existing explicit csvkit
registration. No native/Python product fallback or ambient filesystem/driver is
used.

Reference: `darwin-cpython-3.14.2-csvkit-2.2.0` in `reference-profile.json`;
source SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
The source-flow audit seals `csvkit/cleanup.py` and
`csvkit/utilities/csvclean.py`; nine original-name captures in
`additional-operation-reference.json` cover checks, fill, normalize, labels,
numbering, empty input, option errors and the released join/check failure.

The exact flag inventory has no duplicate spelling or -n. -a means
`enable_all_checks`; -l adds writer line numbers to each output channel. Header
normalization uses Python whitespace; diagnostics use physical reader line minus
one. Omission depends on row length, including when checks are disabled. Empty
column warnings appear after row errors and do not delete full-width data rows.

The original retained-join regression accepted 80 one-cell candidates under a
4096-byte retention budget. Candidates are now admitted to the runtime retention
budget even without length checking, and shared error/candidate rows are counted
once. This budget is conservative cumulative accounting, not a peak RSS claim.

Released 2.2.0 attempts to remove the current successful join's error before it
has been appended. With length checking enabled this can emit
`ValueError: list.remove(x): x not in list` after prior stdout. This frozen
behavior is preserved, rather than corrected into hypothetical intended behavior.

Explicit remaining shared blockers: reader quoting modes 2/4/5 are status 78;
external driver/locale/TTY/encoding profiles are not exhaustively qualified by
these focused tests. The complete csvkit suite is not certified by csvclean
qualification alone. README, Git staging, commits and release delivery are outside
this change.

## Current checks

- TDD: retention regression failed with status 0 instead of 78, then passed after
  candidate admission was added; all nine frozen csvclean captures stayed exact.
- csvkit maintained unit suite: 1853 passed, one skipped, six TODO; skips/TODOs
  remain explicit unqualified cases. csvkit lint and build closure passed.
- safe-bash build closure passed. All 34 focused csvclean/csvgrep/registration
  integration tests passed, including 15 independently authored csvclean stress
  tests. Integration-input registration suite: 109 passed.
- safe-bash maintained typecheck passed, including all 26 current consumer groups
  and expected negative-consumer rejections. Two stress-test tuple annotations
  corrected inference errors exposed by the first typecheck, without changing
  their inputs or runtime behavior.
- A mistaken file-selector environment variable did not filter the normal
  safe-bash test runner. That full run was deliberately stopped and is incomplete,
  not a full-suite pass. Focused tests were subsequently run by exact test path.
- Root `npm run lint:eslint` was stopped after approximately six minutes without
  a result or diagnostic output. It is incomplete and is not a root-wide lint
  pass. The maintained csvkit lint and safe-bash source/test/consumer typechecks
  completed successfully.
