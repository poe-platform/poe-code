# Descriptor, JSON and grouping result realms

## Confirmed gaps

Read-only built ESM probes at runtime ae5b505ab exported a factory and its
expected prototype, called the factory after cleanup, then inspected its result
through another realm's Object.getPrototypeOf. Native VM passes all eight
identity checks; SafeJS fails all eight:

- Object.getOwnPropertyDescriptor({a:1}, 'a'): Object.prototype
- Object.getOwnPropertyDescriptors({a:1}): Object.prototype
- Object.getOwnPropertyDescriptors({a:1}).a: Object.prototype
- Reflect.getOwnPropertyDescriptor({a:1}, 'a'): Object.prototype
- JSON.parse('{"a":1}'): Object.prototype
- JSON.parse('[1]'): Array.prototype
- Object.groupBy([1], x=>'a').a: Array.prototype
- Map.groupBy([1], x=>'a').get('a'): Array.prototype

Add failing source tests before fixes. These checks establish result identity
loss, not complete conformance results for the APIs.

## Passing native-backed controls

Descriptor exposure preserves an existing value's identity and all three
property flags. The value's explicit null prototype remains null.

A JSON reviver returning a pre-existing null-prototype replacement for a child
preserves that replacement's identity and prototype. Do not recursively repair
the final reviver output: attach defaults to parsed containers before exposing
them to the reviver, without rewriting its replacements.

Object.groupBy returns a null-prototype outer object even for the key
`__proto__`, and preserves the original element identity. Map.groupBy preserves
object-key and element identity. Neither changes those original objects' null
prototypes. Preserve these controls when fixing newly created bucket arrays.

## Source paths and scope

exposePropertyDescriptor in globals/object-array.ts returns a data descriptor
directly or creates an accessor descriptor. Validate both forms, including
accessor identity and nested getOwnPropertyDescriptors results.

JSON has separate console-json.ts conversion and json-parse.ts reviver paths.
Cover nested containers, reviver callback observations, replacement identity,
deletions, and synchronous SDK behavior where applicable.

globals/group-by.ts creates bucket arrays separately from the outer Map or
null-prototype record. Keep outer-object and payload semantics distinct from
bucket prototypes. Iterator closing and data-budget behavior must not regress.

No runtime/test source was changed. The full package gate remains active on
the same source/test fingerprint. No push or release occurred.

## Descriptor implementation

Six source tests failed before the fix: Object and Reflect data descriptors,
the getOwnPropertyDescriptors outer record and nested descriptor, and Object
and Reflect accessor descriptors with undefined accessors. A control confirmed
getter/setter and value identity without invoking getters. All seven new tests
and eight existing Proxy descriptor tests pass after attaching the originating
Object prototype to exposed descriptors and the outer descriptor map.

The fix preserves descriptor fields and their enumeration order, leaves
referenced values/accessors unchanged, and makes later prototype mutation
observable while rejecting lossy data copying. JSON containers and grouping
buckets remain separate pending fixes. Broader validation is still required.

Final descriptor verification passed 2,697 tests across 188 snapshot/object/
descriptor/Proxy files. Scoped ESLint and package TypeScript checks passed.
The maintained build passed 23 workspace builds and four fresh-process import
checks. Direct built SDK probes passed for both single-descriptor APIs and
getOwnPropertyDescriptors, whose direct ordinary-object route remains
synchronous. No visual CLI behavior changed. No push or release occurred.

## JSON container implementation

Nine regressions failed before the change: empty and nested object/array
containers with and without a reviver, plus reviver holder/context identity
after SDK cleanup. Native VM controls pass. The replacement/deletion/special-
key control already passed; all ten new tests pass after implementation.

The plain JSON conversion path assigns prototypes to each new container.
The reviver parser assigns them during container creation, before callbacks,
and to its root holder and callback context objects. It does not recursively
rewrite final results or reviver replacements. Tests verify later prototype
mutation remains visible and reject lossy data copying. Grouping buckets
remain pending. Broader verification is still required.

Final JSON verification passed 1,954 tests across 139 JSON/snapshot files.
Scoped ESLint, package TypeScript and the maintained build passed (23
workspace builds and four fresh-process import checks). Direct built SDK
probes passed for parsed objects and arrays, with and without a guest reviver.
No visual CLI behavior changed. No push or release occurred.
