# Promise result realms and AggregateError descriptors

## Evidence boundary

Native Node VM and built SafeJS probes were run against local commit
`52d8ad42b`. The full package suite is running with source/test digest
`c31f51cabe7178d2dbc7770911e0fd10410402bc04eb4c6101fae47956dac7d8`.
Source and tests remain unchanged while that run executes. These are
reproductions and implementation requirements, not completed fixes.

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
