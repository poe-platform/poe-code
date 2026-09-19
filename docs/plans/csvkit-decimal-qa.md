# Decimal arithmetic QA

Run original in-memory regressions before adding arithmetic or representation behavior.
Use the maintained csvkit workspace test/lint/build closure and independently run
safe-bash numeric command stress tests. Do not count TODO cases as passes.

Before qualification, authenticate the frozen interpreter, csvkit source digest,
Agate closure and decimal context from docs/csvkit/reference-profile.json.
Capture native reference cases separately in out, never in canonical tests.
Compare exact output/status/diagnostics for casting, arithmetic, key normalization,
CSV text, typed JSON and statistics. Purge temporary evidence after reducing it.

Exercise unsafe integers, half-even ties with sticky remainders, carry, signed zero,
precision/scale, quiet/signaling NaNs and payloads, infinities, zero division,
exponent bounds and context traps. Establish operation-specific tolerances only
after inspecting and measuring the actual reference statistics algorithms.

Remaining qualification requires locale stripping, int/bool/float source inputs,
full context underflow/subnormal behavior, sample standard deviation, schema
sizing, typed JSON float conversion and locale-formatted csvstat text. These
remain blockers until measured and implemented. No release/commit is authorized.
