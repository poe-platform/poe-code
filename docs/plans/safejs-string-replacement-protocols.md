---
title: Replacement and matchAll symbol protocols
---

## Validated gaps

The initial 14 native comparisons had 11 failures. String.replace/replaceAll
ignored Symbol.replace and matchAll ignored Symbol.matchAll. Borrowed receivers
were coerced before custom hooks; global-RegExp checks did not follow Symbol.match
or observe flags before reading the operation hook. Nullish replacement hooks
also exposed missing ordinary search/replacement string conversion.

## Implementation

Extend the shared protocol dispatcher, preserving original receiver/replacement
values and guest promise identity. For replaceAll/matchAll, determine RegExp status
through Symbol.match and check converted flags before operation-hook lookup.
Retain synchronous context-free adapters where possible.

Native opt-out comparisons exposed assumptions in the fallback: a non-global
RegExp with Symbol.match=false must perform only one intrinsic match. Stop forcing
global iteration from the string method name. Convert object-valued lastIndex for
matchAll even on opted-out non-global RegExp instances.

For ordinary replacement fallback, convert search before replacement and retain
converted strings across guest conversions. A budget regression reproduced a
lost converted search root; the large-string case must fail before the host
observer, while smaller strings complete at the same 7,500-unit budget.

Explicit null/undefined RegExp replacement hooks select ordinary string fallback.
Unbranded native host RegExp values remain rejected before protocol reads; the
existing rejection test now names that boundary rather than the retired blanket
restriction on object-valued search/replacement arguments.

## Qualification

Run native comparisons, budget controls, maintained SafeJS package tests, scoped
lint/types, selected workspace build, and this real CLI harness with screenshot
inspection. The harness uses no external capabilities and spawns no agents.

The maintained package suite passes 14,110 tests, with 41 skipped. All 535 focused
interpreter/string tests pass, and scoped ESLint and TypeScript complete cleanly.
The selected workspace build and real CLI harness pass; the harness screenshot
was visually inspected.

## Remaining gaps

This does not implement the full RegExp intrinsic prototype graph or lazy
RegExp String Iterator semantics for the built-in matchAll fallback. Advanced
regex syntax/flags, accessor snapshots and other recorded JS gaps remain open.
