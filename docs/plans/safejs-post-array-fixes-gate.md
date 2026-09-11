# Post-array-fixes integration gate

## Scope

The checkout at local commit `03759fa10` includes sort comparator-order repair,
Proxy result writes in array factories, typed-result guest coercion, and direct
or inherited Proxy iterator acquisition ordering. Existing modified/untracked
tests were preserved and participate where selected by the maintained package
test command. This is a checkout-level gate, not a clean-commit-only claim.

## Maintained build

`npm run build:workspaces -- --workspace=@poe-code/safe-js` completed successfully
on Node 22.23.2. The maintained dependency closure ran 23 workspace builds;
SafeJS postbuild passed all five fresh-process import checks (398867).

## Full package test in progress

Started `npm test --workspace=@poe-code/safe-js -- --reporter=json
--outputFile=/tmp/safejs-post-array-gate.mjDJgT/results.json` in session 81518.
This keeps the package's native pretest filesystem contract route. The JSON
report is a temporary diagnostic artifact, not a repository source file.
Inspect the existing session until terminal; do not start a duplicate because
the JSON reporter emits no per-test progress.

Runtime sources are held unchanged during this gate. The previous terminal
full-package result remains 27,506 passes, 34 failures and 48 skips until this
run completes. A build pass and focused test passes are not a full-suite pass.

## Concurrent read-only qualification

A strict source-level probe of Test262 `test/built-ins/RegExp/escape`, pinned at
`72faf8ec1445c55149615e8b35187830783aba1a`, passed 19 guest cases and 19 fresh
native Node 26.8.1 controls. `cross-realm.js` cannot run in the current adapter
because `$262` is unavailable; it is not counted as passed. No metadata exclusions
were encountered. The probe loads assertions and declared harness includes in
memory and is not the official runner or a full conformance result. It justified
no runtime change.

No push, issue closure or release was performed; release hold remains active.

## Terminal result

Session 81518 completed with exit 1 (6c0c98). Its JSON report records 27,619
passed tests, 14 failed and 48 skipped, across 1,218 files with four failing
files. Test start to final recorded end is 1,196.94 seconds. All 100 filesystem
type contracts had passed. No timeout failure is reported.

The failures are two Promise own-property admission cases, six ISO standalone
month/range cases, three PlainMonthDay locale cases and three PlainYearMonth
locale cases. The latter three fail their native month-name precondition.
The report lists no other failing files. This is an improvement over the prior
34-failure gate but not a green package result.

The two new JSON reviver regression files are absent from this run's discovered
test list, as expected from their creation after launch. Runtime source remained
unchanged until completion; the subsequent JSON repair is verified separately.
