# Promise result realms and AggregateError descriptors

## Evidence boundary

Native Node VM and built SafeJS probes were run against local commit
`52d8ad42b`. The full package suite used source/test digest
`c31f51cabe7178d2dbc7770911e0fd10410402bc04eb4c6101fae47956dac7d8`.
Its discovered inputs remained unchanged: 24,368 tests passed, three failed
and 37 were skipped. See safejs-realm-lifetime-full-gate.md for the failure
details and accounting follow-up. The audit observations below are not claims
that all the listed gaps have been fixed; individual implementation results
are recorded separately.

## Validated mismatches

Export each Promise static method and its Array/Object prototypes from realm A,
export a Promise constructor and input from realm B, and export
Object.getPrototypeOf from realm C. Invoke A's method with B's constructor as
receiver. Inspect results with C's getter, using identity rather than names.

- Promise.all: the result array does not retain A's Array prototype.
- Promise.allSettled: both the result array and its entry objects lose A's
  respective Array and Object prototypes.
- Promise.withResolvers: the capability object loses A's Object prototype.
- The promises produced by those three calls also fail identity comparison
  against B's Promise prototype. Payload identity and explicit null payload
  prototypes pass for all/allSettled; preserve those controls.
- Promise.any: both empty input and two rejecting thenables produce errors
  whose prototype and errors-array prototype fail comparisons against A's
  AggregateError and Array prototypes. Native controls pass both comparisons.
  Rejecting thenables avoid introducing unobserved host or guest promises into
  the test setup.

An independent in-realm descriptor reproduction is:

```js
return await Promise.any([]).catch(error => {
  const descriptor = Object.getOwnPropertyDescriptor(error, "errors");
  return [Object.keys(error), descriptor.writable,
    descriptor.enumerable, descriptor.configurable,
    Object.getPrototypeOf(error) === AggregateError.prototype];
});
```

Native result: `[[], true, false, true, true]`.
SafeJS result: `[["errors"], true, true, true, true]`.
This is a descriptor bug independent of SDK cleanup or cross-realm calling.

## Current implementation evidence

`settleIterable` stores aggregate values in an unlinked fresh array.
`createPromiseAggregateHandler` creates allSettled entry records as plain
objects. `withResolvers` exposes the internal capability record directly.
`completePromiseAggregate` assigns `error.errors = values`, creating an
enumerable property.

`releaseObjectPrototype` deletes Promise and Error fallback maps, unlike the
retained Object/Array/Date/RegExp maps. Promise construction links a prototype
only when the requested prototype differs from its captured default. Internal
pending capabilities do not explicitly link their originating prototype.
These observations identify candidate repair locations, not permission to
re-prototype user payloads or relax memory accounting.

## Test-first implementation requirements

1. Add red tests for the descriptor bug with empty and rejecting input. Repair
   it as an atomic change and verify Promise.any and snapshot coverage.
2. Add cross-realm red tests for empty/nonempty aggregate arrays, fulfilled and
   rejected allSettled entries, and withResolvers. Preserve payload identity,
   custom constructor behavior, descriptor flags and key order.
3. Validate Promise and Error prototype lifetime separately, including values
   created by exported closures after cleanup, borrowed constructors, custom
   newTarget prototypes and mutated originating prototypes.
4. Preserve default-prototype data-copy classification, while rejecting lossy
   copies of genuinely custom or modified prototype graphs.
5. Cover public replay and retained memory for any added state. Run narrow
   maintained checks and selected-workspace build before each local commit.

No push or release is authorized during the publication hold.

## Generator follow-up controls

Sixteen further built-SDK/native operations passed after the generator fix:
promised return before start (two), promised return while suspended (three),
body return of a thenable (three), return through a yielding finally block
(four), and caught throw (four). Each compares result prototype identity and
value/done contents. This is bounded follow-up evidence, not proof of all
generator behavior.

## Error-constructor lifetime follow-up

Eight additional native/SDK probes compare an error created inside `run` with
one created later by an exported closure. Error, EvalError, RangeError,
ReferenceError, SyntaxError, TypeError, URIError and AggregateError all preserve
their native prototype in the control and in the initial SafeJS value, but
lose it in the later SafeJS value. Native enumerable own keys remain empty;
the later SafeJS values enumerate name/message/stack, plus errors for
AggregateError. A SafeJS-only SuppressedError probe also switches to enumerable
name/message/stack/error/suppressed fields; do not count that as a Node 22
native comparison.

`createErrorConstructor` selects its native or legacy implementation based on
whether `errorPrototypes.has(budget)` remains true. Cleanup deletes that map,
so a live exported constructor changes behavior after the run ends. Retaining
the weak-budget lookup must not retain accounting roots released by cleanup;
add explicit cleanup and legacy-prototype-disabled controls.

Separately, the errors array of an AggregateError constructed inside `run`
fails the originating Array-prototype comparison from a foreign getter.
`createNativeError` builds that array without a prototype link. Fix its fresh
array allocation separately from preserving the Error constructor lookup,
and keep error-element identity and custom prototypes unchanged.

## Red regression tests added during the full-suite run

Three new test files were added after the full run's discovery and executed
separately. They are not part of that run's claimed coverage. Excluding exactly
those three new files from the source/test digest reproduces the original
`c31f51cabe7178d2dbc7770911e0fd10410402bc04eb4c6101fae47956dac7d8`;
runtime and previously discovered test files remain unchanged.

- promise-any-descriptors.test.ts: three failing descriptor/replay cases and
  one passing payload-identity, replacement and deletion control.
- error-prototype-lifetime.test.ts: nine failures, covering the eight native
  constructors and custom newTarget prototype behavior after cleanup. A further
  cleanup test verifies dirty intrinsic data is retained before cleanup and
  released afterward, then fails the Error prototype fallback comparison.
  The explicit legacy Error-mode control passes.
- promise-result-realm.test.ts: seven failures, covering empty/nonempty all,
  allSettled and any, plus the withResolvers capability. Separate soft
  assertions expose the Promise, array, settlement-record and Error realm
  mismatches rather than stopping at the first failed comparison.

The realm/lifetime red tests are uncommitted pending their respective atomic
fixes. The Promise.any descriptor repair defines errors as writable and
configurable but non-enumerable, instead of assigning an enumerable property.
All four new descriptor/replay/control tests pass, together with the existing
Promise and aggregate-state tests: 95 tests across four files. Package
TypeScript and scoped lint pass. Another 27 tests across four Promise-aggregate
and Error snapshot files pass (122 tests across eight files total). The
maintained build and full-package gate predate this descriptor-only change;
neither is claimed as validation of it. No visual CLI behavior changed.

## Foreign newTarget fallback: separate open gap

A native/built-SDK comparison exported Reflect.construct and a constructor from
realm A, and `function Target() {}; Target.prototype = 7` from realm B. Native
construction with that newTarget uses B's corresponding intrinsic prototype.
Error, TypeError, Number, Array, Date, RegExp, Map and Set all fail that identity
comparison in SafeJS. Number/Array/Date/RegExp instead use A's prototype;
Error/TypeError/Map/Set match neither captured prototype after cleanup.

This fallback gap is distinct from live-constructor lookup retention and from
honoring an explicitly supplied object prototype. Do not count it as repaired
by restoring Error lookup lifetime. Future regression coverage must distinguish
those cases and inspect bound/Proxy newTarget behavior and snapshot retention
before introducing a shared realm-resolution mechanism.

## Error lookup lifetime implementation

Cleanup now preserves the weak-budget Error prototype lookup while continuing
to release intrinsic accounting roots. Exported constructors therefore keep
their native descriptor path and captured/custom prototype behavior after a
run ends. The change does not implement foreign newTarget fallback resolution
or link AggregateError errors arrays.

The Error lifetime, intrinsic-prototype, string-coercion and retained-root
accounting files pass all 85 tests, including the ten newly failing lifetime
checks and the passing legacy-mode control. Broader Error/recovery validation
passes 154 tests across ten files (overlapping the earlier focused run).
The lifetime file then passes 13 cases after adding public replay and
SuppressedError descriptor/payload controls. Scoped lint and TypeScript pass.
The maintained build passes 23 workspace builds and four fresh-process import
checks. Built-SDK probes pass all eight native-comparable Error lifetime cases
and the Promise.any errors-descriptor case. No full-package pass, push or
release is claimed.
