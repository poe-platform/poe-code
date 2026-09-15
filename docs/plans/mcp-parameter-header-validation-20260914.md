# MCP parameter header validation

Part of the nine-hour MCP production-readiness audit. The authoritative MCP 2026-07-28 Streamable HTTP specification requires mirrored standard headers and x-mcp-header annotations on statically reachable primitive parameters.

## Scope

Provide a focused shared headers module in tiny-stdio-mcp-server, exported through the headers subpath. HTTP transport and the modern client will consume the same encoding and annotation rules. This adds no dependency and does not initialize or run a server when imported. The utility can be committed independently; transport/client migration remains separate work.

## Invariants

- Round trip UTF-8 values, including a leading BOM, without silently changing the source value.
- Base64 encode unsafe ASCII, non-ASCII, edge whitespace, and literal sentinel patterns. Accept interior horizontal tabs as permitted by HTTP field-value syntax.
- Reject malformed Base64, invalid UTF-8, duplicate header values, unsafe integer values, and unpaired Unicode surrogates.
- Validate HTTP token annotation names and case-insensitive uniqueness.
- Resolve annotations only through exact properties paths; reject annotations under arrays, schema composition, conditionals, references/definition maps, or other dynamic schema paths.
- Ignore literal default data and inherited argument values.
- Bound schema traversal to 10000 nodes and depth 64, detect cycles, and snapshot descriptor paths.
- Omit absent values, reject a recognized header supplied without its argument, and ignore unknown extension headers.

## Evidence

Tests were written before the module implementation. The focused headers test suite passes 52 tests in 8 ms. Selected tiny-stdio-mcp-server and tiny-http-mcp-server workspace build closures pass. Core/HTTP integration currently passes 1356 tests, including missing, mismatched, and Unicode nested parameter headers rejected before execution. Those integrations are still uncommitted migration work and do not prove modern client support or overall MCP compliance.

Focused ESLint is required before the utility commit. No README is modified; documentation additions require the user's permission under AGENTS.md. No push or release is authorized by this task.
