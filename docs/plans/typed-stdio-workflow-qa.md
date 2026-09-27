# Modern typed stdio workflow QA

The in-memory MCP SDK workflow remains a unit check. Execute native Node/stdio process startup separately.

1. Build tiny-stdio-mcp-server and tiny-mcp-client through maintained workspace build routes.
2. Launch a Node ESM server using the built tiny-stdio entry. Register lookup with an input id string and output object containing required id/displayName strings with no additional properties; return Alice for that id. Register bad_output returning a numeric id against the same output schema, and scalar_envelope returning empty content and scalar structuredContent.
3. Connect McpClient through StdioTransport, pinning protocolVersion to 2026-07-28. Verify that version is negotiated.
4. Verify listTools advertises the exact lookup output schema. Calling lookup with u1 must return the matching object in structuredContent and its JSON text in content.
5. Verify bad_output rejects with code -32603, an Invalid structured tool result diagnostic, and a type-keyword validation detail.
6. Verify scalar_envelope returns empty content, the scalar structuredContent, and resultType complete.
7. Close the client and its child process even on failure. Keep evidence under `out`, inspect it, then remove only that evidence.
