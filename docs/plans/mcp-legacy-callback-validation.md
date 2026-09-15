# Legacy MCP client callback validation

Three failing checks reproduced malformed sampling request parameters reaching callbacks, malformed sampling results being sent, and non-file root URIs being accepted. Validate known client input methods before dispatch and their standard result types before output. Preserve intentional McpError codes when mapping callback errors. Keep generic custom RPC handlers working without imposing MCP schemas on unknown methods.

The required root URI file:// semantics are checked in shared protocol validation, covering both modern MRTR and legacy callbacks. Nineteen focused callback/modern/JSON checks pass. Full client compatibility validation remains required. A configured legacy elicitation callback is advertised but not registered; added a focused regression for this API mismatch.
