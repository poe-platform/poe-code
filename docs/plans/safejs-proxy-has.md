# Proxy property-existence queries

On 07747ef32, all ten initial tests failed (52596): Reflect.has ignored traps,
missed target/inherited properties, and accepted invalid protected-property
hiding and revoked operations. Native comparisons validate invariant outcomes.

Implement HasProperty with ordinary prototype traversal and Proxy dispatch at
each link. Missing traps forward to the target. Truthy trap results do not inspect
target invariants; falsy results reject hidden non-configurable own properties
and own properties of non-extensible targets. Property existence must not invoke
ordinary getters. Preserve integer-indexed exotic behavior: canonical numeric
keys do not continue into a typed array's prototype. Budget Proxy traversal and
ordinary prototype depth.

Reference: [ECMA-262 10.5.7](https://tc39.es/ecma262/2026/multipage/ordinary-and-exotic-objects-behaviours.html#sec-proxy-object-internal-methods-and-internal-slots-hasproperty-p).

The expanded selection passed 105 tests in three files (62416): has operations,
descriptor operations and maintained Reflect tests. The same command completed
TypeScript and scoped lint successfully.

Reflect is integrated in this change. The interpreter's in operator, with binding
resolution, descriptor-conversion presence checks and array-method callbacks
still need the shared operation. Public Proxy, snapshots, full-package validation
and overall JavaScript completeness are not claimed. Publication remains paused.
