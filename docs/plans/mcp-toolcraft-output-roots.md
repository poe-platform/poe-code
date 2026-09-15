# Toolcraft MCP output roots

Support scalar and array result schemas in command definitions and imported MCP tools. MCP 2026 permits any JSON structured result; legacy descriptors require object output schemas.

Reproduced four rejected proxy output descriptors and four rejected modern command outputs. After broadening result schema definitions, reproduced four legacy result envelopes becoming tool errors. Normalize declared non-object results through modern JSON validation before removing unsupported legacy structured content. Preserve text, metadata and error flags.

Reproduced two legacy root arrays outside their declared minItems/maxItems bounds being returned successfully. Apply array constraints during output serialization, including nested arrays.

Verify modern and legacy descriptors, results and invalid arrays; run existing output contract and proxy tests, Toolcraft workspace lint and build, and public type contracts. Mapper type parity and additional imported-schema precision remain separate audit work.
