# Proxy property reads

The initial tests on 37970ddc1 produced 15 failures and one passing control
(17524). Reflect.get inspected the carrier, missed traps and inherited values,
lost receiver forwarding, and ignored revocation and protected-value invariants.
Native comparisons establish the expected frozen-data and getterless outcomes.

Implement Get with ordinary prototype traversal, Proxy trap dispatch, recursive
fallback retaining the original receiver, and post-trap target descriptor checks.
Use SameValue for frozen data, including NaN and signed zero. Ordinary accessors
receive the requested receiver. Canonical numeric typed-array keys stop lookup.
Budget prototype and Proxy traversal.

Reference: [ECMA-262 10.5.8](https://tc39.es/ecma262/2026/multipage/ordinary-and-exotic-objects-behaviours.html#sec-proxy-object-internal-methods-and-internal-slots-get-p-receiver).

The initial selection passed 108 tests (57837) and TypeScript; lint identified
an unused import, subsequently removed. A retention test passed through Reflect
because it retains call arguments (72997), but failed when calling the internal
operation directly (48258: one failed, 16 passed). Retain the receiver before trap
lookup and the trap result through target invariant queries, releasing both on
completion. The final command (58247) completed successfully: 109 tests across
three files, TypeScript and scoped lint all passed.

Reflect is integrated. Guest member reads, handler objects that are themselves
proxies, descriptor-input proxies, and broader method/iteration dispatch still
need interpreter integration. Public Proxy construction, snapshot support and
full-package validation are not claimed. No push or release.
