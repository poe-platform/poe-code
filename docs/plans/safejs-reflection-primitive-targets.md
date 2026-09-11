---
title: Primitive property reflection
---

Seven failures across fifteen new cases confirmed missing primitive boxing in
Object.getOwnPropertyNames, getOwnPropertyDescriptor and
getOwnPropertyDescriptors. These reflection operations now box non-nullish
primitives before reading the existing sandbox property tables. String index
and length descriptors retain their native flags. Number, boolean and symbol
values have no own properties. Nullish values reject before key coercion.

Object.getOwnPropertySymbols already supports primitives and was left unchanged.
Mutation APIs still require objects; the boxing helper is used only by the
three reflection operations.

The focused Object, accessor, collection-property and primitive-prototype cohort
passed 147 tests across five files. Run scoped lint and types, the selected
workspace build, then this real CLI harness and visually inspect its screenshot.
No agents or capabilities are required. A full workspace run is not claimed for
this localized change.

Scoped lint and TypeScript passed, along with all four selected-build import
checks. The real CLI harness passed; its screenshot was visually inspected.
Its root build completed all 70 tasks uncached.

Next validated gap: promises reject own-property assignment and own-descriptor
reflection. A clean native Node process accepts value.label on Promise.resolve(1)
and reports a writable, enumerable, configurable descriptor. SafeJS rejects the
assignment. Keep promise object-model work separate from primitive boxing.
