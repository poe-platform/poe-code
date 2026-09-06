---
title: Generator member continuations
---

## Validated gap

Twelve initial native-comparison cases failed because restoration reevaluated
the object selected before a yield in a computed property expression. Two
optional-chain controls passed because their property expression was skipped.

## Change

Preserve the selected object and optional super receiver while the computed
property is suspended. Serialize the continuation and validate that it belongs
to the suspended property's AST ancestry, including exact super-receiver phase.
The shared member-access path also serves method calls, deletion, updates and
assignment keys. Suspending in an assignment's right-hand value remains a
separate validated gap; this change does not claim to fix that continuation.

## QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-generator-member-continuations.md` and inspect the screenshot.
Expect a passed harness with zero spawns and no warnings. The pair asserts one
receiver selection and property value 7. It grants no capabilities. Repeated
low-level restore is independently checked against native JavaScript by tests.

## Verification

All 22 sync/async focused cases pass, covering nested members, nullish errors,
optional chains, getters, method calls, deletion, updates, computed assignment
keys and super receivers. The full package suite passed 15,400 tests with 41
existing skips. Focused lint, package types and the maintained selected-workspace
build passed, including four built-import tests. The CLI harness passed with
zero spawns; its screenshot was inspected with no warnings or errors.
