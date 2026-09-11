# Post-source-identity package gate

The maintained `npm test --workspace=@poe-code/safe-js` route was started after
local commit b6d705b28. This is a full package check, not a root-only unit shortcut.
All four filesystem contract configurations passed (100 contracts total).
The unit suite is running and has emitted failure markers; final diagnostics and
counts are pending. Runtime files are being kept unchanged during this run.

While it runs, test-only mixed-source coverage was expanded with private class
fields, pending async functions, suspended async generators and generator finally
blocks. Each second source has a different AST layout. All 12 mixed-source tests
pass on the current runtime; TypeScript and focused lint passed. These tests
do not make the full package gate green.

The previous full package gate had 27,437 passes, 10 failures and 48 skipped tests.
Its failures remain tracked until fresh evidence establishes their disposition.
Do not attribute the current markers to those failures before reading terminal
diagnostics. Pushes and releases remain paused.

Further test-only qualification adds derived-class method `super`, derived
constructor `super()`, direct-eval lexical closures and dynamic Function bodies
from distinct source texts. All 16 mixed-source cases pass after two JSON
snapshot round trips on Node 22.23.2 (efbfbe) and Node 18.20.8 (56b792).
These paths did not reproduce a defect, so no runtime fix was made. The full
package run remains live; its runtime source has not changed. Test-only edits
made after launch are independently qualified and are not claimed to have
been discovered by that already-running gate.

## Terminal result

Session 66781 terminated with exit 1 (28274f): 27,506 passed, 34 failed and
48 skipped tests; 1,201 passed, nine failed and two skipped files. Duration was
1,069.77 seconds. All 100 filesystem contracts had passed. Runtime sources
remained unchanged through completion. The later descriptor repair is not part
of this result.

Visible failures include CLI help loading interpreter globals through snapshot
validation, Date heap-node expectations, boxed-number accessor snapshot
expectations, regex compile-policy cases, a legacy dump-graph shape comparison,
and the six known ISO month-name failures. Terminal output was truncated by the
tool, so this is not a complete failure-by-failure diagnosis. Recover or re-run
the failed selections before deciding which are implementation bugs versus
outdated assertions. Do not dismiss either category or claim a green package.

After the template-cache import repair, the two regex policy files pass their
budget enforcement cases unchanged. Their remaining legacy graph assertion and
the corresponding f16round comparison are reconciled by a narrowly checked
guest-regex format transition in the test helper. The four-file selection has
89 passes and one skip; see safejs-legacy-regex-graph-reconciliation.md. These
focused results do not replace the recorded full-package result.

## Focused remaining-failure check

Current-source selection after e186533e4: 160 passed, 14 failed and one skipped
(df1c30), across twelve actual files. All CLI-help, Date, accessor-boundary,
regex-policy, legacy f16round, buffer-compatibility and camera cases in this
selection pass. Remaining failures are the two native-Promise property tests,
six original Temporal ISO locale cases, and six new ISO standalone/range cases.
The extra historical intrinsic-retention-streaming filename filter matched no
current file and contributed no tests. Cached file-failure rows were not treated
as authoritative current membership. No full-package green result is claimed.
