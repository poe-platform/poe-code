# OAuth Discovery Audit

Audited against `docs/plans/research/mcp-oauth-spec.md` and `docs/plans/research/mcp-oauth-implementations.md` on 2026-04-26.

## Findings

1. `packages/tiny-mcp-client/src/oauth-discovery.ts:224-251`
Severity: High
Spec checklist: `Protected Resource Discovery`: `Client must parse WWW-Authenticate and respond appropriately to 401.` Also `Token Responses, Refresh, And Client Re-Authentication`: `Client must treat 401 as a re-authentication trigger and restart discovery/authorization as needed.`
Finding: `OAuthMetadataDiscovery` reused cache entries solely by request URL. After an initial discovery, a later `401` carrying a different `resource_metadata` hint reused stale PRM/AS data and skipped the hinted endpoint entirely.
Remediation: Cache reuse now requires the cached `resourceMetadataUrl` to match the current hint. A new hint forces a refetch and refreshes the cached discovery state.
Regression coverage: `packages/tiny-mcp-client/src/http-oauth.test.ts:358-429`

2. `packages/tiny-http-mcp-server/src/http-server.ts:79-96`
Severity: High
Spec checklist: `Protected Resource Discovery`: `On 401, server must send WWW-Authenticate with the resource_metadata auth-param pointing at PRM.`
Finding: standalone HTTP path handling normalized trailing slashes differently for routing and challenge generation. With `listenHttp({ path: "/mcp/" })`, the server advertised `resource_metadata=.../mcp` while serving PRM at `.../mcp/`, so the advertised discovery URL returned `404`.
Remediation: non-root HTTP paths are now canonicalized before route registration, handle URL generation, and challenge construction so the advertised PRM URL is always fetchable.
Regression coverage: `packages/tiny-http-mcp-server/src/oauth.test.ts:214-242`

3. `packages/tiny-http-mcp-server/src/http-server.ts:90-95`, `packages/tiny-http-mcp-server/src/express-middleware.ts:41-48`
Severity: Medium
Spec checklist: `Protected Resource Discovery`: `PRM must be exposed from the RFC 9728 well-known location via GET.`
Finding: pathful protected resources were also exposed at the root PRM alias `/.well-known/oauth-protected-resource`. That alias is not the RFC 9728 well-known location for a pathful resource and preserved older fallback behavior the audit explicitly scoped out.
Remediation: removed the root PRM alias for non-root standalone and Express handlers; only the path-based RFC 9728 location remains.
Regression coverage: `packages/tiny-http-mcp-server/src/oauth.test.ts:166-187`, `packages/tiny-http-mcp-server/src/oauth.test.ts:305-330`

4. `packages/tiny-oauth-test-server/src/index.ts:370-373`
Severity: Low
Spec checklist: `Authorization Server Discovery`: `Client must derive the RFC 8414 well-known URL from the issuer identifier and fetch it with GET.`
Finding: when the test authorization server used a pathful issuer, it still emitted a host-based RFC 8414 metadata alias at `/.well-known/oauth-authorization-server`. That made the fixture advertise both the correct path-based location and an extra legacy alias.
Remediation: removed the host-based metadata alias for pathful issuers so the fixture matches RFC 8414 path-based discovery exactly.
Regression coverage: `packages/tiny-oauth-test-server/src/index.test.ts:286-305`

## Confirmed Correct

- Server challenges already stayed on the `Bearer` scheme, omitted `error` for missing-token `401`s, and emitted `invalid_token` / `insufficient_scope` details when verification failed.
- `tiny-mcp-client` already handled combined `WWW-Authenticate` headers with quoted commas, token68 challenges, and multiple challenges in one header.
- `tiny-mcp-client` already enforced RFC 8414 issuer equality, HTTPS-only discovery with the loopback HTTP exception, path-based issuer resolution, and preservation of unknown metadata members.
