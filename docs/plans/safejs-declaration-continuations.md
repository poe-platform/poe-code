---
title: Declaration progress continuations
---

# Declaration progress continuations

## Validated defect

Six sync/async regressions showed earlier declarators restarting when a later
initializer or binding suspended. `const` and `let` produced redeclaration
errors; `var` repeated initializer effects. Native execution performs each
completed declarator once.

## Implementation

Record the active declarator index and resume evaluation at that index.
Preserve ordinary predeclaration and TDZ behavior; do not suppress duplicate
binding errors or replay earlier initializers. Iteration declarations use the
same index-zero state so snapshot source validation remains uniform. Validate
the index against the suspended declarator's AST ancestry.

## Verification

All 19 expanded cases pass, covering successive suspensions, earlier
destructuring, loop initializers, uninitialized var declarations and malformed
snapshot positions. Existing default and for-in continuation tests also pass.
The maintained package route passed 15,678 tests (41 skipped), without
exclusions. Changed-file lint, package types and the selected workspace build
passed. Tests finished before builds began. The CLI harness passed with zero
spawns; its screenshot was inspected without warnings. Publication is separate.
The existing wrong-index corruption test now selects the array continuation
explicitly and preserves the other records, rather than assuming array state
is the first entry. Its focused cohort passes all 27 tests.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-declaration-continuations.md` and inspect the PNG. Expect a
passed harness, zero spawns and no warnings. This skill-guided pair grants no
capabilities. Unit tests verify restoration; the CLI smoke checks ordinary
execution of a multi-declarator generator.

## Next validated gap

Delegated `yield*` initially resumes at the correct yielded element but repeats
its source expression on every restoration. An iterator over `input()` yielding
2 and 3 finished with a call count of 3 after two restorations; native execution
finished with 1. Retaining the delegated iterator/source needs a separate fix.
That follow-up is tracked in `safejs-yield-delegate-continuations.md`.
