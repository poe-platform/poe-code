# Buffer SDK Proxy newTarget prototype reads

Three native comparisons failed before repair: SDK construction of ArrayBuffer,
Uint8Array, and Float32Array ignored the prototype supplied by a Proxy newTarget
and selected the intrinsic prototype instead.

Use shared guest property reads in the ArrayBuffer constructor's fallback
context. For typed arrays, supply a fallback guest context only when the caller
does not provide getProperty. Preserve interpreter-supplied hooks. The fallback
invocation context forwards the explicit newTarget argument and provides guest
reads for nested Proxies and accessor-backed traps without recursive delegation.

Fifteen focused cases cover direct/nested Proxies, accessor-backed get traps,
ordinary constructor controls, and revoked Proxies across all three constructors.
The prototype cases compare with native Reflect.construct and assert identity,
not just an equivalent prototype shape.

All 15 focused tests passed. The broader buffer/typed-array/Reflect selection
passed 497 tests across 24 files. Scoped ESLint and package TypeScript passed.
The maintained closure passed 23 builds and four fresh-process import checks.
No full-package pass is implied by
these scoped checks; host-Promise import policy remains unresolved.

README updated. No CLI presentation changes. Pushes and releases remain held.
