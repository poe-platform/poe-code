---
title: Lazy Iterator helpers
---

# Lazy Iterator helpers

Follow the consuming-helper delivery with map, filter, take, drop and flatMap.
Their absence was confirmed by the built-SDK probe recorded in
safejs-iterator-helpers.md; reproduce each behavior with failing tests before
implementation.

Use shared helper next/return methods with private per-helper state. Required
states are suspended-start, executing, suspended-yield and completed. Next/return
must reject reentry, suppress caller arguments, and clear retained state on
completion. Return before first next must still close the underlying iterator.
For flatMap, preserve and close both outer and active inner iterator records.

Tests must distinguish construction from consumption, cached next from dynamic
return lookup, validation errors from iteration errors, and callback failures
from cleanup failures. Include fractional/NaN/negative/infinite limits, callable
receivers, primitive inner values, wrong brands, prototype mutation, captured
callbacks, retained-state budgets, direct snapshot cursor execution and malformed
heap nodes. Preserve cleanup error precedence from the current specification.

Primary reference: https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html

Do not use eager array materialization for these helpers. Keep the existing
shared Iterator prototype and maintain CLI harness/screenshot validation.

After consumer delivery at 86aa6fc32, eight isolated native-comparison cases
failed in 1.50 seconds. They cover all five transformations, no eager next calls,
return before first next, generator cleanup and flatMap inner/outer closing.
The failures were missing-method errors. The initial runtime implementation now
passes all eight cases. Three additional retained-state budget tests failed
(measured 1 instead of at least 200) before private outer/inner/callback traversal
was added. All 67 focused lazy/from/consumer tests then passed in 2.35 seconds.

A JSON snapshot regression now concretely demonstrates the remaining missing
helper state: the restored helper has no private state, rather than suspended
yield with callback index 1. Latest focused run: 11 pass, this one fails, 1.66
seconds. Implement snapshot encoding, validation and restoration next, and
extend the test to actually consume the restored cursor before delivery.
This work remains uncommitted and is not yet ready for release.

Implemented a dedicated iterator-helper heap node with private cursor/callback
references, helper mode, lifecycle, counters and full object properties/prototype.
Infinite limits use an explicit JSON-safe representation. Validation rejects
executing/unknown modes, invalid counters, missing live cursors, unexpected
completed callbacks and invalid iterator references.

Direct JSON restoration now executes all five helper modes to completion,
including an active flatMap inner cursor and an infinite take limit. Eight
malformed-node tests pass. Combined helper/from/consumer run: 81 pass in 2.72
seconds. Three subsequent public dump/replay cases across await also pass;
latest lazy-helper file: 28 pass in 1.84 seconds. Changed runtime files passed
ESLint; package TypeScript compilation passed. Expanded behavioral edge cases,
test-file type checks, full package validation and paired CLI harness/screenshot
remain before the atomic commit/push.

Independent preceding consumer release publication verified at
2026-09-07T18:20:24.5847710Z: @poe-platform/safe-js@0.1.389,
workflow 34150974382. Its CLI workflow 34150974695 was still running when checked.

Expanded native-oracle cases now cover metadata, fractional/infinite limits,
cached next and suppressed arguments, skipped drop value getters, strict callback
receivers, reentry, wrong brands and inner/outer cleanup error precedence.
All 43 lazy-helper tests passed in 1.95 seconds. Root lint:types and changed-file
ESLint passed. Test-only TypeScript check caught a duplicate callback property
in the budget fixture; explicit field initialization corrected it and the check
now reports zero diagnostics. Added a paired no-spawn CLI harness following the
SafeJS skill; runtime/screenshot validation remains pending.

Full maintained SafeJS unit route started in terminal session 82659. Its sole
exclusion is the existing unrelated, unresolved host-Promise import policy probe
promise-import-properties.test.ts; no lazy-helper coverage is excluded.
Do not start duplicate tests or concurrent heavy builds while this session runs.
Protected user-staged patch ID remains d770ec782b2a4ae7e2580e63ded765933890a1c5.

While full suite 82659 remains live, read-only review identified another boundary
to test after it finishes: native structuredClone rejects both lazy helpers and
Iterator.from wrappers with DataCloneError (direct Node probe confirmed both).
The current cloneStructuredGraph rejection list does not explicitly include
either private WeakMap brand. This is a candidate, not yet a validated SafeJS
mismatch; add a failing test before changing clone behavior. Keep any preexisting
wrapper correction separate from this new lazy-helper improvement.

Full suite 82659 completed successfully: 19,385 passed, 41 skipped, 607 files
passed and one skipped, 342.12 seconds. Then a lazy-helper structuredClone test
failed concretely (returned 'cloned' instead of DataCloneError; 43 other tests
passed). Added the helper private brand to cloneStructuredGraph rejection.
All 44 helper tests now pass in 2.08 seconds; all 104 existing structured-clone
tests across seven files pass in 3.43 seconds. The full-suite result predates
this final one-line boundary guard; focused clone checks validate that delta.
Normal workspace build has now started; CLI harness/screenshot and final
changed-file lint remain before delivery.

Normal npm run build completed (70 declared workspace builds plus root stages),
including all four fresh built-import tests. Final ESLint on the clone guard and
test file passed. Node 18 built-SDK flatMap/take JSON dump/replay returned the
expected [{value:1,done:false},[10,2,20]].

The first real CLI screenshot exposed a harness authoring error: default export
lacked the required frontmatter parameter. Corrected the pair to declare/use
frontmatter; rerun passed. Inspected the actual PNG, which visibly reports
Harness passed and zero spawns. This validates runtime/CLI integration, not model
behavior. Screenshot: screenshots/node-dist-bin.cjs-harness-run-docs-plans-safejs-lazy-iterator-helpers.md.png.
Ready for its own conventional commit and direct main push.
