---
title: BigInt typed-array validation
---

# Validated BigInt typed-array gap

The two native-comparison constructor/index tests in bigint-typed-array.test.ts
fail against 185a664d4. BigInt64Array and BigUint64Array are absent from the
typed-array constructor registry; the implemented family currently contains nine
Number-content types.

Extend the maintained typed-array infrastructure to both BigInt-content types.
Do not merely register names: validate ToBigInt conversion, signed/unsigned
wrapping, number/BigInt content-type mismatches, constructor and static factories,
indexed operations, all maintained methods, sorting, callback values, buffer/view
aliasing and resizable/detached behavior. Preserve host import/export, replay and
both snapshot routes. Derive family membership from the shared registry.

Use failing native-comparison tests before each implementation change. Preserve
number-typed-array behavior and budget accounting. Exercise the built Node 18
SDK and a real harness pair, including a screenshot, before an atomic main push.

Implementation evidence: the initial 32-case suite failed before implementation.
Shared registry membership now includes both 64-bit BigInt types; element writes
use ToBigInt while lengths, indices and comparator results still use ToNumber.
Descriptor writes and SDK closure locale methods have dedicated regressions.
Host copying, replay bytes, public snapshots and out-of-bounds resizable snapshot
restoration are covered alongside wrapping, factories and maintained methods.

Native-oracle exception: Node 22.23.2 and 24.14.0 accept empty incompatible species
results, and incompatible subarray species. ECMA-262 TypedArraySpeciesCreate
explicitly requires matching ContentType. The regression uses the specification
oracle and was confirmed failing with that check removed before restoring it.
Source: https://tc39.es/ecma262/multipage/indexed-collections.html#sec-typedarrayspeciescreate

The harness pair exercises runtime behavior without spawning agents; it does not
claim validation of model behavior.

Validation on 2026-09-07:

- Maintained package unit route: 18,950 passed, 41 optional cases skipped,
  586 passing files, 306.68 seconds. The existing unresolved
  promise-import-properties policy probe was explicitly excluded.
- Subsequent low-level conversion regression uses maxSteps (the initial probe
  mistakenly used steps). Both corrected tests failed without budgeted conversion.
  Sharing the existing BigInt primitive conversion now charges this path too.
- After that final change, 234 tests passed across nine BigInt, DataView, snapshot,
  parser and typed-array locale files, including all 56 new typed-array tests.
- Package TypeScript and ESLint over the changed TypeScript files passed.
- The first real harness screenshot exposed AS003: lint had a duplicate typed-array
  name list. Two lint regressions confirmed this before the fix. Runtime and lint
  now derive names from one dependency-free constructor registry. All 696 tests
  across 42 lint and typed-array files passed after this correction.
- Built Node 18.18 SDK execution and public snapshot restoration passed with
  signed/unsigned aliases, BigInt mapping and exact 64-bit wrapping.
- Final real harness passed; the screenshot was inspected. Its rebuild completed
  70 uncached workspace tasks in 65.139 seconds plus root suffix stages. Rebuilt
  Node 18.18 lint, execution and snapshot checks passed as well.
