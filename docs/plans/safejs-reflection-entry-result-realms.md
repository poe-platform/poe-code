# Reflection and iterator entry result realms

## Validated built-runtime audit

Read-only probes at runtime commit ae5b505ab export a factory and its
Array.prototype, call the factory after SDK cleanup, then inspect the result
through a separately exported Object.getPrototypeOf. Native VM controls pass
all ten cases; SafeJS fails originating prototype identity in all ten:

- Object.keys({a:1})
- Object.values({a:1})
- Object.entries({a:1})
- Object.entries({a:1})[0]
- Object.getOwnPropertyNames({a:1})
- Object.getOwnPropertySymbols({[Symbol('x')]:1})
- Reflect.ownKeys({a:1})
- [1].entries().next().value
- new Map([[1,2]]).entries().next().value
- new Set([1]).entries().next().value

These probes establish identity loss, not full conformance failures for each
method. Add source regressions before implementing fixes.

## Controls and implementation boundaries

A separate native-backed control passes all six assertions: Object.values
and Object.entries preserve an existing value's identity; Array, Map and Set
entry pairs preserve the original element/key identity; the original value's
null prototype remains null. Do not recursively re-prototype result contents.
Only newly allocated outer arrays and entry-pair arrays belong to this fix.

Object-array globals have both context-free synchronous SDK branches and
context-aware/Proxy branches. Cover both; preserve synchronous return behavior
where maintained. The enumerable-property helper allocates the result list
and entry pairs separately. Reflect.ownKeys uses sandboxOwnKeys followed by
allocation accounting. Do not change the generic allocation-accounting helper
to rewrite arbitrary arrays. Proxy ownKeys trap ordering, descriptor filtering,
accessor receiver behavior, symbol identity, and existing value identity must
remain intact. Iterator producers need separate source inspection and tests.

No runtime or test source changed during this audit. The full SafeJS gate
continues against the ae5b505ab working-tree source/test fingerprint. No push
or release occurred.

## Iterator follow-up audit

Further read-only ae5b505ab built probes fail originating Array.prototype
identity for Uint8Array and Float32Array entry pairs and for
`[1].values().toArray()`. Separate probes fail originating Object.prototype
identity for `.next()` result objects from an Array values iterator, Map
entries iterator, Set values iterator, and string iterator. Native VM controls
pass all seven. These use the same post-cleanup factory and foreign inspector
protocol as the first audit.

Source inspection locates Array/typed-array pair allocation in
methods/array-iterator.ts, which also creates iterator-result records.
collection-iterator.ts exposes fresh native entry-pair arrays and separately
creates result records. Keep the pair array, result wrapper, and payload
identity requirements separate. Extend tests to exhausted results, borrowed
next methods, restored iterators, and unchanged value/key identity before
fixing these paths. Iterator.toArray needs its own source regression and must
not modify values collected from custom iterators.

## Direct SDK reflection controls

At ae5b505ab, directly calling exported Object.keys, Object.values,
Object.entries, Object.getOwnPropertyNames and Object.getOwnPropertySymbols
without a call context returns synchronously in all five cases. Each result
still fails originating Array.prototype identity when inspected from another
realm. These are concrete regressions for the context-free branches, not
merely an inferred need for coverage. Fixes must preserve both synchronous
return behavior and result prototypes. This probe used a plain guest object
`{a:1}`; it does not establish context-free accessor or Proxy semantics.
