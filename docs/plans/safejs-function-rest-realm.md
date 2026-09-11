# Function rest-parameter realm identity

## Evidence and implementation

Six tests reproduced missing array realm identity before implementation.
The shared bindParameters allocation in async.ts now records the originating
array prototype. It preserves the no-prototype fallback for bare interpreter
contexts and leaves parameter binding order and array-length accounting alone.

Native-backed coverage includes arrows, ordinary functions, methods, async
functions, generators, empty rest arrays, and omitted leading arguments.
The async control captures its rest array before suspension so both the
native and SafeJS factory source use valid synchronous wrappers. Tests
inspect values through another run's Object.getPrototypeOf and check data
copy descriptors. Later prototype mutation must reject lossy copying.

## Verification

The initial parameter/arguments selection passed 122 tests across 12 files.
The final rest/generator selection passed 143 tests across five files.
Scoped ESLint passed. The maintained build completed 23 workspace builds and
four fresh-process import checks; a built SDK smoke check preserved rest
array identity and data copying. Package TypeScript passed after the build.
No visual CLI change or release.

Primitive boxing remains a separate creation-realm gap. The package-wide
gate needs a fresh run after the accumulated realm-lifetime changes; these
focused results do not establish full-package or JavaScript conformance.
