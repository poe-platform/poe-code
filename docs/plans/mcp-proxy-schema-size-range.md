# Preserve upstream schema size and range limits

Four red conversion tests showed string lengths, numeric ranges, integer ranges, and array item counts being discarded. Copy the existing supported schema metadata into converted schemas so local validation and advertised JSON Schema enforce the upstream limits consistently.

All 34 converter tests and all 69 proxy tests pass after the changes. Composition, recursive references, and additional unsupported JSON Schema keywords still require further audit; these checks do not prove arbitrary schema fidelity.
