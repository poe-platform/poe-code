---
title: Array locale conversion and guest prototype dispatch
---

# Array locale conversion

## Validated gap

Two native-oracle tests fail on the current implementation: array locale
conversion is rejected as unsupported, and the prototype method is absent.
One case includes exact BigInt values; the other exercises a generic array-like
receiver and forwards locales/options to a guest element method.

## Requirements

Implement the published Array.prototype.toLocaleString algorithm with generic
receivers, captured length, sequential property reads, nullish entries, guest
method lookup/call and result string coercion. Preserve argument identities and
receiver binding. Validate mutation, accessors, sparse arrays, nested arrays,
cycles, exceptions, budgets, metadata and replay before delivery. Keep this
atomic improvement separate from the Number/BigInt locale implementation.

## Prerequisites found in current code

Arrays lacked a guest prototype entirely. Install an array-exotic prototype
with the existing maintained methods and shared identities. Preserve fast
dispatch only while the original method descriptor is still present; overrides,
accessors and deletion must use actual guest property lookup. Default array
string coercion must also consult this graph. Array toString uses the captured
intrinsic Object toString fallback, not a mutable public property.

Object.prototype.toLocaleString was also absent, preventing locale conversion
of strings, booleans and ordinary objects. Implement its generic invocation of
the receiver's toString without coercing the returned value or forwarding the
ignored arguments. Array locale conversion then invokes each element method
with precisely locales/options and string-coerces the result.

Sources: ECMA-402 2026 locale-sensitive-functions.html, Array.prototype.toLocaleString;
ECMA-262 2026 Array.prototype.toString and Object.prototype.toLocaleString.

## Validation record

The expanded pre-implementation suite had 21 failures and six passes. After
implementation, a further failing test confirmed mutable Object.toString was
incorrectly used for Array.toString fallback; capturing the intrinsic fixed it.
The focused suite now has 34 passing cases. Run the full maintained SafeJS suite
because the prerequisite changes affect shared prototype and coercion dispatch.
The unresolved native-Promise import-policy probes remain explicitly separate.

The first full run found eight failures (17,244 passes, 41 skips). Four assertions
encoded the old missing Array prototype; the updated assertions check the guest
constructor's identity and continue rejecting native Function-constructor gadgets.
Two budget tests exposed a charged prototype lookup during intrinsic installation;
installation now obtains the known intrinsic directly without guest work charges.
Two borrowed-method tests exposed missing function-property deletion and typed
array presence handling in the new prototype wrappers; reuse the existing deletion
operation and sandbox own-property check. The five-file regression cohort now
passes 355 tests, including 36 locale/prototype cases and retained intrinsic
snapshot/replay. A clean full rerun excludes the separately validated, uncommitted
Array subclass probes as well as the native-Promise import-policy probes.

The clean rerun passed 17,254 tests across 501 files, with 41 existing skips
(one skipped file), in 259.03 seconds. The two disclosed probe files were not
collected and are not counted as passes. Scoped ESLint and TypeScript checks pass.

The selected build passed 23 dependency-closure tasks and four native import
smoke tests. The real harness passed, and its screenshot was inspected. The
harness runner's root build completed 70 tasks with zero cached results.
