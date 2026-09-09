# Explicit prototype link lifetime

Three native-backed constructor tests fail because Uint8Array, Float32Array, and
BigInt64Array lose their guest prototype after run cleanup. setSandboxPrototype
returns early when the requested link equals the budget fallback, recording no
explicit link. Cleanup later removes the fallback.

Record the requested link even in that equality case. Preserve validation and
zero traversal cost for a semantic no-op. Do not extend the lifetime of run
lookup tables or change cleanup's retained-root removal. The link is held through
the existing per-object WeakMap and follows the object's lifetime.

The three constructor tests pass after repair, and the previously failing SDK
Iterator.from typed-array case now passes. Array and primitive-string SDK inputs
remain unresolved in safejs-sdk-builtin-input-lifetime.md. An additional test
checks originating-realm identity and later prototype mutation after another
realm has run.

The first broader run finished with 3,533 passing and 19 failing tests across
229 files. Retaining every link made ordinary buffer/typed-array data transport
and replay reject them as custom guest state. Three additional focused copy
tests reproduced this regression before the follow-up implementation.

Record which persisted links originally matched an implicit default. Data-only
transport may omit such a chain only while each originating intrinsic prototype
remains pristine, using the existing intrinsic baseline checks. Custom links,
changed prototype properties, changed intrinsic method properties, and mutations
after cleanup still require guest graph state and must not be silently copied.
Do not bypass custom-descriptor checks on the instance itself.

The initial focused follow-up selection passed 27 tests across three files.
The broader rerun passed 3,560 tests across 229 files (145.85 seconds), covering
snapshots, typed arrays, buffers, prototype behavior, and retention accounting.
TypeScript caught a missing undefined guard on WeakMap.get; the guard is now
explicit. Scoped ESLint and package TypeScript passed, followed by the maintained
workspace build closure: 23 builds and four fresh-process import checks passed.

A final focused run after the guard change passed all 12 tests in the new file
and the separate typed-array SDK input case. The array and string SDK input
cases still failed (13 passed, two failed overall in that two-file selection).
This is not a full package gate or a claim of complete SDK iteration support.

README updated. No CLI presentation changes. Pushes and releases remain paused.
