---
title: Array.from construction ordering
---

# Array.from constructor/iterator ordering

Validated against the built SDK during namespace validation. With a custom
result constructor and iterable, Array.from.call(C, items) records
`["iterator", "constructor"]`; native Node records `["constructor", "iterator"]`.
The source helper in interp/globals/object-array.ts acquires and invokes the
iterator before constructing the result. Array.from must read the iterator
method first, construct the result second, and invoke that saved method third.

Specification: https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.from

Add failing tests before implementation, including getter/factory/constructor
order, a throwing constructor that must not invoke the iterator factory, and
method mutation during construction (the captured method must be used).
Preserve iterator-close behavior, SDK invocation, budgets and snapshots.

Do not automatically apply this ordering to Array.fromAsync: its algorithm
acquires the iterator before constructing the result. Array.fromAsync itself
remains unsupported in the built SDK. Its future tests must distinguish async
iterator values from async-from-sync values and array-like values, and validate
promise rejection, sequential mapping, iterator closing and constructor behavior.

Initial TDD: four failures and three passing controls (1.07 seconds). The ordering
implementation separates method capture from GetIteratorFromMethod, retaining the
captured method during construction and preserving implicit built-in iteration
for legacy low-level callers. Expanded construction/iteration checks pass 139
tests across seven files after the separately validated primitive-symbol fix.

Two adjacent failures were retained as separate regression files: the missing
String.prototype iterator, and typed-array custom-property public replay. Neither
is silently dropped from the gap audit or counted as an ordering-test pass.

Pre-delivery checks: focused ESLint, package TypeScript, maintained root lint:types
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
