# Managed HTTP redirect admission before wrapping

SafeJS's HTTP response wrapper constructed a new Response for owned reader cleanup and thereby lost redirected/type flags reported by an injected fetch adapter. Two fast managed MCP regressions demonstrated that redirected and opaque-redirect responses were accepted as normal discovery/tool responses.

The client now re-exports the existing shared fetchMcpResponse helper. SafeJS calls it on the raw adapter response before constructing the reader wrapper, retaining a single redirect admission policy without a new dependency. Redirect rejection cancels the raw body before any reader is acquired and settles independently of cancellation completion.

Red evidence: /tmp/mcp-managed-redirect-admission-red.log (two failures). Green managed/client/helper evidence: /tmp/mcp-managed-redirect-admission-green.log. Repeat final source, maintained build, public type, lint and artifact gates after this change. Injected adapters remain responsible for truthfully reporting redirect behavior.

Final public built makeMcpModule QA also passed reported-redirect rejection, invalid UTF-8 and abort cleanup, with locks released and close settled before adapter cancellation completed: /tmp/mcp-final-frozen-built-managed-http-qa.log. Frozen consumer/protocol gates, maintained harness/client dependencies, repository types and affected-source lint passed.
