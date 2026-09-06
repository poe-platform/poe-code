---
title: Destructuring source continuations
---

# Destructuring source continuations

## Validated defect

Four failing sync/async generator regressions demonstrated that declaration
initializers and assignment right-hand sides execute again when restoration
resumes inside their destructuring targets. A counter returned 2 rather than
the native result 1. Assignment expressions must also return the original
right-hand-side value, including its identity.

## Implementation

Retain the evaluated source value at the variable declarator or destructuring
assignment node while binding its target. Restore that value directly rather
than evaluating the initializer/RHS again. Encode it in the guest heap and
validate that the continuation belongs to a suspended target in the source AST.
Keep the source retained against resource accounting throughout binding.

## Verification

The original four regressions and existing partial-pattern/for-in tests pass.
All 19 expanded cases pass, covering repeated restoration, object patterns,
member targets, assignment-result identity and public snapshot corruption.
The maintained SafeJS unit route passed 15,610 tests (41 skipped), without
exclusions. Changed-file lint, package types and the selected workspace build
passed. The skill-guided CLI harness passed with zero spawns, and its screenshot
was inspected without warnings. Remote delivery and publication are separate.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-pattern-source-continuations.md` and inspect the PNG. Expect
a passed harness with zero spawns and no warnings. This skill-guided pair
grants no capabilities. It checks ordinary generator behavior in the CLI;
portable restoration and source identity are verified in unit tests.

## Next validated gap

Restoring `const {first,second=yield 1}={first:2}` still tries to bind `first`
again and throws a redeclaration error; native execution returns `[2,4]`
after sending 4. Source evaluation is now retained, but object patterns still
need their own partial binding, property-key and rest-exclusion continuation.
