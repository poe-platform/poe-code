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

## Reflection-list implementation

Twelve source tests failed on prototype identity before the change, covering
all six reflection methods through guest factories and direct SDK calls.
The value-identity, symbol-identity and accessor-order control already passed.
The new suite now passes all 19 cases, including six Proxy-path prototype
checks. Together with existing Proxy key/descriptor suites, 53 tests pass.

A reflection-specific allocator stores the originating prototype on fresh
result lists and, only for Object.entries, fresh entry pairs. It does not
recurse into payloads or change generic allocation behavior. Ordinary key/name
lists contain only newly collected strings and no longer need a data-import
copy before accounting. The five synchronous SDK Object routes remain
synchronous. Reflect.ownKeys retains its asynchronous route. Iterator wrappers,
entry-pair producers and toArray remain separate pending fixes.

The first broader run passed 2,708 tests and failed one existing direct SDK
Object.fromEntries(Object.entries(...)) alias/copy test. Explicitly linked
arrays were rejected by getSandboxIterator before their guest iterator could
be read. Two new regressions confirmed this round-trip and an own iterator
override both failed. Explicit arrays in context-free adapters now use the
existing guest-protocol bridge, like other explicitly linked built-in values;
normal interpreter contexts still perform their own protocol acquisition.
This bridge may be asynchronous so guest iterator behavior remains observable.
The five direct reflection methods themselves remain synchronous. The 21 new
tests and 19 existing alias tests now pass; broader revalidation is pending.

Final revalidation passed 2,711 tests across 188 snapshot/object/Proxy files,
plus 94 iterator-protocol tests across four files. Scoped ESLint and package
TypeScript checks passed. The rebuilt candidate passed 23 workspace builds
and four fresh-process import checks. Built ESM probes verified all five
synchronous SDK Object reflection results and the entries/fromEntries
round-trip. No visual CLI changes, push or release. This is targeted
verification; the earlier full-package result predates this implementation.

## Iterator entry-pair implementation

Five source tests failed on originating Array.prototype identity before the
change: Array, Uint8Array, Float32Array, Map and Set entries. The payload
control already passed, including a null-prototype array used as a collection
value. Entry-pair allocation now stores the originating Array prototype;
keys/values branches do not touch payload prototypes. The tests also compare
native pair contents, observe later prototype mutation, and reject lossy data
copying. Iterator-result wrappers and Iterator.toArray remain pending.

Final entry-pair verification passed 157 tests across six entry/iterator/
resize/replay files. Scoped ESLint, package TypeScript and the maintained
build passed (23 workspace builds and four fresh-process import checks).
Built SDK probes passed for Array, Uint8Array, Float32Array, Map and Set entry
pairs after cleanup. No visual CLI changes, push or release occurred.

## Iterator.toArray implementation

Three source regressions failed on originating Array.prototype identity for
non-empty, empty, and mapped iterators. The native VM controls passed. The
custom-iterator control also passed before the fix: repeated values preserve
identity and an explicit null prototype.

The consumer now records the originating Array prototype on its fresh result
array. It does not re-prototype collected values or change other consumers.
The regressions also check contents, later prototype mutation, and rejection
of lossy data copying. A direct SDK call with a foreign iterator verifies
that the result uses the method's realm rather than the receiver's realm.

Targeted validation passed 168 tests across six consumer, lazy-helper,
SDK Proxy, built-in-input and collection snapshot files. Iterator-result
wrappers remain pending. The latest full-package run predates this change.

Scoped ESLint, package TypeScript, and the maintained build passed (23
workspace builds and four fresh-process import checks). Built ESM SDK probes
passed for empty and non-empty foreign iterators. No visual CLI changes,
push or release occurred.

## Array, collection and string iterator-result implementation

Thirty-two source regressions failed for Array values/keys/entries, Uint8Array
values, Float32Array entries, Map entries, Set values and Unicode string
iteration. The tests cover first yield, first completion, repeated completion,
and direct SDK calls borrowing a next method from a different realm. Native
VM controls passed; the payload/descriptor/fresh-result control already
passed before the fix.

A shared result factory creates the two data properties and records the
originating Object prototype. These three iterator implementations use it
for both yielded and completed results. It does not alter payload objects.
Regressions check foreign prototype identity, subsequent prototype mutation,
and rejection of lossy data copying.

Other producers still require separate validation: RegExp iterators,
iterator helpers, Iterator.from fallback return results, and generators.
Their source contains result-object allocations, but that alone does not
establish which exposed paths lose their creation realm.

Validation passed 249 tests across nine iterator/entry/resize/snapshot files,
including eight new public replay cases, and 397 tests across 18 iterator
protocol/consumer/SDK files (these selections overlap). Scoped ESLint and
package TypeScript passed. The maintained build passed 23 workspace builds
and four fresh-process import checks; built SDK probes passed for Array,
Uint8Array, Float32Array, Map, Set and string borrowed next calls through
yield and repeated completion. No visual CLI changes, push or release. This
does not replace a fresh full-package run.
