# Boxed primitive creation-realm audit

## Evidence

Read-only built ESM probes at runtime commit `5b6d9f487` exported a value, a
factory for the same expression, its expected intrinsic prototype, and the
originating Object.getPrototypeOf. A second run exported another getter.
Both getters were called after run cleanup on the initial value and on the
factory result. Native VM controls returned true for prototype identity.

| Expression | Initial value: either getter | SDK-created value: either getter | Data copy value type |
| --- | --- | --- | --- |
| `new Number(7)` | wrong prototype | wrong prototype | number |
| `new Boolean(true)` | wrong prototype | wrong prototype | boolean |
| `new String("ab")` | wrong prototype | wrong prototype | string |
| `Object(7)` | wrong prototype | wrong prototype | number |
| `Object(true)` | wrong prototype | wrong prototype | boolean |
| `Object("ab")` | wrong prototype | wrong prototype | string |
| `Object(7n)` | wrong prototype | wrong prototype | bigint |
| `Object(Symbol.for("x"))` | wrong prototype | wrong prototype | symbol |

The copy column reports `typeof copied.valueOf()`, not the copied container
type. It confirms retained primitive data, not preserved guest behavior.

Separate probes added `marker=9` to the originating Number, Boolean, String,
BigInt, or Symbol prototype after cleanup. Reading marker through an exported
guest function returned undefined for all five initial wrappers, and data
copy accepted all five instead of rejecting the lost inherited behavior.

Nine native-backed Reflect.construct controls covered Number, String, and
Boolean with newTarget.prototype set to 7, null, or a custom object. Native
passed all nine identity checks. SafeJS retained each custom object (three
passes), but lost all six intrinsic fallback identities after cleanup.

## Code paths to address

- `globals/primitives.ts`: the Number/String/Boolean allocation helper calls
  finish(undefined) for normal construction, recording no default link.
  Its derived-construction path also omits a default when the selected
  newTarget prototype is primitive.
- `globals/object.ts`: primitive Object(value) wrapping does not record a
  boxed prototype. The recent null/undefined Object constructor fix does not
  cover this branch.
- `object-model.ts`: releaseObjectPrototype deletes the weak budget-keyed
  boxed prototype lookup. Live exported constructors need an originating
  default for new wrappers and pristine-default data-copy classification.

## Required regression coverage

Reproduce the cases above in source tests before changing implementation.
Check native newTarget prototype fallback, custom prototype preservation,
primitive payloads including NaN and negative zero, immutable String indices,
later prototype mutation, and lossy-copy rejection. Test constructor calls
without new remain primitive. Keep Symbol and BigInt non-constructible.
Run existing boxed/subclass/reflection/coercion/snapshot checks; do not infer
that host-imported wrappers or every transient boxing path are covered.

## Gate coordination

No runtime or test files changed during this audit. A fresh full package gate
is running against the accumulated realm changes. Its source/test SHA-256 at
start is `a47a868812f236eee721cb0ce9f4ec356d0853080951a1dbb80045493086da2c`.
Recheck that hash at completion. This audit is evidence for follow-up fixes,
not a claim that boxing or JavaScript conformance is complete.

## Implementation in progress after the gate

The source tests reproduced 13 failures. The initial changes record the
captured default in primitive constructors, resolve boxed defaults in
Object(value), and preserve the weak boxed-prototype lookup after cleanup.
Sixteen identity/payload/mutation/newTarget tests pass. Symbol payload tests
check type and description rather than assuming host and guest registries
share symbol identity. Failed object-identity assertions use booleans to
avoid pretty-format invoking guest wrapper methods while formatting failures.

An existing cleanup test now fails at dataSize 1,681 > 1,500. Built probes
with Number.prototype.extra of length 0, 350, and 700 show peaks 281, 981,
and 1,681; repeating realm creation three times does not increase those
peaks. Two new tests require a 350-character mutation to add 350 rather than
700 to the measured peak. They currently fail.

Moving wrapper allocation charging before prototype attachment did not fix
the failures; that experimental ordering change was removed. Investigate
the overlap between trackIntrinsicState's projected mutation roots and
measureSandboxData following the same intrinsic through an explicit wrapper
prototype link. Do not simply increase the cleanup-test budget, remove its
assertion, or weaken custom-prototype accounting. No implementation commit
is complete yet; broader validation is still in progress.

## Accounting implementation follow-up

Added accounting-only projection records with an owner identity. Measurement
traverses projected object/symbol references immediately and defers primitive
projection data until normal and weak graph traversal finishes. If the owner
was traversed, its projected primitive slots are not charged a second time.
Only boxed targets use these records: other intrinsic kinds can omit baseline
metadata during direct traversal, so their existing raw projections remain.
Six isolated ownership/order/distinct-owner tests failed before implementation
and now pass. The original 1,500-unit cleanup test passes when wrapper
allocation charges its fresh payload before attaching the prototype as well.

Whole-run unbounded peak comparisons remain unsuitable for asserting exact
live graph size: changing allocation charge order and graph capture phases
changes where the maximum occurs. Replaced those new assertions with direct
measurement of live retained roots while a realm keeps the wrapper binding.
The two 350-to-700-character controls now add exactly 350 measured units.
The public realm data-copy boundary correctly rejects returning a wrapper
with mutated guest behavior; the controls therefore return its primitive
payload and keep the wrapper in the realm's scope.

An intermediate broad run saw raw-projection shape assertions fail for
non-boxed intrinsic records. The boxed-only condition restores those paths;
their existing tests are not changed. A fresh broad run and maintained build
are in progress. Pre-existing weak-collection edits in values.ts must remain
separate from the local boxing/accounting commit.

## Final focused verification

The boxed-only projection implementation passed the fresh broad selection:
2,184 tests across 155 files, including the original cleanup budget, snapshot,
subclass, primitive, and retention cases. This includes 20 new boxing cases
and six accounting projection cases. Scoped ESLint, 23 maintained workspace
builds, and four fresh-process import checks passed. Built ESM smoke checks
confirm post-cleanup construction identity and pristine copying for Number,
String, Boolean, boxed BigInt, and boxed Symbol.

The new measurements compare live retained graphs, not unconstrained peak
estimates. No existing budget-test expectations were increased. Non-boxed
intrinsic projection behavior remains unchanged. A fresh package-wide gate
after this accounting change is still needed; the previous full-gate record
predates this implementation. No push or release.
