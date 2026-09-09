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
