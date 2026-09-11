# Query Proxy integrity levels

Twelve native comparisons failed on 1cfc9d1fa (1036): isFrozen/isSealed checked
the carrier rather than target extensibility and descriptors.

Return false immediately for extensible targets. Otherwise capture ownKeys,
query each descriptor in order, skip absent properties, and stop at the first
configurable property (or writable data property for frozen). Do not read values.
Retain source and key list across traps and release on every exit.

Reference: [ECMA-262 TestIntegrityLevel](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-testintegritylevel).

Verification: 57 tests across four files, TypeScript and scoped lint passed
(99868). Expanded revocation/retention/failure tests plus symbol and primitive
regressions passed 57 tests across three files and final test lint (52358).
The current internal guest-proxy filename selection passed 416 tests across
26 files (99638); it excludes unimplemented public Proxy global tests.
Other consumers, public Proxy construction, callable
identity and snapshots remain incomplete.
