# Await on the left of exponentiation

## Main integration

After terminal integration session 5721 and the independent yield commit
224ded2c5, main reproduces all four invalid-form failures with six valid
controls passing (89aca0). The one-condition parser fix is now applied on main.
The three non-strict contextual identifier controls are included in the
regression file, and README documents the parenthesis requirement.
Main parser verification passed 1,633 tests with one opt-in skip across 67
files (ef4630, session 61837 terminal). Targeted lint and TypeScript passed
(0e96c0, session 95451 terminal). This remains a
separate change from numeric coercion. No push or release is authorized.

## Validated defect

Native/current-main comparisons reject `await 2 ** 3` and
`await await 2 ** 3` natively but accept them in SafeJS (7d9825). Parenthesized
await operands, awaiting a parenthesized exponentiation, and await on the right
remain valid. The [ECMAScript 2026 grammar](https://tc39.es/ecma262/2026/multipage/ecmascript-language-expressions.html#sec-exp-operator)
requires UpdateExpression on the left of `**`; AwaitExpression is instead a
UnaryExpression alternative. This is distinct from the yield-precedence gap.

## Isolated repair

Candidate `/tmp/safejs-await-exponent.j1hFzG` is copied from current main and
does not include the separate yield-precedence candidate. Main runtime remains
unchanged for the live integration run 5721.

Before implementation, the new test file has four failing invalid-form cases
and six passing valid-execution controls (8c45db). Invalid cases cover async
functions and async generators, nested awaits, parentheses around only the
await operand, and a right-associative chain with an invalid inner left operand.

Extend the existing unparenthesized UnaryExpression guard to AwaitExpression.
Do not change runtime arithmetic, associativity, valid right-side await or
parenthesized forms. Candidate focused tests pass: 92 across three files
(4a3718). ESLint and TypeScript pass (6a836e); session 21523 is terminal.
The full candidate parser selection passes 1,608 tests with one opt-in skip
across 66 files (da6d6a); session 37588 is terminal.

Three native comparisons preserve non-strict await identifiers used as a local,
ordinary function parameter and arrow parameter with exponentiation (97c570).
This guard therefore does not simply reject the token spelling await.

The separate yield candidate now includes this guard for interaction testing:
117 focused tests across six files pass (3734e7), and nine mixed yield/await/**
grammar probes match native acceptance/rejection (911eb6). This await-only
candidate remains unchanged. Keep the two fixes separate at integration.

After the unchanged main integration run finishes, reproduce red on main,
apply this repair separately, verify parser checks, update README/inventory
and commit atomically. No CLI visual behavior changes or screenshots apply.
No push or release is authorized.
