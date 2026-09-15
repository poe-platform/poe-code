# MCP HTTP redirect admission

Four client/discovery regressions reproduced omitted fetch redirect policy and acceptance of redirected adapter responses. Two JWKS regressions reproduced the same defects. Rejected redirected metadata could otherwise remain stalled in body consumption; the final regressions use finite in-memory bodies and run quickly.

Centralize MCP fetch admission in mcp-oauth: force redirect:error, reject redirected and opaque redirect responses before consumption, and cancel rejected bodies. Apply it to ordinary HTTP requests, legacy session deletion, OAuth metadata candidates, token exchange/refresh, registration, and JWKS retrieval. Retain caller headers, bodies, and cancellation signals.

This prevents implicit redirect forwarding and detects adapters reporting redirects. It does not verify DNS address ranges or prove a custom adapter did not secretly follow a redirect while concealing it. Those are separate host/network policy limits.

Red evidence: /tmp/mcp-http-redirect-policy-red2.log and /tmp/mcp-jwks-redirect-policy-red.log. Focused green: ten tests pass in /tmp/mcp-http-jwks-redirect-policy-green.log. Rerun the full protocol/OAuth gate and maintained build/test routes after this runtime change. The first continuation npm test run was interrupted after exposing unrelated safe-python capability failures and before declaring a final-state result.
