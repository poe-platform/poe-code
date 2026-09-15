# Modern MCP HTTP client metadata

Part of the nine-hour MCP production-readiness goal. The MCP 2026-07-28 Streamable HTTP specification requires per-request protocol/version/method/name mirrors, no protocol sessions, and JSON-RPC protocol errors carried by HTTP error responses.

## Validated changes

Two regression tests reproduced missing required standard headers, obsolete response session IDs opening GET/DELETE traffic, and a modern HeaderMismatch error disposing the connection. The transport now derives mirrors from each modern request, encodes names with the shared headers utility, omits obsolete session/replay request headers, ignores response session IDs for modern calls, and forwards matching JSON-RPC errors to the caller while preserving the connection.

The shared headers import is bundled into tiny-mcp-client using its maintained inlined-dependency declaration; no runtime server initialization is introduced. The selected tiny-mcp-client build closure passes. Focused ESLint passes, and the complete client source suite passes 370 tests.

A client test run concurrent with dependency rebuilding returned EOF in its real-process stdio smoke test. The focused smoke recheck and subsequent client suite both pass after rebuilding completed. This does not prove the original failure's exact cause; do not parallelize builds that remove dependency dist directories with tests whose child processes import those directories.

## Remaining scope

Default modern discovery/negotiation, custom parameter header annotations, subscriptions, request-to-stream cancellation, bounded response parsing, MRTR retries, result discriminators, and client/integration declarations still require implementation and verification. This atomic transport improvement does not claim overall latest-spec compliance or production readiness. No README is changed. No push or release is performed.
