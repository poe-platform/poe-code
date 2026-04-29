---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# HTTP MCP Production Readiness

Make `tiny-http-mcp-server` production-grade for remote tool-only MCP HTTP deployments.

## 1. What we're building

Fix all production-readiness gaps in the HTTP MCP server package so it is safe, durable, and spec-conformant enough for real remote MCP tool deployments.

The scope includes:

- Origin validation and DNS rebinding protection for HTTP MCP endpoints.
- Per-session protocol lifecycle instead of relying on the base stdio server's global initialized state.
- Protocol-version negotiation and request-header enforcement for stateful HTTP sessions.
- Correct Streamable HTTP SSE behavior for multiple connected streams, including resumable delivery support.
- Resource limits for request bodies, batches, sessions, streams, and concurrent tool calls.
- Pluggable/expiring session storage suitable for long-running servers and multi-instance deployments.
- First-class production OAuth token verification using the existing `mcp-oauth` package, including JWKS caching and clear auth errors.
- HTTP hardening around request errors, timeouts, trusted proxy handling, CORS/preflight, and response headers.
- Observability hooks for logs, metrics, request IDs, auth failures, tool latency, and session lifecycle.

Explicit non-goals for this plan:

- Do not replace the `tiny-stdio-mcp-server` package with the official MCP SDK.
- Do not add provider-specific branches or special cases.
- Do not add README changes without explicit user permission.
- Do not implement a hosted OAuth authorization server in `tiny-http-mcp-server`; the package remains a protected-resource server and consumes/verifies bearer tokens.
- Do not add MCP capabilities beyond tools in this plan: no resources, prompts, completion, roots, sampling, elicitation, or generalized server-initiated request/response support.
- Do not write screenshot tests. Any visual CLI impact should be validated with ad hoc screenshots only.
