---
title: Generator for-of continuations
---

# For-of generator continuations

## Confirmed evidence

The current regression file, guest-generator-iteration-continuations.test.ts,
contains 40 cases: 38 fail and two pass before implementation. It exercises
sync and async generators, arrays, Unicode strings, array growth/shrinkage,
modified bindings, closure capture, nested loops, continue/finally, suspended
assignment/destructuring targets and iterable expressions, Map, Set, nested
generators, guest iterator factories, cached next getters, closing on break,
and for-await over synchronous and asynchronous sources.

Failures include repeated values after a second restore, lost binding values,
premature completion after shrinking the array, and loss of an already
evaluated iterable. These are behavioral failures rather than parser or
missing-builtin setup errors. Builtins are explicitly registered against the
same budget used for original execution.

## Required implementation

Preserve the acquired iteration record, not merely the source expression and
a count of calls to replay. In particular, custom factories and next getters
must not be called again, and an already-advanced nested generator must not
be advanced again to reconstruct its old position.

For the indexed array/string path, retain the iteration values, current index,
current value, binding/body phase and iteration scope. A current iteration
must finish even if the source array became shorter while suspended.

For iterator-backed paths, preserve the iterator receiver, cached next method,
protocol mode and any builtin cursor. Reconstruct only the host adapter around
those values. Keep return/throw lookup lazy and preserve async-from-sync value
unwrapping and iterator closing behavior. Host-owned iterators without a
portable representation need explicit snapshot rejection, not effect replay.

Snapshot schemas and source-ancestry validation must cover both paths and
binding/body phases. Internal scope references must remain inaccessible as
guest data. Add malformed public snapshot tests alongside low-level repeated
restoration comparisons.

## Delivery gates

Keep the existing failing regressions intact until their behavior is fixed.
Run the maintained package tests without excluding this regression file,
changed-file lint, package types and the selected workspace build. Add a
skill-guided CLI smoke pair, run it and inspect its screenshot. Commit and push
the atomic fix to main, verify remote delivery, and monitor publication while
continuing the remaining JavaScript gaps. No implementation or delivery is
claimed by the initial plan alone.

## Implementation and verification update

Both indexed and iterator-backed paths now preserve binding/body phase and
scope. Iterator adapters expose portable records: guest receiver/cached next,
builtin source/cursor, or an async-from-sync wrapper. Array cursors restore
directly, without replaying getters. Pattern member references use the existing
member continuation path. Snapshot readers validate source phases, protocol
compatibility, cursor bounds, callable next methods and internal scope access.

The original 40 cases pass. Three added cursor regressions initially failed
(array getter replay, for-await string capture and changed array prototypes)
and now pass. Seven public snapshot validation cases also pass, for 50 focused
cases. The final maintained package run passed 15,543 tests with 41 skipped
and no exclusions. Changed-file lint, package types and the selected workspace
build passed. The skill-guided CLI harness passed with zero spawns; its PNG
was inspected without warnings. Publication is tracked separately from local
checks and remote delivery. A subsequently added uncommitted array-protocol
test validates three distinct synchronous for-of defects for the next atomic
fix; it was not part of the completed package run's collected test files.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-generator-for-of-continuations.md` and inspect its PNG.
Expect a passed harness, zero spawns and no warnings. The skill-guided pair
checks custom iterator acquisition and next getter counts without granting
capabilities. The low-level tests independently prove repeated restoration;
the CLI smoke check alone does not.
