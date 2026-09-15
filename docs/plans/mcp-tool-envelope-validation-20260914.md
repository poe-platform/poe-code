# MCP tool envelope validation

Part of the nine-hour MCP production-readiness audit. Tool input schemas must have an object root, and arguments must be an object independently of optional per-schema validation.

Six regression tests reproduced valid non-object input schemas being registered and malformed argument containers being accepted, including null becoming an empty object. Disabling validateToolArguments also allowed arrays and primitives through to a handler.

The server now rejects non-object input roots after schema compilation and validates argument container shape before header/schema validation or handler execution. Compiling first preserves existing malformed-schema diagnostics. Optional validation continues to control schema constraints only.

The focused regression suite passes all six tests. Current core/client/HTTP verification passes 1742 tests. Selected HTTP server build closure and focused ESLint pass. This commit stages only the input-root and argument-envelope guards in server.ts; the broader modern protocol migration remains uncommitted. No README change, push, or release is included.
