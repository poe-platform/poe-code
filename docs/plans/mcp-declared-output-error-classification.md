# Declared MCP output error classification

Malformed declared structured results must report an internal JSON-RPC error rather than a tool execution failure. Reproduced with undefined and BigInt array elements: both returned `isError: true` instead of error code -32603.

Preserve the existing tool-error behavior for undeclared malformed results. Classify a malformed result envelope with a declared output schema as an internal protocol error.

Validation: eight core structured-content cases pass; all 128 Toolcraft output contract cases pass after rebuilding its workspace dependency closure. Selected workspace build and repository type contracts pass.
