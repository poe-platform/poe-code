# Numeric parser identity and metadata

A built-runtime probe (30cd3e) evaluated
`[Number.parseInt===parseInt,Number.parseFloat===parseFloat,parseInt.length,parseFloat.length]`.
Native Node 22 returned `[true,true,2,1]`; SafeJS returned `[false,false,0,0]`.

Published ECMAScript 2026 assigns the same intrinsic parser functions to
[Number.parseFloat](https://tc39.es/ecma262/2026/multipage/numbers-and-dates.html#sec-number.parsefloat)
and [Number.parseInt](https://tc39.es/ecma262/2026/multipage/numbers-and-dates.html#sec-number.parseint)
as the global bindings. The current Object/Number and miscellaneous-global
factories call `createNumericParsers` separately. Both returned closures also
omit their declared lengths.

Before changing implementation, add tests for initial identity, property
mutation through either alias, independence after rebinding a global name,
declared lengths and bound lengths, fresh realms, budget reuse, and replay.
Create one pair per realm and share it during global construction. Avoid a
budget-keyed cache that could return old functions when a budget starts another
realm. Keep parser coercion, execution budgets and host authority unchanged.

This work is separate from the general static-method length audit and the
constructor-prototype descriptor repair.

## Implementation and verification

The first regression run (47636) reproduced ten failures with two passing
global-rebinding controls. The implementation now creates a parser pair during
builtin binding construction and supplies it to both factories. Standalone
factory callers retain their existing default construction. Parser lengths are
declared as two and one, respectively; coercion behavior is unchanged.

The initial twelve regression cases passed (92629). Added budget-reuse controls
verify distinct exported functions and fresh properties across successive runs.
The combined selection passed 173 tests in five files (57488): parser identity,
numeric parsing and predicates, intrinsic snapshot mutations, and intrinsic
context budget reuse. Identity and property-sharing cases also check completed
public dump/replay against native results.

The isolated candidate is based on `7f3af9922`, with staged tree
`5ffe31763ec63f22d5dd0192c8e4210dfc09d536`. It excludes pending intrinsic-parent
and weak-reference edits. All 1,279 tracked SafeJS source blobs matched the
private index before and after verification. The initial test attempt (73587)
could not load 133 suites because generated Intl data was absent from the fresh
checkout; its 24 passing tests do not count as validation of this change.

The maintained selected workspace build (71492) generated the data and passed
23 tasks plus four native ESM import checks. The subsequent isolated selection
(95393) passed all 1,896 tests across 134 files: the complete snapshot directory
plus parser identity, parsing, predicates and intrinsic-context budget reuse.
The built CLI screenshot (17289) was visually reviewed and reports shared
identities with lengths two and one. Scoped lint passed for all five changed
source/test files (7338).
No push or release is authorized during the release hold.
