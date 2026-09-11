---
title: Iterator constructor validation
---

# Abstract Iterator constructor

This is the constructor/prototype foundation for the separately tracked
Iterator.from and helper gap, not completion of that broader work.

Specification: https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-iterator-constructor

Against main 5738603a7, 12 constructor tests failed in 1.45 seconds.
One metadata assertion was refined to return scalar descriptor flags rather
than a prototype object containing cross-realm functions. Initial implementation
passed 11 cases and exposed a writable prototype descriptor; explicitly setting
writable:false corrected it. Expanded coverage now passes 16 tests in 1.30
seconds, including abstract call/new rejection, subclassing, existing iterator
inheritance, new-target fallback, borrowed constructor accessors and public replay.

The implementation installs the constructor on the existing shared prototype,
registers intrinsic accessors, and retains normal budget checks on allocation
and writes. Iterator.from and lazy/consuming helpers remain pending.

Delivery checks: scoped lint/types, focused integration tests, normal build,
actual paired harness with screenshot inspection and package-wide regression
checks. Keep the uncommitted Iterator.from baseline separate from this atomic
constructor delivery and report it explicitly if excluded from package checks.

Focused integration passed 146 tests in four files in 3.08 seconds. Initial
scoped ESLint, production package TypeScript and root lint:types passed, as did
the normal build. The actual paired harness then failed AS003 for Iterator;
its screenshot was inspected. A new linter regression reproduced that failure
before adding Iterator to the maintained known-globals list. The updated build,
successful harness run and package-wide verification were then scheduled.

After the lint fix, 17 constructor/linter tests passed in 1.51 seconds. Scoped
ESLint passed for all five changed TypeScript files, and both new test files
have zero TypeScript diagnostics. The CLI rebuild completed 70 uncached tasks
in 65.1 seconds. The real paired harness passed and its screenshot was viewed;
zero spawns means this validates runtime/CLI behavior, not model behavior.
Node 18 built-SDK subclass execution and public dump/replay also passed.
Package-wide tests are running with two explicit exclusions: the unresolved
host-Promise property probe and the uncommitted Iterator.from baseline for the
next atomic improvement. Neither exclusion is counted as passing.

The package run finished with 33 failures, 19,253 passes and 41 skips in
330.36 seconds. It exposed missing intrinsic baseline registration: the new
constructor accessor looked like guest mutation, retaining 13 units and causing
raw snapshot validation to reject Iterator. Registering the constructor and
refreshing the shared prototype baseline fixed the affected budget/running-state/
Promise-order checks (94 tests in five files, 3.04 seconds) without changing
budgets or assertions. Two legacy graph comparisons also explicitly enumerate
new globals; Iterator was added to those expected additions without changing
the archived captures or relaxing graph comparison.
The remaining affected files then passed: 308 tests, one skip, ten files in
6.46 seconds. Updated lint/build and a clean package-wide rerun remain required
before commit and push.

Final verification after registration fixes: scoped ESLint passed; all four
changed test files have zero TypeScript diagnostics; the normal workspace build
and four built-import checks passed. The rebuilt CLI harness passed and its
new screenshot was inspected. Node 18 built subclass execution and public replay
passed again. The clean package rerun passed 19,286 tests across 604 files in
323.93 seconds, with 41 skipped tests and one skipped file. The same two explicit
uncommitted-probe exclusions above remain disclosed and are not passes.
