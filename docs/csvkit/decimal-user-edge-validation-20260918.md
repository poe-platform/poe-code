# Decimal user-edge validation

This bounded user review does not qualify the complete csvkit suite.

## Reproductions and fixes

Original failing in-memory tests preceded these fixes:

- Finite division by infinity now returns signed zero at Etiny=-1000026,
  including negative divisors, zero numerators and very small finite operands.
- Decimal construction normalizes frozen Unicode decimal digits, Python edge
  whitespace and underscores, preserving scale, sign and special payloads.
- Decimal NaN/sNaN payloads enforce the 10,000-digit admission limit.
- Agate Number casting enforces its supplied digit budget before quiet NaN
  payload truncation, including the default limit.

Payload refusals are product-budget behavior, not native parity observations.

## Reference and checks

The CPython 3.14.2 executable SHA-256 matched the frozen profile:
3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae.
Its context was precision 28, ROUND_HALF_EVEN, Emin=-999999, Emax=999999,
clamp=0, with InvalidOperation, DivisionByZero and Overflow traps enabled.
This pass authenticated the interpreter only; it did not repeat source-archive
or installed Agate/SQLAlchemy manifest authentication.

All 6,000 exact finite add/multiply/divide observations matched compiled product
text or trap names. Python Random seed 20260918 generated 2,000 operand pairs:
each coefficient was sampled below 10 raised to a sampled width 1–64, with a
sampled sign and exponent -80–80. No numeric tolerances were applied.

Maintained csvkit tests passed 1,615 tests, with five explicit TODOs; workspace
lint and the selected uncached build closure passed. Independent actual Shell
regressions cover adornments, signed zero, huge-number ties, reverse/null order,
pipelines, source-file preservation and decimal admission boundaries, including
oversized quiet NaN payload refusal. Both Shell files passed all five tests;
focused safe-bash ESLint passed. No wrapper
defect was found. The compiled public Shell/plugin output and payload refusal
were rendered and inspected: numeric precision and diagnostic text were legible
without clipping. The owned temporary image was purged after inspection.

## Blockers

Typed/keyed csvjson, csvstat metrics (including sample standard deviation),
non-en_US casting and NaN ordering remain explicit command blockers. Full
context underflow/subnormal behavior, non-string Agate inputs, numeric schema
sizing, typed JSON float conversion and locale report formatting remain
unqualified. The finite arithmetic cohort does not establish those behaviors.
No full repository gate, commit, push or publication is claimed for this pass.

Procedure: ../plans/csvkit-decimal-user-edge-qa.md.
