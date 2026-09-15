# Null-only proxy schemas

Reproduced type null, const null and enum [null] converting to generic JSON schemas that accepted false, numbers, strings, arrays and objects. Preserve these constraints as null-only enums rather than advertising a broader schema.

Allow null enum literals in the DSL with static null inference; a compile-check reproduced the prior type rejection. Generate type null for null-only enums. CLI enum parsing and diagnostics accept the same null literal, preserving CLI/SDK parity without a separate schema kind.

Validation: all 27 converter tests pass, including the three null-only regressions and descriptor validation; the full schema package suite passes. Selected Toolcraft closure build passes. Remaining QA: null-only CLI/SDK/MCP execution, rendered help and diagnostics, and native object/array enum/const precision.
