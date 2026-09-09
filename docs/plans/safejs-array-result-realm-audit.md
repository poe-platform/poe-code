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

## Borrowed species-method fallback

Read-only built ESM probes at runtime commit fa36d37f3 also fail originating
Array.prototype identity for slice(), map(x=>x), filter(x=>true), flat(), and
flatMap(x=>x) borrowed onto `{0:1,1:2,length:2}`. Each factory runs after SDK
cleanup, and a separately exported Object.getPrototypeOf inspects its result.
Native VM controls pass all five. The earlier passing array-receiver cases
therefore do not cover the plain array-like fallback.

Source inspection finds arraySpeciesCreate allocates and returns a bare array
when no species constructor is selected. Validate this path with source tests
before fixing it; preserve explicit species selection and custom constructor
results. This audit changed no runtime or test files during the full gate.

## Copy-by-change implementation

Four source regressions failed on originating prototype identity before the
fix and pass afterward. Each checks ordinary and borrowed sparse inputs,
native contents and own keys, later prototype mutation, and rejection of lossy
data copying. The ordinary receiver has a throwing constructor getter, which
must not be read.

Only the four copy-by-change methods use the new default-array allocator. It
preserves their allocation limit check and explicitly stores the originating
prototype when available. It does not change shared produced-value accounting,
species selection, existing mutation targets, or custom species results.
The separately validated borrowed species fallback and string split paths
remain pending. The previous full gate predates this implementation.

Verification: 6,123 tests passed across 85 method/proxy/array-snapshot files;
scoped ESLint and package TypeScript checks passed. The maintained workspace
build passed 23 builds and four fresh-process import checks. Built ESM SDK
probes passed originating prototype identity and native sparse-result contents
for all four methods. No visual CLI behavior changed. No push or release.

## Default species fallback implementation

Twenty-one source regressions confirmed prototype loss for slice, map, filter,
flat, flatMap, splice and concat with plain array-like receivers, undefined
array constructors, and null species. Native VM controls retain identity in
every case. Seven custom species controls returning a null-prototype object
already passed before the change.

arraySpeciesCreate now uses the default-array allocator only after species
selection falls through. The custom constructor path is unchanged. All 28 new
tests and 15 existing Proxy species tests pass. Tests also compare native sparse
contents and own keys, observe later prototype mutations, and reject lossy
data copying. String split remains a separate pending result-realm gap.

The broader method/proxy/array-snapshot selection passed 6,151 tests across
86 files. Scoped ESLint, package TypeScript, the maintained 23-workspace build
and four fresh-process import checks passed. Built ESM probes confirmed
borrowed-result prototype identity for all seven methods. These targeted
checks do not resolve the earlier full-suite timeouts or Promise policy
failures. No visual CLI behavior changed; no push or release occurred.
