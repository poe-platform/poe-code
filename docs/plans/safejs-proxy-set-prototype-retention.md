# Retain requested prototypes before trap lookup

Two direct helper tests failed on b0686ee8a (73559). The requested prototype was
not retained while the handler's setPrototypeOf property was being read. Caller
argument retention can mask this missing helper-level root.

Retain the requested prototype before shared trap lookup and release it when the
whole operation settles, including lookup errors, fallback and invariant checks.
The ordinary synchronous path remains unchanged. This verifies root accounting,
not native garbage-collection behavior.

Verification: 35 tests across four files, TypeScript and scoped lint passed
(28700). Expanded fallback/revocation cleanup coverage passed all four direct
retention tests and final test lint (91014). Public construction, callable identity, snapshots and
remaining consumers are incomplete.
