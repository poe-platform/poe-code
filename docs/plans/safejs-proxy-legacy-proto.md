# Proxy legacy prototype accessor

Six native comparisons failed with one passing invalid-prototype control on
35e6e531e (35634). The __proto__ getter/setter bypassed Proxy prototype traps.

Route reads through the shared prototype operation and Proxy writes through
setPrototypeOf, throwing when it refuses. Preserve invalid-prototype and primitive
receiver behavior, trap receiver identity and nonextensible-target invariants.

Verification: 58 tests across three files, TypeScript and scoped lint passed
(29802). Expanded revocation/invalid-prototype controls plus ordinary and
primitive reflection regressions passed 40 tests across three files and final
test lint (7472). Public construction, callable identity, snapshots and
remaining consumers are incomplete.
