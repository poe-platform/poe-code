# Foreign constructor realm audit

## Validated baseline

Runtime baseline: `962c556d2`, with existing unrelated worktree changes preserved.
The regression matrix in
`packages/safe-js/src/interp/globals/foreign-newtarget-default.test.ts`
compares separate Node VM realms with separate SafeJS runs after their cleanup.

It covers Error, TypeError, Number, String, Boolean, Object, Array, Date,
RegExp, Map, and Set. Each constructor is tested with an ordinary function,
a bound function, and a bound class as foreign `newTarget`. Each target has
its visible function prototype chain replaced with null. Its own `prototype`
property is a number, null, or an explicit custom object.

The initial expanded run produced 66 failing fallback assertions and 33
passing custom-object controls. Native prototype identity assertions passed
before each corresponding SafeJS assertion. These are 66 manifestations of
a shared realm-selection gap, not 66 independent bugs.

## Implementation findings

- `registerClosureOrigin` records syntax, scope, and function environment,
  but does not record an immutable originating realm.
- Intrinsic identities are installation-path based. The per-budget identity
  table is deleted on cleanup; reverse object identities survive.
- Bound functions already retain their target in `boundFunctionStates`.
- Proxy state already retains its target and tracks revocation. A realm
  lookup must use that internal state, not invoke a guest-visible trap.
- Class constructors have a separate creation path in `classes.ts`; recording
  only ordinary closure origins would miss them.
- Error construction currently uses the invoked constructor's budget to
  select the default prototype, even when `newTarget` is foreign.

The specification's [GetFunctionRealm algorithm](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-getfunctionrealm)
uses internal realm information, follows bound-function targets, and validates
and follows proxy targets. A function's mutable visible prototype chain is
not a substitute for this information.

## Remaining work

Implement shared function-realm tracking and intrinsic default lookup, then
apply it to constructor allocation sites. Keep explicit object prototypes
unchanged and preserve the ordering of the `prototype` property read.

Before claiming completion, cover intrinsic newTargets, ordinary classes,
proxy targets and revocation, mutated globals, public snapshot/replay, and
retained-data accounting. The current matrix does not cover those cases.
Realm metadata must survive exported-function use after cleanup without
retaining released accounting roots or dropping reachable guest mutations
from budget accounting. Do not infer realms from names or global bindings.

## Implementation candidate

`function-realm.ts` now records originating budgets for interpreted functions,
class constructors, and installed intrinsic functions. A separate weak-keyed
prototype registry preserves intrinsic defaults after the snapshot identity
lookup table is released. Bound functions and Proxies resolve their internal
targets; revoked proxies throw. Unknown host closures keep the caller fallback.

Error, primitive wrapper, Object, Array, Date, RegExp, Map and Set constructor
paths use this lookup only when the selected prototype is not an object.
No guest-visible prototype chain or global name lookup determines the realm.

The original 99-case matrix and 11 retained-root accounting tests pass.
Adding three public-replay cases (including replaced TypeError global bindings
and targets created by exported factories after cleanup) yielded 192 passing
tests across seven focused files. TypeScript and scoped lint passed at that
candidate. Additional Proxy tests, the snapshot suite and workspace build are
being checked separately; these results do not claim full conformance.

Other constructor families and ordinary interpreted constructor allocation
still need the same audit and integration. The earlier remaining-work list is
the full scope, not a claim that every item is covered by this candidate.

No push, release, or issue closure is represented by this audit.

Final candidate verification: 151 tests passed across the expanded constructor
matrix, realm metadata tests, and intrinsic-identity tests. This includes 33
additional Proxy-target cases and overlaps the earlier 192-test run. All 1,700
snapshot tests in 127 files passed. The maintained workspace closure built 23
workspaces and passed four fresh-process import checks. Eight built-SDK probes
passed for foreign bound-class targets. Scoped lint and TypeScript passed;
the two newly added test files also passed scoped lint. No full package gate
was run for this candidate.

The separate `ordinary-constructor-realm.test.ts` audit then reproduced four
failures for ordinary function/class constructors with primitive or null
newTarget prototypes; its two custom-object controls passed. That follow-up
test is not part of the built-in constructor fix or the snapshot test count.

## Ordinary constructor follow-up

After `f9f7b1ce4`, the four ordinary-function/class fallback failures were fixed
in `async.ts` and `classes.ts`. Both allocation paths now select the foreign
newTarget's Object intrinsic for non-object prototype properties. Explicit
object prototypes remain unchanged; low-level environments without an
installed Object prototype keep their prior fallback behavior.

The expanded test matrix covers ordinary functions, base classes, implicit
derived constructors, explicit `super()` with fields, and ordinary/bound/Proxy
newTargets. Replay tests restore both sides independently and replace the
target realm's Object global binding. All 210 tests passed across seven
constructor, class, bound-function, accounting, and snapshot files. These
focused results do not replace the earlier full snapshot gate, which predates
this follow-up.

Scoped lint and TypeScript passed. The maintained workspace closure built 23
workspaces and passed four fresh-process import checks. A subsequent buffer
audit (`buffer-foreign-newtarget.test.ts`, not part of this fix) reproduced 10
fallback failures for ArrayBuffer, DataView, Uint8Array, Float32Array, and
BigInt64Array; five explicit custom-prototype controls passed.
Four built-SDK probes also passed for ordinary functions, base classes, and
both derived-constructor forms, checking foreign prototype identity and fields.

## Buffer and typed-array follow-up

After `9a8ad4fd9`, ArrayBuffer, DataView and the shared numeric typed-array
constructor now use the function-realm lookup for primitive/null newTarget
prototype properties. Buffer and DataView select and retain the fallback
before allocation; the shared typed-array path retains it through each input
overload. Explicit custom-object prototypes remain unchanged.

The original 10 failures turned green. An expanded native differential matrix
covers ArrayBuffer, DataView and all 11 typed-array constructors available in
the host VM. Separate replay cases include Float16Array (not available in this
host VM), bound-class targets and replaced constructor global bindings.
These Float16Array checks verify SafeJS identity and replay, not a native VM
differential. In total, 225 tests passed across nine focused buffer, typed-array,
SDK and snapshot files. Scoped lint and TypeScript passed. No full package or
full snapshot gate has been run for this follow-up.

The maintained workspace closure built 23 workspaces and passed four
fresh-process import checks. Six built-SDK probes passed for ArrayBuffer,
DataView, Uint8Array, Float32Array, BigInt64Array and Float16Array with foreign
bound-class targets. The separate `intl-foreign-newtarget.test.ts` audit then
reproduced 18 default-prototype failures across nine Intl constructors, with
nine passing explicit custom-prototype controls. That audit is not included
in the buffer fix or its passing test count.

## Intl follow-up

After `83a8f3da8`, the nine-constructor native differential reproduced 18
fallback failures and nine passing explicit-prototype controls. Three replay
cases added failures for NumberFormat, Locale and DurationFormat. DurationFormat
is not available in the host VM; its test checks SafeJS realm identity and
replay rather than native differential behavior.

Intrinsic registration now preserves namespace-qualified installation paths
such as `Intl.NumberFormat` instead of registering only top-level prototype
paths. All ten Intl constructor implementations select the default immediately
after reading newTarget.prototype, before locale/options conversion, and retain
it throughout initialization. Registration remains based on trusted installation
paths, not guest-visible names or mutable global bindings.

All 471 tests passed across 15 focused Intl, realm, identity and accounting
files. This includes revoked-Proxy ordering and namespace isolation checks.
The maintained workspace closure built 23 workspaces and passed four fresh
import checks; ten built-SDK Intl probes passed. The first concurrent standalone
TypeScript check raced dependency dist rebuilding (tiny-mcp-client declarations
were temporarily absent); the standalone TypeScript rerun passed after the
successful workspace build, and scoped lint passed. All 1,700 tests in the
127-file snapshot suite passed at this candidate.

A separate dynamic Function constructor audit produced eight fallback failures
across ordinary, async, generator and async-generator constructors, with four
passing explicit-object prototype controls. That test is not part of the Intl
fix or its passing test count.
