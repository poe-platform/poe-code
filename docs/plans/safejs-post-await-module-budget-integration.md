# Await and stored-module budget integration

## Runtime under test

Local main `f535553f4` includes the independent executable-await/restore repair
`2b376fd7a` and stored-module budget repair `f535553f4`. Both reproduced failures
on main before implementation. Their plans record focused verification and
the 4,560-test combined isolated qualification. Main checks passed, and the
maintained workspace build completed 23 build tasks plus five import checks.

## Full package gate

Session 65053 runs:

`npm test --workspace=@poe-code/safe-js -- --reporter=default --reporter=json --outputFile=/tmp/safejs-post-await-module-budget-integration-results.json`

This is a new run after terminal session 63590. Keep main runtime and test
sources fixed until terminal; use isolated copies for further experiments.
Do not restart a quiet live run. Record the complete result before claiming
integration success.

The previous full run passed 28,578 tests, failed 14, and skipped 47 across
1,258 actual test files. Its failures concern Promise property imports and
ISO/Temporal month formatting. The earlier collection-cursor failure did not
recur, but no unrelated change is claimed to fix it.

## Completed result

Session 65053 terminated with exit code 1 (5d887c). The full package gate
passed 28,606 tests, failed 14, and skipped 47 across 1,260 actual test files.
The filesystem contract stage passed all 100 cases earlier in this same run.
Elapsed unit-test time was 1,071.91 seconds.

The JSON report was compared by failing test name and file with the preceding
operator-grammar report (fae6bb): there are no new failing cases. The remaining
14 are the two native Promise property-admission cases and twelve ISO/Temporal
month-name cases. The executable-await and stored-module budget fixes add
28 passing tests relative to the preceding completed gate. This is evidence
for these repairs, not a green full-worktree gate or complete JavaScript parity.

The independently modified Promise settlement candidate was not part of this
run. Its qualification remains separate.

## Delivery status

These are local commits, not remote-main delivery or a release. No push,
publication, or issue closure occurred. Releases remain on hold.
