---
title: Completed destructuring defaults
---

# Completed destructuring defaults

## Validated defect

Six sync/async declaration and assignment cases repeated a completed default
initializer after restoration suspended in its nested binding target. An
observable initializer counter returned 2 instead of the native result 1.

## Implementation

Reuse the evaluated pattern-source continuation for an assignment pattern's
nested array/object target. Capture the selected input/default value only
after evaluation finishes. Resume its target with that value, without
reevaluating the default. A defined input continues to bypass the default.
Retain the value during binding and validate its source ancestry in snapshots.
Member-reference preparation remains before default evaluation.

## Verification

All 18 expanded regressions pass, including repeated restoration, yielding
defaults, skipped defaults, for-of bindings and invalid snapshot state.
The initial focused cohort also passed the existing array/object pattern tests.
The maintained package route passed 15,659 tests (41 skipped), without
exclusions. Changed-file lint, package types and the selected workspace build
passed. The CLI harness passed with zero spawns; its screenshot was inspected
without warnings. Tests completed before builds began, avoiding replacement
of built dependencies during test execution. Publication is tracked separately.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-pattern-default-continuations.md` and inspect the PNG. Expect
a passed harness with zero spawns and no warnings. This skill-guided pair grants
no capabilities. Unit tests verify portable restoration; this smoke test checks
ordinary CLI execution of the same nested-default behavior.

## Next validated gap

A declaration containing multiple declarators restarts earlier declarators
when a later initializer or pattern suspends. A direct restoration probe of
`const first=input(),[second=yield 1]=[]` threw a redeclaration error for `first`,
where native execution returned `[1,2,4]` for `[count,first,second]`. Declaration
progress needs a separate continuation rather than suppressing redeclarations.
