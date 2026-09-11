# Numeric operator coercion order

## Main integration

After the separate yield and await commits, main reproduces 44 failures and
six passing controls in the expanded regression file (9d24d3). Both runtime
guards and the sync/async checkpoint regressions are now applied on main.
README documents the observable boundary. Main focused tests passed all 225
cases across six files (d7d7b8, session 52597 terminal). Lint/TypeScript checks
passed (16f834, session 66863 terminal). The maintained selected-workspace build
passed all 23 build tasks and five fresh-process import checks (7648e6,
session 45473 terminal).

## Validated defect

Native JavaScript stops before right-side primitive conversion when the left
operand converts to a Symbol for numeric binary operators. SafeJS instead calls
the right conversion hook, exposing effects and potentially throwing the wrong
error. All eleven numeric binary operators and their compound assignments fail
the regression: 22 failures, with six addition/relational controls passing.
Right-hand expression evaluation correctly precedes either coercion and must
remain unchanged.

## Isolated repair

Candidate: `/tmp/safejs-numeric-order.I8YiUN`, based on main runtime `dfa158292`.
Main runtime/test files remain unchanged while integration session 5721 runs.

After left primitive conversion, reject Symbols before right primitive
conversion for numeric-only operations. Symbol is the only primitive with an
abrupt ToNumeric conversion; deferring the other primitive numeric conversions
preserves existing operand retention and has no guest-observable effects.
Do not change addition or relational conversion order. Mixed BigInt/Number
operands must both be converted before the numeric-type mismatch is rejected.

## Verification

- Initial regressions: 22 failed, 6 passed.
- Repair plus boxed-boundary tests: 76 passed across two files.
- Expanded regression file: 50 passed, including primitive Symbols and mixed
  BigInt/Number controls for every numeric operator and compound assignment.
- Broader numeric/retention selection: 155 passed across five files.
- Native/candidate operator matrix: all 6,480 comparisons agree (0d80a1).
  The 20 operators cover arithmetic, shifts, bitwise, loose/strict equality,
  and relational comparison. Each tests the Cartesian product of 18 values:
  undefined, null, booleans, zero/negative zero, one/negative one, NaN,
  Infinity, empty/numeric/invalid strings, zero/two BigInts, a Symbol,
  and objects converting to a number or Symbol. Results encode type, negative
  zero, NaN and exception names explicitly. This is value/error coverage,
  not an exhaustive side-effect or JavaScript-conformance proof.
- Observable-order matrix: all 1,152 comparisons agree (064143). For 20
  binary and 12 compound-assignment operators, compare every pair of objects
  whose Symbol.toPrimitive returns a Symbol, BigInt, number, string, invalid
  object, or throws RangeError. Record property get/set, RHS evaluation,
  coercion side and hint, result type/value, and exception name. In particular,
  assignments do not invoke their setter after an abrupt conversion.
- Targeted lint and package TypeScript checks passed.
- The original Test262 `language/expressions/exponentiation/order-of-evaluation.js`
  at revision `72faf8ec1445c55149615e8b35187830783aba1a` passes in native Node
  and the isolated candidate with the pinned `sta.js` and `assert.js` harnesses
  in matched strict function wrappers. This covers all six evaluation/coercion
  stages in the upstream fixture, not only the reduced Symbol case.
- Added 44 sync/async generator checkpoint cases (all numeric binary and
  compound operators) to the existing repeated JSON-restore test. Initial
  fixture failures were missing Symbol built-ins in low-level `interpret`,
  not a runtime defect; the fixture now installs Symbol and Error using the
  existing snapshot-test convention. Corrected run passed all 70 tests (ec3432).
  The expanded checkpoint fixture also passed targeted ESLint and package
  TypeScript checks (1a21ae).
- The combined yield/await parser candidate at
  `/tmp/safejs-yield-precedence.6NFVXR` also now includes the numeric runtime fix
  and its 50-test regression file. Combined parser/numeric qualification passed
  1,785 tests with one opt-in skip across 72 files (07edd0, session 73957 terminal).
  Its checkpoint test file has not been updated;
  checkpoint qualification above belongs to the numeric-only candidate.
- No visual CLI changes; screenshots are not applicable.

## Delivery

Integrated on main after the previous package run became terminal; local
commit awaits the checks recorded above. No push or release during the hold.
Include all three newly integrated fixes in the next maintained package gate.
