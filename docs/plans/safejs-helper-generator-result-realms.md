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

### Delegated abrupt operations and Proxy controls

Built/native comparisons extended the matrix to delegate throw and return
methods after an initial yield. Each receives argument 4 and returns an object
with a logging value getter, done and extra properties.

- With done false, native returns the exact object, retains extra, and does
  not invoke the value getter. SafeJS copies it, loses extra and invokes value.
- With done true, both read value once and return a separate completed result;
  these controls already match and must remain unchanged.

Proxy delegate results make the identity loss observable after yielding too.
Changing the original Proxy's value from 1 to 9 changes the native returned
result, while SafeJS still exposes 1. Revoking the Proxy makes a later native
value read throw TypeError; SafeJS still returns the copied 1. Both native
results retain identity with the Proxy; neither SafeJS result does.

These checks ran against the same unchanged built runtime while the full
suite was live. They are additional failing audit probes, not implemented
fixes. Keep mutation/revocation and completed-result controls in the eventual
source regression tests.

## Lazy helper result implementation

Fifteen source tests failed before the fix: the three borrowed-operation
sequences for all five helper kinds. The existing payload/record controls
passed. All newly created helper result records now use createIteratorResult,
including the step records returned by filter, take, drop and flatMap. Input
result records and yielded values are not re-prototyped or copied by this
change. Completion remains fresh on each call.

The regressions check native contents, method-realm prototype identity,
later prototype mutation and rejection of lossy data copying. Five additional
public replay cases check next/return/completed-result prototype identity.
Iterator.from fallback returns and generator results remain separate pending
fixes; this implementation does not alter them.

Validation passed 152 tests across six helper/consumer/SDK Proxy files,
including all 25 new realm, payload and replay cases. Scoped ESLint and
package TypeScript passed. The maintained build passed 23 workspace builds
and four fresh-process import checks. Built SDK probes passed all 40 borrowed
helper operations. No visual CLI changes, push or release. The recorded full
package gate predates this implementation.

## Iterator.from fallback-return implementation

Four source regressions failed before this change: borrowed return calls and
public replay with an absent or null underlying return method. The wrapper
now uses createIteratorResult only for its synthesized completion result.
Tests verify native contents (including ignoring supplied return arguments),
freshness, method-realm prototype identity, subsequent prototype mutation and
rejection of lossy data copying.

The custom-result control passed before the fix and continues to require
identity preservation, unchanged null prototypes, fresh return-method lookup,
correct receiver binding and no forwarded arguments. Custom next/return
results are not modified. Generator result and yield-star gaps remain open.

Validation passed 115 tests across seven wrapper, construction, disposal,
helper and SDK Proxy files, including the five new cases. Scoped ESLint,
package TypeScript and the maintained build passed (23 workspace builds and
four fresh-process import checks). Built SDK probes passed repeated borrowed
return calls for both absent and null methods. No visual CLI changes, push
or release. The recorded full-package gate predates this fix.

## Verification boundary

The full-suite source/test SHA256 for the earlier gate was
`958f252f6325d13c3381d9be5042572b07c402b85857258f1f9d45569160fcad`;
it was unchanged across that run. The terminal result was 24,317 passed,
two Promise-import policy failures and 37 skipped. This gate predates the
helper, wrapper and generator transport changes; it does not validate them.

## Generator transport work in progress

The synchronous channel now carries the yielded guest result separately from
its internal completion state. Ordinary yields create a result in the generator
realm; yield-star forwards the exact delegated object without reading its value
getter. The three internal restoration assertions now verify that explicit
payload, including identity between the delegated payload and forwarded result.
Restoration and delegated-result tests pass: 95 tests across two files, including
three public Proxy/getter-order replay cases. Package TypeScript passed before
the final queued-test refinement. These changes are not committed yet.

The async implementation started from three failing sequential regression cases.
A fourth test holds the generator on an explicit promise gate while four next
requests from two method realms are queued. Native results use the generator
realm for the yield, body completion, and the already-queued requests drained
at completion. A later request instead uses its called method's realm.
All four baseline SafeJS prototype comparisons fail;
their copied value/done contents match. This validates queued request coverage
in addition to the sequential cases, without asserting a cause from failure
alone. The baseline driver stored no per-request realm metadata and resolved
fresh plain records using its active budget.

The working implementation captures the generator's originating Object
prototype and the active request's result prototype. Body execution selects the
generator prototype, and completion propagates it while draining queued
requests. Later calls capture their own method prototype. Both generator and
request metadata are serialized and restored; generator memory measurement
visits the retained prototype. Fresh ordinary result allocation records the
default link separately from custom prototype mutation, preserving safe SDK
data-copy classification.

The focused run now passes all 35 tests across the result-realm,
delegated-result and malformed async-continuation files. This includes public
queued replay and rejection of lossy copying after the originating prototype
changes. TypeScript and scoped ESLint pass. The maintained selected-workspace
build passes all 23 build tasks and four fresh-process import checks. A built
SDK probe also verifies four queued results in the generator realm, followed
by a later result in the called method's realm. Broader generator/snapshot tests
pass: 1,944 tests across 135 files in 116.75 seconds. This is not full-package
or full JavaScript conformance validation.

No push or release was performed. The earlier broad generator/snapshot run
passed 1,935 tests and failed six before the restoration assertions changed;
the later 1,944-test run above supersedes it for this focused scope.
