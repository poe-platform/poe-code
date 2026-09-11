# SDK TypedArray.from Proxy dispatch

Five native-comparison cases failed before the fix: direct/inherited Proxy
array-like inputs and Proxy iterables yielded empty storage; Proxy mappers and
constructor receivers threw missing guest-context errors.

Replace the SDK fallback's descriptor-only reads with shared guest property
dispatch. Retain that property context during invocation, preserve caller hooks,
and forward explicit newTarget. Keep the existing conversion and iteration order.

All 12 focused tests pass, covering the initial failures, accessor-backed traps,
nested constructor Proxies, mapper receiver/index identity, and revoked input,
mapper, and constructor. The broader buffer/typed-array/Reflect/value selection
passed 1,239 tests across 67 files. Scoped ESLint and package TypeScript passed.
The maintained selected-workspace build passed all 23 declared builds and four
fresh-process import checks. These scoped checks are not a full-package gate.

README updated. No CLI presentation changes. No push or release during the hold.
This addresses TypedArray.from, not all SDK statics or full JavaScript conformance.
