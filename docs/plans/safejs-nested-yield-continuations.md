---
title: Nested yield argument restoration
---

# Nested yield argument restoration

## Validated defect

Four sync/async regressions failed when a suspended yield appeared inside an
outer ordinary or delegated yield's argument. Restoration skipped the outer
expression and completed replay prematurely instead of resuming the argument.

## Implementation

Distinguish suspension at the current yield from suspension in its argument.
Enter arguments containing the resume target, consume that completion, and
clear the completed resume marker before performing the enclosing yield or
acquiring its delegate. Preserve skipping of unrelated earlier yields.

## Verification

All 20 expanded cases pass, covering deeper nesting, successive arguments,
array/sequence arguments, earlier effects, and throw/return through finally.
Existing delegation regressions pass as well. The maintained package route
passed 15,718 tests (41 skipped), without exclusions. Changed-file lint, package
types and the selected workspace build passed. Tests finished before builds
began. The CLI harness passed with zero spawns; its screenshot was inspected
without warnings. Publication is tracked separately.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-nested-yield-continuations.md` and inspect the PNG. Expect
a passed harness, zero spawns and no warnings. This skill-guided pair grants
no capabilities. Unit tests verify restoration; the smoke harness checks the
ordinary nested-yield execution sequence.

## Next validated gap

Restoration at a suspended do-while condition repeats the completed loop body.
For `do{count++}while(yield 1)`, sending 0 after restoration returns 2, while
native execution returns 1. The condition must resume before another body
iteration; this is separate from entering nested yield arguments.
