# Cancel ignored MCP HTTP response bodies

Validated three regressions with streaming response bodies and cancellation spies: POST202, successful POST without Content-Type, and unsupported Content-Type all retained unread bodies. All three tests failed before cancellation was added.

Cancel each unread response body before returning or rejecting. This changes internal resource ownership without adding public configuration.

Validation: focused body ownership and response-limit tests pass; selected tiny-mcp-client build closure (six builds) and MCP client/core ESLint pass. Modern negotiation changes remain separate and unstaged.
