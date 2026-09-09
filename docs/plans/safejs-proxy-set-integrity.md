# Freeze and seal Proxy objects

Eight native comparisons failed on 4f5999581 (7749): freeze/seal changed only the
carrier, skipping target prevention, key enumeration and definitions.

Prevent extensions first and stop on refusal. Enumerate keys once. Seal defines
configurable:false without a separate descriptor query. Freeze queries each
descriptor, skips absent ones, and adds writable:false only for data properties.
Preserve symbol/order behavior, partial effects and shared Proxy invariants.
Retain source and key list across traps and release on exit.

Reference: [ECMA-262 SetIntegrityLevel](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-setintegritylevel).

Verification: 71 tests across four files, TypeScript and scoped lint passed
(77656). Expanded revocation, retention and cleanup-on-failure cases plus symbol
and primitive reflection regressions passed 53 tests across three files and final
test lint (39173). Integrity queries (isFrozen/isSealed), other consumers,
public Proxy construction and snapshots remain follow-up work.
