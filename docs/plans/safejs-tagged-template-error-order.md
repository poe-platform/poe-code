---
title: Tagged template error order
---

## Validated gap

Non-callable tags rejected before evaluating substitutions. Nine new native
comparisons failed: five ordinary cases and four sync/async generator cases.
Two controls verify that tag property/getter errors still precede substitutions.

## Change

Check callability after substitution evaluation. This lets substitution errors
win and permits a generator to suspend before a later non-callable-tag error.
Existing continuation state retains completed substitutions across restoration.

## QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-tagged-template-error-order.md` and inspect the screenshot.
Expect a passed harness, no warnings and zero spawns. The harness asserts that
the substitution increments count before the TypeError. It grants no external
capabilities. Repeated low-level generator restoration is separately covered
by native-comparison unit tests.

## Verification

All 15,331 package tests passed (41 existing skips), including the nine new
regressions. Focused lint, package types and the maintained selected-workspace
build passed, including four built-import checks. The CLI harness passed with
zero spawns; its screenshot was inspected and showed no warnings or errors.
