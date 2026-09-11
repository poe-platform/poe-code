# Yield assignment-expression precedence

## Main integration

Integration session 5721 is terminal. Main reproduced eight invalid-form
failures with fourteen valid/contextual controls passing (f770cd). The yield
block relocation is now applied on main without the independent await guard
or numeric runtime fix. README documents the precedence boundary. Main parser
and nested-yield checkpoint verification passed 1,646 tests with one opt-in
skip across 67 files (e9c664, session 98806 terminal). Targeted lint and
TypeScript checks passed (f07842, session 2525 terminal). Ready for a local
atomic commit; push and release remain on hold.

## Validated gap

A native/current-main comparison (463ded) shows SafeJS accepts invalid
unparenthesized yield operands: `1 + yield 2`, `!yield 2`, `typeof yield 2`,
`yield 1 + yield 2` and `true && yield 2`. Eight valid controls agree.
The [assignment grammar](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-assignment-operators)
places YieldExpression at AssignmentExpression, not UnaryExpression.

## Isolated implementation

Main's integration session 5721 remains active; do not edit its runtime or
test sources until terminal. The candidate is in
`/tmp/safejs-yield-precedence.6NFVXR`, copied from current main.

Candidate red: eight invalid-form failures and eight valid controls pass
(1468a8). Tests cover sync and async generator parsing. Move the existing
yield parsing block from parseUnaryExpression to parseAssignmentExpression,
leaving operand parsing, delegation, newline checks and omitted-operand
terminators unchanged. No new AST fields or runtime semantics are introduced.
The first focused selection passes 105 tests across four files (9271a9).

Broader candidate parser/checkpoint tests passed: 1,660 tests, one opt-in skip
across 68 files (49f3e4); session 91994 is terminal. Candidate ESLint and
TypeScript passed (b3035a); session 38920 is terminal. Inspect terminal results before
integrating. Main remains unchanged, and the candidate is not a committed or
delivered repair. Preserve contextual non-strict yield identifiers and all
valid parenthesized yield forms. Further checks must qualify those boundaries.

Six native comparisons preserve non-strict yield identifiers in arithmetic,
unary expressions, formal parameters, calls, typeof and prefix updates (8c7827).
These controls are now added to the isolated regression file. Main remains
unchanged while integration session 5721 is confirmed live (ddb3e8).
The expanded isolated regression file passes all 22 tests (368daf).

## Combined candidate qualification

The candidate additionally contains the numeric-coercion-order runtime fix and
its regression file as of the combined parser/numeric run in session 73957.
That run passed 1,785 tests with one opt-in skip across 72 files (07edd0).
Do not copy its runtime into either parser commit; keep all three improvements
atomic. See `safejs-numeric-coercion-order.md` for that independent repair.

The yield candidate now also includes the independent await-exponentiation
guard and its tests; it must not be copied wholesale into the first atomic
commit. The await-only candidate remains separate. The combined selection
passes 117 tests across six files (3734e7). Nine async-generator grammar probes
mixing yield, await, parentheses and exponentiation match native acceptance/
rejection (911eb6), including await(yield), yield(await), and forbidden bare
yield operands. Integrate the yield relocation and await guard as separate
improvements with their respective tests and documentation.

After validation and the main integration run's termination, reproduce the red
tests on main, apply only the candidate repair, verify, update README/inventory
and commit atomically. This parser-only change has no visual CLI impact and
needs no screenshot. Push and release remain on hold.
