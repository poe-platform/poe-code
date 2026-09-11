---
title: Observable Promise properties during await
---

## Evidence and behavior

Four native comparisons failed before implementation: constructor getter
observation, subclass then overrides, abrupt constructor getters, and promises
with removed prototypes. The former await path observed internal settlement
without first checking whether the intrinsic Promise constructor could reuse
the argument.

[Await](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#await)
uses the intrinsic PromiseResolve operation, not the mutable public resolve
method. Constructor identity determines reuse; otherwise normal resolution
observes the argument's then property. Once selected, the resulting promise's
internal settlement is observed directly.

## Implementation and boundaries

Prepare branded promise arguments using descriptor-aware constructor lookup and
the budget's intrinsic constructor identity. Reuse intrinsic promises without
reading their then property. Wrap other promises through existing resolution,
without adding replay-visible internal wrapper records. Preserve signal-aware
outcomes and host-call consumption on direct observation. Constructor lookup
errors reject the await; budget failures remain fatal.

## Validation

Thirteen focused tests cover getters, override dispatch, null prototypes,
intrinsic resolve independence, replay, cancellation of a never-settling custom
then, and fatal getter budgets. Native mutation probes use isolated VM contexts
so changing Promise properties cannot corrupt the test runner; property counters
only observe the promise under test, not host/foreign-realm transport promises.

Run focused Promise/cancellation/replay regressions, maintained workspace tests
excluding only the separate uncommitted native Promise import policy cases,
scoped lint/types, selected build, and this CLI harness with screenshot review.
Commit and push independently; monitor publication while continuing the next
validated compatibility investigation.

The first broad run exposed a fatal-state regression: later constructor lookup
could replace the original step-budget error. Check the existing fatal state
before preparation; the unchanged budget integration test then passes.
The broad rerun also excludes the newly added, separate withResolvers regressions
alongside the native-import policy tests. Neither uncommitted file is counted as
passing validation for this change.

Local validation: 16,794 maintained workspace tests passed with 41 skips.
Scoped lint and type checking passed, as did all thirteen focused await cases
and the unchanged budget integration tests.
