# Define array species results through Proxies

All 21 initial native comparisons failed at a06e52ab7 (74422). Array result
creation defined properties on the private carrier, bypassing the target and
defineProperty traps.

Dispatch Proxy result definitions through the existing descriptor operation,
using writable/enumerable/configurable data descriptors. Await each definition
before continuing. Preserve the ordinary result path and existing length writes.

Coverage spans map, filter, slice, splice, flat, flatMap and concat. Each runs
against object, array and non-extensible object targets, with accepting, false
and throwing traps. Compare descriptor fields, order, result identity, target
state and source mutation. In particular, a failed splice result definition
must stop before the source is changed.

Verification: 91 tests across result/species suites passed (57539). Expanded
63-case native comparisons and maintained array suites passed 789 tests across
11 files (97647). Package TypeScript and scoped lint passed; both command chains
completed successfully.

Wrapped-array flattening/concat identity, callable Proxy constructors, public
construction and Proxy checkpoint graphs remain pending. No full-package,
remote delivery or release claim.
