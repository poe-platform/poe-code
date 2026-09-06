---
title: Generator tagged template continuations
---

## Validated gap

Twelve sync/async native comparisons failed before the fix. Restoration
repeated tag selection, receiver selection, getters and completed substitutions.
Nested tagged templates and successive suspension points repeated effects too.

## Change

Use the existing call-continuation machinery to retain the resolved tag,
receiver, substitution values and current index. Restore validates the saved
continuation against the exact tagged-template substitution in the source.
Remove the separate substitution evaluator in favor of the maintained argument
evaluation path. Ordinary templates retain their independent prefix state.

## QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-generator-tagged-template-continuations.md` and inspect the
screenshot. Expect a passed harness, no warnings and zero spawns. The harness
asserts count=2, receiver id=7 and substitutions 1 and 4. It grants no external
capabilities. Low-level restoration correctness is independently established by
repeated native-comparison unit tests, not inferred from this CLI smoke check.

## Verification

All 15,320 package tests passed (41 existing skips), including the twelve new
sync/async native comparisons. Focused lint, package types and the maintained
selected-workspace build passed, including four built-import tests. The CLI
harness passed with zero spawns; its screenshot was inspected with no warnings
or errors.

## Separately validated follow-ups

A repeated call at the same tagged-template source site returns a fresh template
array, whereas native JavaScript preserves its identity. A non-callable tag
throws before evaluating substitutions, whereas native JavaScript evaluates
them first. These remain separate fixes; this continuation change does not
claim to resolve them.
