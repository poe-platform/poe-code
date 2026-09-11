# Guest __proto__ accessor

Validate missing Object.prototype.__proto__ against ECMA-262 20.1.3.8 and native
Node. Cover getter boxing, setter validation order, ignored primitive prototypes,
null links, cycle/non-extensibility/immutable-prototype errors, descriptor metadata,
own data-property shadowing, snapshots, and guest-only function prototype access.

Use guest accessor adapters and the existing prototype operations. Do not expose
native Object/Function prototypes or weaken live-host-object boundaries. Run
focused prototype and security regressions, lint, maintained build, and Node
18/24 built checks before its own commit and push.

## Verification

Sixteen of 23 new tests failed before implementation. All 23 now pass through
guest accessor adapters. One historical boundary test expected Array.__proto__
to be absent; it now requires identity with Object.getPrototypeOf(Array) while
also checking that the guest prototype exposes neither native constructors nor
internal kind/properties fields. No native prototype is linked or mutated.

Eight focused files pass 222 tests. The full snapshot directory plus Object
alias and host-function checks pass 1,523 tests in 93 files. Focused lint and
the maintained 23-workspace build with four fresh imports pass. Built Node
18.18.0 and Node 24.14.0 each pass 27 native comparisons across nine receiver
types and object, null, and ignored primitive prototype arguments. No matching
open GitHub issue was found.
