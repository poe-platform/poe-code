---
title: Primitive symbol member validation
---

# Primitive symbol properties

Validated while checking Array.from constructor order. Four regressions initially
failed: symbol-valued data/getter lookup on string, number and boolean primitives,
and the default string iterator lookup. The first three share an interpreter
early return for symbol keys before boxed-prototype lookup. Move that return
after primitive prototype lookup, preserving the primitive getter receiver and
the existing string length/index special cases.

The fourth failure is distinct: String.prototype has no installed Symbol.iterator
method. Its regression remains in string-iterator-prototype.test.ts for a separate
implementation with iterator state and snapshot support. Do not count it as fixed
by enabling generic symbol-member lookup.

The paired harness checks inherited symbol access and the primitive getter receiver.
No model spawns are required or claimed.

Pre-delivery checks: the construction/primitive/iteration route passed 139 tests
across seven files; focused ESLint, package TypeScript, maintained root lint:types,
and the new tests' own type diagnostics passed. Normal npm run build completed all
70 declared workspace builds and root suffix stages. The real paired harness
passed (zero spawns), and its screenshot was inspected. Node 18 built SDK and
public replay passed. The maintained SafeJS package suite is running with source
held fixed; only the unresolved Promise-import and missing string-iterator probes
are excluded, neither counted as a pass.

Final package validation passed: 19,084 tests passed, 41 optional tests skipped,
597 files passed and one skipped (321.21 seconds). The two explicit exclusions
above remain unfinished probes, not passes. Production sources and the tests in
this delivery were held fixed throughout the run.
