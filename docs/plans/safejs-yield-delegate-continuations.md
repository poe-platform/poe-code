---
title: Delegated yield continuations
---

# Delegated yield continuations

## Validated defect

Four sync/async generator regressions repeated delegated source/factory effects
after restoration. Yielded values initially looked correct, but completion
reported a call count of 3 instead of the native result 1.

## Implementation

Preserve the acquired iterator, its source and the current suspended value.
Restore the portable iterator record and consume the pending completion before
calling its next/throw/return operation. Do not reacquire or advance the iterator
through already-completed operations. Reuse cached next and lazy return/throw
lookup from the maintained iterator adapter. Validate protocol and source AST
ownership of the delegated yield state.

## Verification

All 20 focused cases pass: arrays, strings, nested sync/async generators,
custom sync/async iterators, cached next lookup, resumed return/throw and malformed
snapshot state. The maintained package route passed 15,698 tests (41 skipped),
without exclusions. Changed-file lint, package types and the selected workspace
build passed. Tests finished before builds began. After fast-forwarding to
remote main, the CLI build and harness passed again; its screenshot was inspected
with zero spawns and no warnings. Publication is tracked separately.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-yield-delegate-continuations.md` and inspect the PNG. Expect
a passed harness, zero spawns and no warnings. This skill-guided pair grants
no capabilities. Unit tests verify portable restoration; the CLI smoke checks
ordinary delegated generator execution and completion values.

## Next validated gap

An outer yield incorrectly skips evaluation while restoring a suspension in its
argument. A direct probe of `yield (yield 1)` throws that the suspended generator
completed during replay, while native `.next(4)` yields `{value:4,done:false}`.
Resumption through enclosing yield arguments requires a separate fix.
