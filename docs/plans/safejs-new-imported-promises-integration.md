# Newly imported settled-Promise integration gate

Runtime commit: `25f9bb944` (local only).

The repair supports completed replay for newly encountered settled imported
Promises, with canonical cross-outcome identity, original settlement capture,
queued reconstruction, combined depth checks, rollback, and owned compilation.
Pending newly encountered imported-Promise checkpoint reconciliation remains
unfinished and has a failing regression only in an isolated candidate.

Pre-commit evidence:

- Qualified combined candidate: 2,781 tests across 189 files (3e768e).
- Main focused selection: 92 tests across eight files (0d03af).
- Main runtime/test files matched the qualified candidate (ffc9e2).
- Maintained workspace build: 23 declared builds and five built-import checks
  passed (c12834).
- Scoped lint passed (5b32b8); diff whitespace checks passed.

The maintained full package route is running as session 14148:

`npm test --workspace=@poe-code/safe-js -- --reporter=default --reporter=json --outputFile=/tmp/safejs-new-imported-promises-integration-results.json`

It started the native pretest route in 4a8442. Do not infer completion from a
quiet interval or restart a live handle. Keep main runtime and test sources
fixed until the run is terminal; continue unrelated experiments in isolated
copies. Record terminal counts and compare exact failures with the previous
full report before claiming no regression.

Previous full report:
`/tmp/safejs-post-promise-settlement-integration-results.json` had 28,627 passed,
15 failed, and 47 skipped across 1,264 files. Failures covered Promise own
metadata admission, ISO/Temporal month names, and the adversarial corpus.
Those remain unresolved; this repair does not claim to fix them.

No pushes, tags, releases, workflow dispatches, or issue closures during the
release hold. Report local commits, remote delivery and publication separately.
