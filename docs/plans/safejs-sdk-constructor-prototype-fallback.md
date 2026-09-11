# SDK typed-array constructor fallback

Nine native-comparison tests reproduce a post-run constructor failure across
Uint8Array, Float32Array, and BigInt64Array with undefined, null, or numeric
newTarget.prototype. Native JavaScript uses the intrinsic prototype; SafeJS
throws while reading the per-budget registry cleared by run cleanup.

Read the fallback from the retained intrinsic constructor instead. Its prototype
property is non-writable, and custom newTarget prototype lookup remains unchanged.
Keep the existing object-prototype and revoked-Proxy regression cases.

Validation: all 65 focused SDK constructor/species/result tests passed. The
broader buffer/typed-array/Reflect/value selection passed 1,217 tests in 65 files.
Scoped ESLint and package TypeScript passed. The maintained selected-workspace
build passed 23 declared builds and all four fresh-process import checks.
These are scoped checks, not a full-package or JavaScript conformance gate.

README updated; no CLI presentation changes. Pushes and releases remain paused.
