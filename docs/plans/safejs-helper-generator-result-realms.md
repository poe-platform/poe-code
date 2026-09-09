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
The follow-up built/native audit extended these three operation sequences to
all five helper kinds: all 40 native results used the called method's realm,
and all 40 SafeJS identity checks failed. Add these as source regressions
before implementing the fix.

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

## Synchronous yield-star forwards the result object

A separate native comparison establishes that synchronous yield-star must
not always allocate a new result object. Use a delegate returning a shared
null-prototype object with own `value: 1`, `done: false`, and `extra: 7`, then
call next on `(function*(){yield*delegate})()`.

Native preserves the exact object, its null prototype, and all three keys.
SafeJS instead returns a different object with only value/done, loses the
null prototype, and drops extra. The async-generator control matches native:
it returns a different ordinary result with just value/done. Do not apply
synchronous result forwarding to async generators.

Two accessor controls expose a behavioral consequence beyond identity:

- With a logging value getter, native synchronous generator.next returns the
  delegate's object without reading value. SafeJS invokes the getter early.
- With a throwing value getter, native generator.next still yields normally
  without invoking it; SafeJS throws the getter's error from next instead.

The current delegated-yield loop in interp/interpreter.ts reads both done and
value before checking completion, then stores/yields just the value. The
channel in interp/generator.ts constructs a new result around that value.
Both boundaries need review; merely assigning a prototype to the replacement
would leave identity, extra properties and getter timing incorrect.

Before changing code, reproduce these cases as failing source tests and
include delegate throw/return, done results, Proxy results, replay and memory
retention controls. This bug is validated but not fixed by this audit.

### Specification and implementation follow-through

The [ECMAScript 2024 yield-star evaluation rules](https://tc39.es/ecma262/2024/multipage/ecmascript-language-functions-and-classes.html#sec-generator-function-definitions-runtime-semantics-evaluation)
confirm the native observations. For a non-completed synchronous delegate
result, next, throw and return paths yield the object itself. Async paths
instead obtain its value. Completed results obtain the value for completion.
Thus forwarding is a language requirement, not a Node-specific optimization.

Source inspection found two additional boundaries beyond the interpreter and
channel already noted:

- interp/iteration.ts generatorIterator derives generator state by reading
  result.done. Forwarding a guest result through that code unchanged could
  add an observable getter read; state must come from internal channel state.
- interp/methods/generator.ts callGeneratorMethod reconstructs value/done
  again. That must not erase a forwarded synchronous delegate result.

The generatorYield callback also crosses interp/async.ts and replay/context
types. Ordinary yields, delegated synchronous results, async suspension and
completed results must remain distinguishable through those boundaries.
Saved yield-delegate expression state currently retains only the yielded
value; preserving a raw delegate result requires reviewing restored state,
accounting and snapshot validation rather than changing only the last wrapper.

## Verification boundary

These are built-SDK/native audit observations, not completed fixes or passing
regression tests. The active full-suite source/test SHA256 is
`958f252f6325d13c3381d9be5042572b07c402b85857258f1f9d45569160fcad`;
it was unchanged when rechecked during this audit. The full test run remains
separate evidence and must be polled to a terminal result.
