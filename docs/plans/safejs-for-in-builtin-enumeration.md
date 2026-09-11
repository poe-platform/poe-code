# For-in built-in object enumeration

## Validated defect

At ab913b9a7, independent public-run comparisons showed that Date, ArrayBuffer,
SharedArrayBuffer and DataView objects with enumerable guest properties produced
no for-in keys. Primitive numbers, booleans, bigints and symbols were skipped,
and primitive strings missed their guest String prototype properties.
The new 21-case regression file produced nine failures and 12 passes (19e444).

The old `forInObject` gate admitted only arrays, typed arrays, closures, strings,
and objects with a plain native prototype. This conflated guest object support
with the backing object's native representation.

## Repair

Admit objects with registered guest prototypes, plus existing supported data
objects and sandbox Dates. Box non-nullish primitives with createSandboxBox so
prototype lookup uses the guest realm. Retain the enumeration object throughout
body execution. Null and undefined still yield no keys.

An initial unrestricted object conversion failed five existing internal-interpreter
checks (47b266): raw host functions were sent to primitive boxing, and unimported
native Map/Set/RegExp properties became enumerable. Preserve that data-only
boundary instead of changing its tests. The final gate keeps unimported host
functions and unsupported native objects excluded, while admitting guest objects.
No native host getters or prototype chains are newly exposed.

## Verification

The six-file enumeration/interpreter/generator selection passes all 562 tests,
including the 21 new regressions (345c5e). Controls cover boxes, collections,
RegExp, promises, errors, class instances, symbols, non-enumerable properties,
inherited guest properties, Proxy enumeration and generator continuation.
Scoped ESLint and package TypeScript checks passed (48b708).
No visual CLI changes require screenshots. README and inventory are updated.

## Separate upstream findings

Read-only in-memory qualification of top-level
`test/language/statements/for-in` at Test262
`72faf8ec1445c55149615e8b35187830783aba1a` reports 46 runtime passes, five runtime
failures, 26 parse rejections, nine excluded noStrict/runtime-negative fixtures,
and zero native-unqualified cases (2479e9). The `dstr` subdirectory was not included.
The five failures are:

- head-const-bound-names-fordecl-tdz.js
- head-let-bound-names-fordecl-tdz.js
- scope-body-lex-open.js
- scope-head-lex-close.js
- scope-head-lex-open.js

These concern missing uninitialized lexical bindings during header RHS evaluation,
not object enumeration. They remain open for a separate repair. Native controls
passed before guest execution; sources and declared includes were unchanged.
Parse rejection does not prove exact error branding. This is not full Test262
conformance or an official runner result.

Local-only delivery under the release hold; no push, publication or issue closure.
