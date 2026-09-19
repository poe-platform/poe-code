# Diagnostics validation, September 18, 2026

This increment adds the diagnostics domain module and connects it to the existing
shared CLI/SDK engine. It does not implement or certify all csvkit 2.2.0 behavior.
See [the diagnostic contract](../specs/csvkit-diagnostics.md) and
[manual QA](../plans/csvkit-diagnostics-qa.md).

Original failing regressions reproduced unconditional verbose refusal and delayed
ENOENT escaping as a host Error. A later failing regression reproduced synchronous
readStream acquisition escaping the same handler. Another red case reproduced
invalid frame metadata being accepted. Domain fixes followed those failures.
An additional red regression showed structured exceptions adding an unwanted
class prefix inside argparse's eager FileType error. Exception messages now carry
the Python detail; the uncaught handler alone adds the class prefix.
The independent stress agent separately reproduced the actual Shell ENOENT leak
and verified the integrated fix.

Final selected checks completed:

- `npm test --workspace=@poe-code/csvkit`: 304 executed tests pass, including nine
  new diagnostics tests. These are in-memory cases, not 303 new upstream cases.
- `npm run lint --workspace=@poe-code/csvkit`: ESLint, product TypeScript and test
  TypeScript checks pass.
- `npm run lint:eslint`: guarded repository invocation completes with zero
  errors and two warnings in the existing docx tests. This broad invocation
  overlapped final edits; subsequent focused domain checks cover the final
  diagnostic exception-message fix and exact eager-error regression assertion.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: maintained
  selected closure and native postbuild stages pass, including csvkit and nine
  other required workspace builds. No task cache substitution was used.
- Focused node:test execution of the two existing registered safe-bash csvkit
  integration files: 65 tests pass. Independent stress file: 61 tests pass.
  Pipeline stage tests pin observed small-output `[0, 0]` and backpressured
  producer-close `[141, 0]`, both with aggregate status 0, header-only stdout and
  empty stderr. These measure safe-bash semantics, not a native SIGPIPE oracle.
- `npm run typecheck --workspace=@poe-platform/safe-bash`: source/tests and 26
  current consumer groups pass, including expected negative consumer controls.
  This is declaration qualification, not runtime service acceptance.
- Compiled public-import VFS commands were rendered via the repository screenshot
  tool and visually inspected. `csvcut -v input.csv`, `csvcut missing.csv` and
  `csvcut -v missing.csv` showed readable output/statuses 0, 1 and 78 without
  clipping. The owned temporary screenshot in out was removed after inspection.

The selected build runner accepts one workspace selector; an initial attempted
two-selector invocation was rejected before running tasks. The corrected
safe-bash selector derived and built the required dependency closure successfully.

Filesystem error expectations in this increment are source-derived, not fresh
frozen native csvkit measurements. Basic explicit-frame and warning-format tests
exercise the authored contract, not exact deployment traceback or warning-emission
parity. Exact traceback identity, chained/caret diagnostics, warning filters and
source emissions, unmeasured type/date/codec/database cases, and regex/match-file
csvgrep execution remain blockers. No full repository unit-suite pass is claimed.
No README additions, staging, commits, pushes or releases were performed.
