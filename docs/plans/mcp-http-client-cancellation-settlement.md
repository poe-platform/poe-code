# HTTP client cancellation settlement

Six fast in-memory regressions reproduced stalled cleanup in the HTTP transport: legacy GET and POST expiration, successful DELETE completion, unsupported POST media type, malformed SSE, and retained reader ownership after a complete SSE response. Their stream cancellation promises intentionally remained pending until test cleanup.

HTTP response discard, rejection and final SSE cleanup now initiate cancellation without awaiting adapter completion, handling eventual cancellation errors. This prevents cleanup from masking admission/session errors or delaying reader-lock release. Both unauthorized tee branches are cancelled under the same rule. The existing one-second session-termination fetch deadline remains in place.

Red evidence: /tmp/mcp-http-cancellation-settlement-red2.log (six failures). Green settlement, response ownership, modern cancellation and OAuth ownership evidence: /tmp/mcp-http-cancellation-settlement-green.log (27 passing tests). Repeat the complete final protocol/OAuth gate, affected maintained builds, types and artifact QA.
