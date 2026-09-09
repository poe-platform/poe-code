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
