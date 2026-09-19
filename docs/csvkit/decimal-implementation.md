# Decimal implementation boundary

The TypeScript ESM Decimal model in packages/csvkit/src/types/decimal.ts uses
BigInt coefficients, a separate sign and a bounded integer exponent. Parsing
retains scale and signed zero; arithmetic applies precision 28 with half-even
rounding. Addition, multiplication, division, ordering and normalization have
original fast in-memory regressions. Table Number casting now uses this model
for its finite context multiplication and preserves the existing NaN casting
fixtures. The public domain export exposes the same model.

Normalization is separate from precision-preserving text. Typed JSON conversion
and locale statistics formatting are not implemented by this change. Existing
string-based sorting remains independently tested for unsafe integer ordering.

This is a bounded implementation milestone, not full csvkit 2.2.0 qualification.
The bounded user-edge measurements in decimal-user-edge-validation-20260918.md
cover 6,000 finite arithmetic observations; broader qualification is outstanding.
Exponent admission is bounded to 10,000 on parse and 20,000 after arithmetic;
full CPython underflow/subnormal behavior is not implemented. Finite division by
infinity now returns signed zero at the frozen context Etiny (-1000026).
Invalid-operation, zero-division and overflow
traps are domain errors; their command-level reference diagnostics are not yet
qualified. Non-string Agate inputs, further locales, typed JSON, numeric schema
sizing and sample standard deviation remain blockers. The five existing encoding
TODOs remain unimplemented and are not counted as passing observations.

Procedure: docs/plans/csvkit-decimal-qa.md. Independent safe-bash source-derived
numeric stress covers half-even rounding, carry, signed zero, adjacent unsafe
integers and stable equivalent-number ordering. Mixed temporal/Text inference
and NaN command ordering remain existing explicit blockers.
