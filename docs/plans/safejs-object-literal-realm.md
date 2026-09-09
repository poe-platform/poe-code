# Object literal realm lifetime

## Evidence and change

Five native-backed SDK regressions failed before implementation: empty,
populated, spread, and primitive-__proto__ literals lost their originating
prototype after run cleanup; later Object.prototype mutations were invisible.
The explicit-null prototype control already passed.

Fresh object literals now store their originating prototype when one exists.
Restored generator expression objects keep their saved links, and explicit
literal prototype setters still override the default. The weak budget-keyed
Object prototype lookup survives cleanup for live exported factories, while
accounting roots are released as before.

The six focused tests pass after the change. Object-model, prototype, and
retention selection passed 1,308 tests across 65 files. Snapshot/generator
selection passed 1,852 tests and failed one fixed-budget assertion across 133
files. That assertion capped a coercion literal at 500 units. A built SDK
probe measured peaks 524, 824, and 1,124 with extra roots of 0, 300, and 600
characters: exactly one added charge per root. The test now measures its
same-source baseline and asserts the exact baseline-plus-300 limit, plus
rejection at one unit below that limit, instead of a fixed 500-unit cap.
The exact-boundary test is limited to that coercion source. An attempted
extension to anonymous arrow calls measured a 301-unit constrained peak versus
302 from unconstrained-baseline addition, so those other closure tests retain
their existing bounds. No accounting runtime change was made. The final
literal and retained-root selection passes all 17 tests across two files.

Scoped lint, package TypeScript, 23 maintained workspace builds, four import
checks, and a built ESM literal identity/data-copy smoke check passed.
Pristine data copies must remain accepted; copying a modified prototype chain
must reject rather than drop behavior. No visual CLI change or release.

## Remaining creation paths

A built native-ESM SDK probe after this change compared an exported factory's
result through a different run's Object.getPrototypeOf. Native VM controls
returned true for originating prototype identity in all five cases. SafeJS
returned true for `({})`, but false for `new Object()`,
`Object.fromEntries([["a",7]])`, destructuring rest from `{a:1,b:7}`, and
`new String("ab")`. These are validated follow-up gaps, not covered by this
literal-only change. Host-imported record behavior remains unaudited here.
