# Issue 692: bounded arithmetic for loops

## Validated scope

Implement `for ((init; condition; step)); do BODY; done` using the existing
arithmetic evaluator. The initial memory-only tests recorded ten missing-loop
failures and one passing standalone `(( ))`/while parity control in
`/tmp/poe-692-red.log`. The public Shell reproduction independently failed in
`/tmp/poe-692-public-red.log`. Searches of maintained shell test/case files found
no stale arithmetic-for refusal assertions to change.

Support empty clauses, optional separator before `do`, multiline headers,
ordinary compound redirections and use as a function body. The existing
arithmetic expression profile remains authoritative, including its positional
parameter support and deliberate unsupported expression forms. This does not
add general shell expansion inside arithmetic expressions, alternate brace
loop bodies, job control or other omitted shell syntax.

## Implementation and semantics

A dedicated arithmetic-for AST stores three optional existing ArithmeticPrograms
and the body. The parser scans the header under the parse-unit budget, respects
parenthesis nesting and requires exactly two top-level semicolons. Retained
clauses are prepared by the same parser as standalone arithmetic commands.
Empty initialization/step are no-ops and an empty condition is true. Function
display prints the new AST without losing its clauses.

Runtime shares the standalone command's arithmetic-value evaluation path rather
than adding another arithmetic engine. Initialization runs once; the condition
runs before each body; the step runs after normal completion or `continue 1`.
Existing loopBody control propagation means break/return skip the step, while
`continue 2` skips the inner step and reaches the outer loop's step. A loop with
no body execution returns 0; otherwise successful completion returns the last
body status.

Header truth values are not command failure statuses. Ordinary header arithmetic
errors emit the existing arithmetic diagnostic and return loop status 1 without
triggering `set -e` themselves; a failing body retains normal errexit behavior.
Cancellation, quota failures and existing control errors are never converted
into ordinary arithmetic diagnostics.

Each condition attempt uses the shared maxLoopIterations budget and a
cooperative task yield. Body commands retain the shared command/output budgets.
Header scanning, expression preparation, evaluator operations, positional
expansion bytes and owned values retain existing limits. No new limit knobs or
host-shell fallback are introduced.

## Qualification and validation

GNU Bash 5.2.37 on Darwin provided exact semantic evidence in
`/tmp/poe-692-arithmetic-for-oracle.json` and
`/tmp/poe-692-arithmetic-for-edge-oracle.json`. Native executable paths in error
prefixes are not product expectations. A root timing probe did not substantiate
an extra-yield slowdown: the timer-only 100-iteration cases measured 257 ms for
arithmetic-for and 273 ms for the equivalent while loop; this is a bounded
single comparison, not a general performance guarantee
(`/tmp/poe-692-yield-perf.log`).

The focused arithmetic-for, existing shell-language and select tests pass
246/246 in 1.53 seconds (`/tmp/poe-692-focused.log`). They cover standalone
condition parity, empty/newline clauses, ordering/side effects, nested flow,
function display, header errors under errexit, malformed headers, loop/command/
parse/output caps and original false/object cancellation with recovery.
Tests operate in memory only. Strict NodeNext checking passes in
`/tmp/poe-692-types.log`, using:

```sh
node ../../node_modules/typescript/bin/tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --types node tests/shell/arithmetic-for.test.ts
```

Exact integration-test admission passes 100/100 in
`/tmp/poe-692-admission.log`; independent source review approved the change.
All focused checks completed before the build handoff.

The independent source public consumer passes 25/25 cases in
`/tmp/poe-692-public-first.log`. The root coordinates final normal build,
installed Node/Bun/browser/workerd qualification, visual inspection, guarded
lint and atomic delivery; these local checks do not establish publication.

## Final integration qualification

The maintained normal build passed (`/tmp/poe-692-build.log`), including the
workspace closure and root generation, TypeScript and bundle stages. The
installed candidate at `/private/tmp/poe-692-public-q5yn2ki7` passed 25 checks
each on Node, Bun, browser and actual workerd. All three strict public type
profiles and the 44/43-input browser/workerd graph checks passed. The root
visually inspected `screenshots/node-demo.mjs.png`: the arithmetic-loop command
prints the expected three completed steps.

The final maintained `npm run lint` passed in 244.96 seconds: all 10,519
configured files, zero errors, zero warnings and 25 receipts, followed by
successful type and workflow checks (`/tmp/poe-692-lint.log`). Files remained
frozen throughout this gate. These checks establish local qualification, not
release publication.
