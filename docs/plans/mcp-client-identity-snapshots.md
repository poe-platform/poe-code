# MCP client identity ownership

Modern and legacy in-memory negotiation tests reproduced mutation of the client's retained server identity through its public getter. Nested icon metadata also remained shared with connect results.

Clone retained legacy identities, modern connect identities, and public getter snapshots so caller edits cannot alter established connection metadata. Cover both negotiation paths and nested icon mutations without network or file fixtures.

Validation evidence: /tmp/mcp-identity-ownership-red.log and /tmp/mcp-identity-ownership-green.log. Include the full protocol gate and maintained client build in final validation.
