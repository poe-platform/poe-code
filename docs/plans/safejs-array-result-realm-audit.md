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
