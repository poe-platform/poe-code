# Omitted yield operands in conditional arms

Pinned Test262 72faf8ec1445c55149615e8b35187830783aba1a, all top-level yield
fixtures after the classic-for repair: 57 runtime passes, three correct parse
rejections, two noStrict exclusions, one failure (b63f4e). The failing
rhs-omitted.js contains `(yield) ? yield : yield`; native accepts it but guest
parsing throws at the colon. An independent public-run probe reproduces the
located ParseError (83c11d).

The yield scanner's omitted-operand terminators omit the conditional colon.
Add it without permitting a missing yield-star operand or standalone colon/
question punctuation. Test native-equivalent execution for sync and async
generators, both conditional branches and nested conditionals. Preserve the
existing grammar's assignment-expression precedence and no-LineTerminator rule.

The new yield-conditional-operand tests precede implementation. Validate them,
existing generator/conditional parsing and checkpoint tests, then scoped lint/
TypeScript. Update README and the gap inventory, and commit this separately
from the classic-for repair. No visual CLI output changes or screenshots apply.
Push and release remain on hold.

## Verification

Main red: four failures and three invalid-syntax controls passing (eb30ed).
Adding the colon terminator passes 129 selected generator/parser/checkpoint
tests across five files (53dc30). Three new nested-conditional bodies exercise
repeated JSON checkpoint restoration in both sync and async modes.

The maintained workspace build completed at the preceding runtime 8c124d58b:
23 selected workspace builds and five fresh-process import checks (691234).
That build covers the Error cause and classic-for repairs, not this subsequent
colon change. Keep it separate from the current source-test evidence.
The original pinned rhs-omitted.js now passes on native and guest (a6aa1c).
The expanded nested-yield checkpoint file passes all 26 tests (e8d5d1),
including the six new sync/async conditional cases.
Scoped parser/test ESLint and package TypeScript pass (8ba707); checkpoint-test
ESLint passes (410b88). Whitespace checks pass (f2b46a). README and the current
gap inventory are updated. No push or release is authorized.
