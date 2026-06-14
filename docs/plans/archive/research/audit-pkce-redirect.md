# PKCE And Loopback Redirect Audit

Audited on 2026-04-26 against [docs/plans/research/mcp-oauth-spec.md](/Users/kjopek/Workspace/poe-code/docs/plans/research/mcp-oauth-spec.md).

Scope:
- Client PKCE and loopback redirect flow in [packages/mcp-oauth/src/client/default-oauth-client-provider.ts](/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/client/default-oauth-client-provider.ts), [packages/mcp-oauth/src/client/pkce.ts](/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/client/pkce.ts), and [packages/mcp-oauth/src/client/loopback-authorization.ts](/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/client/loopback-authorization.ts)
- Test authorization server behavior in [packages/tiny-oauth-test-server/src/index.ts](/Users/kjopek/Workspace/poe-code/packages/tiny-oauth-test-server/src/index.ts)
- Embedded MCP OAuth fixture composition via `tiny-http-mcp-oauth-test-server`, which inherits the updated AS behavior from `tiny-oauth-test-server`

## Resolved Findings

1. [packages/tiny-oauth-test-server/src/index.ts](/Users/kjopek/Workspace/poe-code/packages/tiny-oauth-test-server/src/index.ts)
Severity: High
Spec checklist: `Authorization Code Flow With PKCE`; `Redirect URI And Consent Security`
Finding: The test AS had three conformance gaps. It accepted any PKCE verifier whose SHA-256 hash matched the stored challenge, even when the verifier violated the RFC 7636 `43-128` unreserved-character rule. It also allowed the same verifier to be used on multiple token requests, and it exposed `code_verifier` values in the in-memory request log. In the redirect path, it accepted `localhost` redirect URIs and required registered redirect URIs to match the runtime port exactly, which blocked the native-app loopback port exception.
Remediation: The AS now validates the verifier length and alphabet before challenge comparison, rejects reused verifiers, redacts `code_verifier` from logged form bodies, rejects `localhost`, and compares registered loopback redirect URIs with the port stripped during `/authorize` while preserving exact string comparison during `/token`.
Regression coverage: [packages/tiny-oauth-test-server/src/index.test.ts](/Users/kjopek/Workspace/poe-code/packages/tiny-oauth-test-server/src/index.test.ts:365)

2. [packages/mcp-oauth/src/client/default-oauth-client-provider.ts](/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/client/default-oauth-client-provider.ts)
Severity: Medium
Spec checklist: `Authorization Code Flow With PKCE`
Finding: The client always sent `code_challenge_method=S256`, but it did not fail fast when authorization-server metadata omitted `S256` or advertised only `plain`. That meant method selection was effectively hard-coded rather than negotiated against the server’s published capabilities.
Remediation: The client now requires `code_challenge_methods_supported` to contain `S256` before interactive authorization starts, and it refuses to reuse cached discovery metadata that does not advertise `S256`.
Regression coverage: [packages/mcp-oauth/src/mcp-oauth.test.ts](/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/mcp-oauth.test.ts:439)

## Confirmed Correct

- [packages/mcp-oauth/src/client/pkce.ts](/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/client/pkce.ts) already generated RFC 7636-compliant verifiers for the client flow: `crypto.randomBytes(32).toString("base64url")` yields a 43-character unreserved string, and the challenge computation is exactly `base64url(no padding, SHA-256(verifier))`. The RFC 7636 Appendix B vector is locked in by [packages/mcp-oauth/src/client/pkce.test.ts](/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/client/pkce.test.ts).
- [packages/mcp-oauth/src/client/loopback-authorization.ts](/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/client/loopback-authorization.ts) uses `http://127.0.0.1:<random>/callback`, binds the listener on `127.0.0.1`, and keeps the callback path fixed for the session. This is now explicitly covered by [packages/mcp-oauth/src/client/loopback-authorization.test.ts](/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/client/loopback-authorization.test.ts).
- [packages/tiny-oauth-test-server/src/index.ts](/Users/kjopek/Workspace/poe-code/packages/tiny-oauth-test-server/src/index.ts) enforces exact `redirect_uri` replay on `/token`, so port, path, and trailing-slash deviations between `/authorize` and `/token` are rejected byte-for-byte.
- Decision: the current MCP public-client flow remains loopback-only and uses `http://127.0.0.1:<random>/<path>`. HTTPS redirect URIs are not used by the client and are not accepted by the loopback-only authorization path in the test AS. This stays aligned with the current native-client flow exercised by MCP clients today.

## Test Coverage Added

- [packages/mcp-oauth/src/client/pkce.test.ts](/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/client/pkce.test.ts:1)
- [packages/mcp-oauth/src/client/loopback-authorization.test.ts](/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/client/loopback-authorization.test.ts:1)
- [packages/mcp-oauth/src/mcp-oauth.test.ts](/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/mcp-oauth.test.ts:439)
- [packages/tiny-oauth-test-server/src/index.test.ts](/Users/kjopek/Workspace/poe-code/packages/tiny-oauth-test-server/src/index.test.ts:365)
- [packages/tiny-mcp-client/src/http-oauth.test.ts](/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/src/http-oauth.test.ts:1)
- [packages/tiny-mcp-client/src/http-oauth.integration.test.ts](/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/src/http-oauth.integration.test.ts:1)

Result: no remaining PKCE or loopback-redirect deviations were found in the audited client and test-AS paths after the fixes above.
