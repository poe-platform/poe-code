# Await Proxy operations in array methods

At 408d7b151, all 20 initial native method comparisons failed (94442).
Membership and deletion used synchronous operations on the private carrier.
The async array-like view also exposed its guest receiver's `then` property to
native Promise assimilation, creating extra observable reads.

Route every array membership query through an operation that can return a
Promise, including reduce's initial-element search and nested flattening
membership. Await deletion and preserve strict false-result errors before
continuing mutations. Wire both interpreter and Array.prototype options to the
shared Proxy operations. Keep host membership policy and ordinary fallbacks.
Remove unused native-view mutation traps, which could not await writes/deletes.
The private view's `then` is always undefined; this does not alter the guest
receiver's own `then` property or ordinary guest property access.

Coverage:

- Twenty generic array methods, direct and borrowed calls, compared with native
  result values, target state, and complete trap traces.
- Throwing membership/deletion, false deletion/write results, and protected-key
  membership invariants; verify error identity and partial target state.
- Maintained array callback mutation, receiver, species, replay, nested-read,
  iterator, budget and ordinary checkpoint suites.

Verification:

- Initial twenty native comparisons and package TypeScript passed (63375).
- 748 tests across 12 array-related files and scoped lint passed (74672).
- 582 tests across 40 internal Proxy/checkpoint files and TypeScript passed
  (15946), before the direct-call/failure expansion.
- Expanded native-comparison file passed all 45 tests (79705).

Still pending: wrapped-array species identity, Proxy species result definitions,
wrapped arrays in flat/flatMap/concat, callable Proxy constructors, and Proxy
checkpoint graphs. This is not a full-package or full-conformance gate. Pushes
and releases remain paused.
