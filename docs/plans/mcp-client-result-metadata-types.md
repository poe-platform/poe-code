# Public MCP result metadata

The maintained client returns validated wire results, including modern resultType, metadata, freshness, and cache scope. Its public TypeScript return declarations omitted those fields. A compile contract reproduced six missing-property diagnostics across list, resource read, prompt, tool, and completion APIs.

Expose shared ResultMetadata and CacheableResultMetadata interfaces and use them in the existing result declarations. Fields remain optional because these APIs also support legacy results, and MRTR responses are resolved internally before returning a complete result.

Validate the compile contract with the client TypeScript program and maintained dependency/build route. Runtime behavior is unchanged. Red evidence: /tmp/mcp-result-metadata-types-red.log. Green evidence: /tmp/mcp-result-metadata-types-green.log.
