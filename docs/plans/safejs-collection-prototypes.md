---
title: Shared collection prototypes
---

## Validated gap

Ten initial tests failed: Map/Set lacked constructor metadata and public
prototypes, Object.getPrototypeOf rejected instances, and each method lookup
created a distinct function. Borrowed prototype methods were unavailable.

## Implementation

Install per-realm Map/Set prototypes, shared branded methods, size accessors,
species accessors, string tags and standard iterator aliases. Keep internal
collection storage hidden. Resolve instance members through these prototypes
and respect method replacement/deletion. Track accessor-function mutations as
well as data-method mutations for portable checkpoints.

Preserve the existing mutation-aware cursor adapter when the resolved iterator
is exactly the trusted default intrinsic, after observing any iterator getter.
Custom iterators still execute. This repairs 13 cursor-restoration regressions
found by the existing suite after exposing Symbol.iterator.

Two additional regressions showed that `in` invoked getters and failed for an
inherited undefined value. Traverse the prototype chain without reading values.

## Verification

- 34 new tests: constructor/prototype descriptors, shared identities, borrowing,
  receiver validation, aliases, tags, prototype mutation, accessors, callbacks,
  iterator overrides, `in`, serialized/direct checkpoints and forged wrappers.
- Collection/callback/receiver compatibility cohort: 287 passed before the final
  two `in` cases; expanded prototype test file: 34 passed.
- Source probes also verified inherited for-in enumeration, destructured method
  identity and Map instance membership in Object's prototype chain.
- Maintained package unit route: 16,447 passed, 41 skipped (461 passed files,
  one skipped). Scoped ESLint and TypeScript passed.
- Selected workspace build passed, including four built-import checks. The real
  CLI harness passed; its screenshot was visually inspected. The CLI build also
  completed all 70 tasks uncached.

## Remaining collection work

This installs the built-in prototype graph, not a complete collection object
model. Instance-owned descriptors and custom prototype/subclass state still
need storage, copy/snapshot handling and validation. Constructor use of overridden
add/set methods also needs a separate fix: current-source probes showed no calls
to an overridden Map.prototype.set during construction. The same probes confirmed
instance property assignment throws and a Map subclass instance lacks its class
prototype. These are validated remaining requirements, not supported behavior.
Eight failing constructor-adder tests now cover override invocation, cached
getter lookup, non-callable rejection and iterator cleanup. Leave those
next-issue tests outside this prototype commit.
