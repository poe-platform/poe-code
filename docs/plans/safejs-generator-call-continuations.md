---
title: Generator call continuations
---

# Generator call continuations

Native comparisons reproduced failures when a generator yielded in arguments:
completed argument side effects repeated, and resumed guest calls used a stale
compilation owner. The owner lifetime is handled separately.

Capture the resolved callee, receiver, completed arguments and active argument
index for calls and constructors. Restore those values through the existing guest
graph codec. Default array methods need their target and method identity instead
of a temporary host wrapper. Calls to optimized methods with yielding arguments
must take a resumable route. Source ownership validation checks call position and
argument index against the suspended yield.

Eighteen native-comparison cases pass across repeated restoration of synchronous
and asynchronous generators: arrow
and declared functions, completed spreads, multiple yielding arguments, getter
methods with receiver identity, constructors, Math methods, strings and arrays.
The full package run before expanding the async matrix passed 15,269 tests with
41 existing skips. The expanded matrix passes all 18 cases; lint and package types
pass. The selected workspace build passed, and the actual CLI screenshot was
inspected: the harness passed without warnings and with zero spawns.

Run this pair through `npm run screenshot-poe-code -- harness run
docs/plans/safejs-generator-call-continuations.md`, then inspect its screenshot.
It must pass with results `[0,4]`, one increment per generator, no warnings and
zero spawns. No external capabilities are granted. The native-comparison unit
tests, not this smoke check, prove independent low-level restoration.
