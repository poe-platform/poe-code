---
title: Promise subclass assimilation across async boundaries
---

## Evidence

Initially two tests failed with missing class invocation context when an async
function returned a Promise subclass or an awaited thenable resolved to one.
Expanded tests reproduced the same error in async generator yields/returns,
async-from-sync iteration, and generator return arguments before start/after
completion. Fix only these validated propagation gaps.

## Implementation

Carry the existing sandbox call context into async-function result resolution,
awaited thenables, async iteration adapters, and generator return operations.
The shared coercion context forwards the actual construction target as well as
the construct flag so species-created instances preserve subclass prototypes.
Keep cancellation, fatal budget handling, and replay tracking intact.

## Validation

Eleven focused tests cover the failing boundaries, construction identity,
pending/completed public replay, and a serialized/restored async closure graph.
The restored graph case already passes without changes to its restoration path;
do not modify that path merely on suspicion.

Run Promise/async/cancellation/iteration regressions, maintained workspace unit
tests excluding only the pending uncommitted native-Promise import policy tests,
scoped lint/types, selected workspace build, and this real CLI harness. Inspect
its screenshot. Publish this change with its own commit and push; monitor release
jobs while investigating the next validated JavaScript gap.

This fixes context propagation, not all Promise await semantics or unrestricted
portable Promise graph serialization. Those require separate evidence.

Local lint and type checks passed. The maintained workspace run passed 16,781
tests with 41 skips. Four separate Promise-await property regressions were added
after that run's collection; they are not in this commit or its passing count.
