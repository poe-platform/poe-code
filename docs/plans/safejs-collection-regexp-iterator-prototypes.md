---
title: Map and Set iterator prototype validation
---

# Collection and RegExp iterator prototype gaps

Validated during deleted-iterator fallback work, September 7. A native comparison
creates each of `new Set([2,4]).values()`, `new Map([[2,4]]).entries()`, and
`'ab'.matchAll(/./g)`, then deletes
`Object.getPrototypeOf(Object.getPrototypeOf(value))[Symbol.iterator]` and spreads
the iterator. Native returns TypeError from the spread. SafeJS instead throws
before that point: the second prototype lookup is null, so the deletion itself
fails. String and Array iterator counterparts pass.

The five-case expansion ran with three failures and two passes; the full file had
64 passing cases and these three failures. This is concrete evidence of a missing
prototype graph, separate from falling back after deletion on String/Map/Set
instances. Preserve these reproduction expressions for a separate TDD change.
Do not claim collection/RegExp iterator prototype completeness from the deletion
fix. Validate own-vs-prototype methods, brands, common IteratorPrototype identity,
tags/descriptors, overrides, retained state, SDK transport and snapshots when
implementing the actual graph. Review existing iterator helpers before adding
another wrapper or snapshot representation.

Read-only inspection located existing private state in collection-iterator.ts and
regexp-iterator.ts, fresh-per-read method synthesis in methods/collection-iterator.ts
and methods/regexp-iterator.ts, and interpreter fallback dispatch. Collection next
already checks Map-vs-Set brands; RegExp next already supports observable custom
exec behavior. Preserve those semantics when moving methods onto real prototypes.
Existing public dump formats have specialized iterator nodes with enumerable
entries/symbol entries, so descriptor/prototype state needs an explicit audit.

Primary reference for the common-parent and tag requirements:
https://tc39.es/ecma262/2024/multipage/text-processing.html#sec-%regexpstringiteratorprototype%-object
and Map iterator clauses at
https://tc39.es/ecma262/2023/multipage/keyed-collections.html#sec-%mapiteratorprototype%-object .
Use the current ECMA main algorithm when implementing; these edition links were
available during initial research and are not a claim about all newer helpers.

Additional isolated built-SDK probes confirmed that `it.next === it.next` is
false for all three iterator kinds (native true). Map/Set iterators also report
`typeof it[Symbol.iterator]` as undefined (native function); RegExp reports
function. Their Object.prototype.toString tags already match native. Preserve
the working tags while fixing method identity, exposure and prototype ownership.

Next atomic scope is Map/Set iterator prototypes; RegExp will follow separately.
The 14-case Map/Set TDD file `interp/collection-iterator-prototype.test.ts` ran
against b40eaf4d5: 12 failures and two passing receiver-error comparisons in
1.70 seconds. Those two comparisons also pass when next is missing, so they do
not prove correct brand checks. The failures independently validate method
identity, Symbol.iterator exposure, parent identity, descriptors, overrides and
deletion. No collection prototype implementation had changed at that baseline.

Map/Set implementation now installs their shared per-kind prototypes after the
common IteratorPrototype exists. Constructors keep standalone legacy behavior;
normal runtime iterators receive the registered prototype. Prototype descriptors
take precedence over synthesized legacy methods, including after deletion.
The first installation attempt exposed ordering failures; deferring installation
until after built-in creation fixed them, and 74 focused tests passed.

Four added replay/cursor tests then failed because prototype-linked collection
iterators were not serializable. A guest collection-iterator heap node now records
the private cursor plus complete property/prototype state, validates it, and
restores collection cycles before cursor initialization. Legacy data-clone and
replay-input restrictions remain; runtime snapshots now support custom iterator
prototypes. Updated that snapshot expectation to assert restored prototype and
cursor, while keeping data-copy rejection assertions.

Budget audit: the suspected missing symbol accounting was disproved by a passing
baseline check and source inspection; symbols are already counted generically.
Removed the redundant specialized symbol scan and added an exact single-charge
control. Accessor captures did expose a real omission: 11 units measured versus
at least 102 required. Traversing retained accessor closures fixed it without
executing getters. All 31 new prototype, snapshot, validation and budget tests
pass. Before the final memory refinement, 319 focused regressions passed across
eight files in 5.24 seconds. RegExp prototype implementation remains separate.

Pre-delivery checks passed: scoped ESLint, package production TypeScript,
maintained root lint:types, normal workspace/root build, and changed-test-file
TypeScript diagnostics. The existing snapshot helper needed an explicit fixture
type annotation at its serializer boundary; its runtime assertions remain.
The real paired harness passed and its screenshot was inspected (zero agent
spawns, not model-behavior evidence). Node 18 passed the built SDK live Map cursor,
accessor identity, Symbol.iterator, stable next and public dump/replay assertions.

The maintained package-wide unit route passed in 328.31 seconds: 19,234 tests
across 601 files passed, 41 optional tests and one file skipped. All 31 new
regressions are included. The separately tracked unresolved
`promise-import-properties.test.ts` probe was explicitly excluded and is not
counted as passing. No matching open GitHub issue was found.
