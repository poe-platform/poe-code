---
title: Array species selection and remaining iterator gaps
---

# Array iteration and species gaps

Validated against the working Array-construction implementation on 2026-09-07:

- `typeof Array.prototype.values`, `keys`, `entries` and `[Symbol.iterator]`
  each return `"undefined"`; native JavaScript returns `"function"`.
- `Array[Symbol.species] === Array` returns false; native JavaScript returns true.
- `class Items extends Array {}; new Items(1,2).map(value => value) instanceof Items`
  returns false; native JavaScript returns true.
- The same native-oracle comparison fails for filter, slice, concat, flat,
  flatMap and splice. It already agrees (ordinary arrays) for toReversed,
  toSorted, toSpliced and with; preserve that distinction.
- An own `constructor` getter returning a custom species is never read by map.
  Native execution logs the constructor lookup, construction with length 2,
  then both callbacks. The custom ordinary-object result has indices but no
  length property; SafeJS incorrectly supplies an ordinary array with length 2.
  A null-species subclass already returns an ordinary array as expected, so that
  case alone would be an insufficient regression test.

These are separate remaining gaps, not claims covered by construction/factory
verification. Existing implicit array iteration and user-supplied protocol tests
do not establish that the public iterator API exists. Implement live public
iterators with correct receiver/length/property access, exhaustion, identity,
budgets and portable continuation support. Validate species selection separately
for every array-producing method that uses ArraySpeciesCreate; copy-by-change
methods must retain their specified ordinary-array behavior.

Primary reference: ECMAScript 2026 indexed collections,
https://tc39.es/ecma262/2026/multipage/indexed-collections.html.

Add failing regression tests before either implementation. Do not change the
currently tested construction code while its full package check is active.

## Species implementation

The initial regression suite reproduced nine failures with five passing controls.
All seven species-producing methods now select the receiver's constructor and
species, construct the result with the specified initial length, and define own
indexed data properties. Map/filter/flat/flatMap do not manufacture a length
property on custom objects; slice/concat/splice perform the required final Set.
Splice sets the removed object's length before mutating the source.

The intrinsic Array species getter returns its receiver, with guest function
metadata and the standard descriptor. Non-array generic receivers ignore their
constructor. Invalid species reject, configurable indexed accessors are replaced
by data properties, and frozen outputs reject. Existing property-target mapping
is reused rather than duplicating function/collection/Promise descriptor logic.

Two additional concrete flattening probes failed: depth conversion could expand
flat's source length, and mapped-element getters could expand flatMap's traversal.
Both now use captured lengths. The expanded suite has 55 passing cases including
metadata, sparse/custom results, exception order, generator argument suspension,
completed replay identity, budget limits and copy-by-change controls. A five-file
array/construction/receiver/replay cohort passed 303 tests before the final four
edge tests were added.

The public iterator gaps above remain open and are not covered by this change.

The full maintained package run passed 17,342 tests with 41 declared skips,
504 passing files and one skipped file in 228.58 seconds. The only explicit
exclusion was the separately documented native-Promise own-property import-policy
probe file. Lint and TypeScript checks passed. No matching open GitHub issue was
found for Array species.

Additional read-only probes confirm custom Map, Set, Promise, Date, RegExp and
Float32Array outputs. Generator results still hit the existing shared rejection
of generators as Object.defineProperty/Object.assign targets; that broader
object-model gap is tracked separately, not claimed fixed here.

The selected workspace build completed 23 dependency-closure builds and four
passing import smoke tests. The real harness pair passed and its screenshot was
viewed. The screenshot runner's root build completed 70 uncached tasks.
