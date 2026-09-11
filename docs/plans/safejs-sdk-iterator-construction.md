# SDK Iterator subclass construction

Four native-backed cases failed before repair: direct, nested, and accessor-trap
Proxy newTarget values lost their selected prototype, and a revoked newTarget
was accepted. The SDK constructor fallback used descriptor-only lookup.

Use shared guest property access with a fallback invocation context, preserving
provided hooks and explicit newTarget. Keep abstract-constructor rejection and
the retained intrinsic prototype fallback for primitive prototype values.

Eight focused tests pass, including undefined/null/numeric prototype fallbacks
after run cleanup and direct abstract construction. The broader iterator,
iteration, and generator selection passed 1,583 tests across 62 files. Scoped
ESLint and package TypeScript passed. The maintained selected-workspace build
passed all 23 declared builds and four fresh-process import checks. This is
scoped verification, not a fresh full-package or JavaScript conformance gate.
README updated; no CLI presentation changes. No push or release during the hold.
