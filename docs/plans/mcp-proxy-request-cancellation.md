# MCP proxy request cancellation

Three focused failing checks reproduced dropping an active handler signal, connecting despite a pre-aborted request, and invoking the upstream tool after cancellation during connection. Check cancellation before and after connection and forward the same signal through callTool. Shared connection setup remains reusable by other callers; a cancelled call must not cancel their connection.

A fourth red check left shared connection setup unresolved and proved the cancelled handler remained pending. The handler now rejects promptly on abort while retaining shared connection setup for other callers and removes its abort listener. All 69 in-memory proxy tests pass; consumer types/lint/build remain to be completed after the final changes.
