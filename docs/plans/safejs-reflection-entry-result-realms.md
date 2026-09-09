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
