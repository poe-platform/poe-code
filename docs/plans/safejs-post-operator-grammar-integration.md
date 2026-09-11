# Post-operator grammar integration

## Runtime under test

Local main `a5919f095` includes separate commits for yield precedence
(`224ded2c5`), await exponent bases (`ed0d2e565`), and numeric coercion order
(`a5919f095`). Each reproduced failing tests on main before implementation.
Focused verification and candidate/native audits are recorded in their plans.
The maintained selected-workspace build passed 23 build tasks and five
fresh-process import checks (7648e6).

## Full package run

Command:

`npm test --workspace=@poe-code/safe-js -- --reporter=default --reporter=json --outputFile=/tmp/safejs-post-operator-grammar-integration-results.json`

Session 63590 is terminal. It was a new run after terminal session 5721, not a
restart. Main runtime/test sources stayed unchanged for the run.

The console and JSON report agree: 28,578 passed, 14 failed, 47 skipped across
1,258 actual files (851795). All 100 filesystem contracts passed beforehand.
The 14 failures are the known Promise property-import and ISO/Temporal month
formatting cases. No additional failure appeared in this run. The previously
failing raw Set-update cursor case passed in 10.93 ms; this is non-recurrence,
not a claim that an intermittent failure was fixed by an unrelated change.

The source freeze is lifted. The ordinary-await and stored-module budget
repairs remain separate pending integration work.

The previous full run passed 28,448 tests, failed 15, and skipped 47 across
1,255 actual test files. Fourteen failures concern Promise property imports
and ISO/Temporal month formatting. The additional Set cursor checkpoint
failure did not reproduce in a focused 112-test run and remains unresolved.
Do not raise timeouts, remove coverage, or invent a runtime fix for that case.

## Delivery

All three repairs are local commits only. No push, publication, or issue
closure is claimed. Releases remain on hold.
