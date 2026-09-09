# Iterator helper and generator result-realm audit

Candidate: `c1b8b4eda`, built locally. No push or release. This audit ran while
the full SafeJS unit suite was active; runtime and test sources were unchanged.
The native oracle was Node 22.23.2 using independent `node:vm` contexts.

## Helper and wrapper results

For each of map, filter, take, drop and flatMap, export a closure calling
the helper's next or return and its realm's Object.prototype. Call the closure
three times after run cleanup. Query each result's prototype using an exported
Object.getPrototypeOf from another realm. All 30 SafeJS identity checks failed;
all corresponding native VM checks passed. The inputs were:

- `[1].values().map(x=>x+1)`
- `[1].values().filter(x=>true)`
- `[1].values().take(1)`
- `[1].values().drop(0)`
- `[1].values().flatMap(x=>[x])`

Two more failures concern Iterator.from wrappers whose underlying iterator
has no return method or has `return: null`. Their synthesized completion
objects lose the method realm. A control with custom next and return methods
returning the same null-prototype result already matches native behavior:
both wrapper methods preserve identity and leave the prototype unchanged.
Do not re-prototype forwarded custom results.

Borrowing map-helper methods from realm A for a helper created in realm B
confirmed that next/next/next, return/return and next/return/next all allocate
results in A in the native oracle. SafeJS returned objects linked to neither
exported prototype. These checks support using the method's result allocator,
including helper step results that are newly constructed rather than forwarded.
Extend the borrowed-method tests to all five helper kinds before fixing them.

## Generator results need state-sensitive handling

For each generator kind, create methods in realm A and the receiver in realm
B. Use `(function*(){yield 1;return 2})()` or its async equivalent. Await native
operations; for SafeJS also unwrap the returned SandboxPromise when present.
Compare result prototypes to A.Object.prototype and B.Object.prototype.

| Kind | Operations | Native result realms |
| --- | --- | --- |
| Synchronous | next, next, next | B, A, A |
| Synchronous | return, return | A, A |
| Synchronous | next, return, next | B, A, A |
| Asynchronous | next, next, next | B, B, A |
| Asynchronous | return, return | A, A |
| Asynchronous | next, return, next | B, B, A |

Every SafeJS result in these sequences matched neither exported prototype.
This is concrete evidence of a gap, not evidence that one allocator realm is
correct for every generator state. Before implementation, add failing source
regressions for these sequences and check throw, finally/yield, yield-star,
queued async requests and snapshot restoration. Preserve custom yielded value
identity and avoid rewriting delegated result objects without native evidence.

## Verification boundary

These are built-SDK/native audit observations, not completed fixes or passing
regression tests. The active full-suite source/test SHA256 is
`958f252f6325d13c3381d9be5042572b07c402b85857258f1f9d45569160fcad`;
it was unchanged when rechecked during this audit. The full test run remains
separate evidence and must be polled to a terminal result.
