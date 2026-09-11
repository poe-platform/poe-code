---
title: String match search and split symbol hooks
---

## Validated behavior

Native comparisons found missing Symbol.match, Symbol.search and Symbol.split
dispatch. Hook getters must run before receiver string coercion, exactly once;
calls preserve the pattern as this, the original receiver argument, and an
unconverted split limit. Nullish hooks fall back; non-callable hooks throw.
Guest promise results retain identity. Borrowed methods reject nullish receivers
before inspecting hooks.

The initial 14-case probe had 11 failures. One failure independently exposed the
RegExp symbol-assignment restriction below. The remaining 13 native comparisons
and existing direct string-method tests now pass (35 tests).

## Implementation and qualification

Separate protocol dispatch from the existing string-operation body. Do not coerce
borrowed receivers before dispatch. Preserve synchronous context-free adapters
where lookup and fallback are synchronous. Use the maintained guest property
reader and closure invocation rather than invoking host symbol hooks.

Run scoped ESLint, TypeScript, the maintained SafeJS unit suite, selected workspace
build, and this paired CLI harness with screenshot inspection. The harness uses
no capabilities and spawns no agents.

The maintained package suite passed 14,051 tests, with 41 skipped. Scoped ESLint
and TypeScript also completed successfully.

## Follow-up gaps, not completed by this commit

RegExp instances reject symbol assignments. Concrete reproducer:
`const pattern=/t/;pattern[Symbol.match]=function(value){return value+'!'};return 'text'.match(pattern);`
Native returns text!; SafeJS throws RegExp symbol properties are not yet supported.
This failure occurs before the string dispatch and needs a distinct RegExp
property-model change with descriptor, budget and snapshot coverage.

Symbol.replace and Symbol.matchAll dispatch, RegExp intrinsic protocols, and the
existing restricted split fallback coercion still need separate validation/fixes.
This delivery does not establish full string/RegExp or JavaScript completeness.
