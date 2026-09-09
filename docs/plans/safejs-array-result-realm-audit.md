# Array-producing method realm audit

## Method and results

Read-only built ESM probes against runtime commit `5b6d9f487` exported a
factory and Array.prototype, invoked the factory after cleanup, then inspected
its result using Object.getPrototypeOf exported by another run. Native VM
controls retained the originating Array.prototype in all fourteen cases.

| Expression | SafeJS originating prototype identity |
| --- | --- |
| `[1,2].slice(1)` | passes |
| `[1,2].map(x=>x+1)` | passes |
| `[1,2].filter(x=>x>1)` | passes |
| `[1].concat([2])` | passes |
| `Array.from([1,2])` | passes |
| `Array.of(1,2)` | passes |
| `[[1],[2]].flat()` | passes |
| `[1,2].flatMap(x=>[x])` | passes |
| `[1,2].splice(1,1)` | passes |
| `[1,2].toReversed()` | fails |
| `[2,1].toSorted()` | fails |
| `[1,2].toSpliced(1,1,3)` | fails |
| `[1,2].with(1,3)` | fails |
| `"a,b".split(",")` | fails |

These are result-identity checks, not full method conformance tests. The
passing cases do not establish arbitrary borrowed-call, subclass, or cross-
realm species behavior. The failures need source regressions before fixes.

## Follow-up requirements

For array copy-by-change methods, retain default result prototypes without
introducing species selection where native JavaScript does not perform it.
Preserve holes-to-undefined behavior, getter order, comparator behavior,
out-of-range rejection, and original-array immutability. Confirm later
prototype mutation remains observable and cannot be silently lost in data
copying. Inspect string split separately, including native and custom
Symbol.split result paths; custom splitter results must not be re-prototyped.

No runtime or test files changed for this audit. The full package gate
continues against its original source/test hash. No push or release.

## Borrowed methods and semantic controls

Read-only probes at runtime commit fa36d37f3 confirm all four copy-by-change
methods also lose result realm identity when borrowed via
Array.prototype.method.call onto `{0:1,1:2,length:2}` (the sorted case uses
values 2 and 1). Native VM controls preserve identity in all four cases.

Separate controls use `[3,,1]` with a throwing own constructor getter.
toReversed(), toSorted(), toSpliced(1,1,9), and with(1,9) all match native
result keys, copied contents, and unchanged original keys/contents without
reading that constructor. Preserve those behaviors when fixing prototypes.
The shared budgetProducedValue helper also handles existing mutation targets,
so indiscriminately assigning a prototype there would change unrelated objects.

## Split path controls

Read-only probes at fa36d37f3 confirm wrong originating array identity for
string separators, zero limit, omitted separator, regex separators, and
capturing regex separators. Native VM passes all five identity controls.
Custom Symbol.split controls still match native: a returned null-prototype
object keeps its identity/prototype, and a custom hook receives the original
uncoerced receiver plus limit zero and is called once. Do not re-prototype
custom hook results or move fallback coercion ahead of hook dispatch.
