# Buffer SDK Proxy species lookup

Three native comparisons failed before repair: SDK slice calls on ArrayBuffer,
Uint8Array, and Float32Array skipped Proxy species holders and returned the
default result type instead of the selected subclass.

Use shared guest property reads in ArrayBuffer slice and the typed-array method
fallback context. Preserve caller-supplied operations, and provide a separate
fallback invocation context for accessor-backed traps and Proxy constructors.
Forward explicit newTarget during fallback construction. Remove imports made
unused by the ArrayBuffer fallback replacement.

Eighteen focused native comparisons cover direct and inherited Proxy holders,
receiver identity, accessor-backed get traps, Proxy-valued species constructors,
ordinary species controls, and revocation across the three buffer types. The
positive cases assert the result's actual guest prototype identity.

All 18 focused cases passed. The broader buffer/typed-array method selection
passed 1,160 tests across 63 files. Scoped ESLint and package TypeScript passed.
The maintained closure passed 23 builds and four fresh-process import checks.
These checks do not establish a passing
full-package gate or complete SDK Proxy integration. Host-Promise import policy
remains unresolved.

README updated. No CLI presentation changes. Pushes and releases remain held.
