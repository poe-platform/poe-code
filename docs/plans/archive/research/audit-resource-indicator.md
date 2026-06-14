# RFC 8707 Resource Indicator Audit

## Outcome

Audit scope: client request construction, PRM discovery, token exchange, test authorization server behavior, JWT audience verification, and the tiny HTTP protected-resource wiring.

Finding: the main drift was not in whether `resource` existed, but in how it was normalized and keyed. Before this patch set, the client/session store/discovery path treated equivalent resource URIs as different strings, and the test AS accepted fragment-bearing `resource` values. The JWT verifier also delegated `aud` matching to raw JOSE string equality, which meant canonical-equivalent forms were not normalized in one shared place.

Remediation:

- Added a shared canonical resource helper in `mcp-oauth`.
- Canonicalized the resource used by PRM discovery, auth-store keys, authorize requests, code exchanges, and refresh exchanges.
- Tightened the test AS so `resource` must be an absolute URI with no fragment.
- Switched the JWKS verifier to normalize the configured resource and token `aud`, and to reject multi-audience tokens.
- Added regression coverage for canonical URI vectors, canonicalized request/retry/session behavior, fragment rejection, proxy-host downgrade resistance, and end-to-end wrong-audience rejection.

## Code Path Table

| Layer | File / lines | Touchpoint | Status |
| --- | --- | --- | --- |
| Canonicalization primitive | `packages/mcp-oauth/src/resource-indicator.ts:1-12` | Computes the canonical resource URI: absolute URL required, lowercase scheme/host/default-port handling delegated to `URL`, fragment stripped. | Fixed |
| Client discovery input | `packages/tiny-mcp-client/src/oauth-discovery.ts:70-100` | Validates PRM `resource` against the canonical request resource and stores the canonical resource in discovery results. | Fixed |
| Client PRM URL derivation | `packages/tiny-mcp-client/src/oauth-discovery.ts:174-195` | Builds the RFC 9728 PRM URL from the canonical resource URI. | Fixed |
| Client discovery cache key | `packages/tiny-mcp-client/src/oauth-discovery.ts:230-305` | Uses the canonical resource URI as the in-memory/shared cache key so equivalent URLs collapse to one session/discovery record. | Fixed |
| Auth-store session key | `packages/mcp-oauth/src/client/auth-store-session-store.ts:18-49` | Hashes the canonical resource URI for persisted OAuth session storage. | Fixed |
| Request-to-resource map | `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:43-90` | Maps an MCP request URL to the canonical resource URI for retries and bearer attachment. | Fixed |
| Session lifecycle | `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:93-249` | Loads/saves sessions by canonical resource and keeps authorization/refresh single-flight per canonical resource. | Fixed |
| Discovery reuse | `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:335-368` | Rehydrates discovery from stored sessions using the canonical resource URI. | Fixed |
| `/authorize` request | `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:389-410` | Sends exactly one `resource` parameter on `/authorize`, using the canonical resource URI. | Fixed |
| `/token` code grant | `packages/mcp-oauth/src/client/token-endpoint.ts:29-55` | Sends exactly one canonical `resource` on authorization-code exchange. | Fixed |
| `/token` refresh grant | `packages/mcp-oauth/src/client/token-endpoint.ts:58-80` | Sends exactly one canonical `resource` on refresh. | Fixed |
| Test AS request parsing | `packages/tiny-oauth-test-server/src/index.ts:149-163` | Parses `resource` as an absolute URI and now rejects fragment-bearing values. | Fixed |
| Test AS `/authorize` binding | `packages/tiny-oauth-test-server/src/index.ts:917-990` | Stores the requested `resource` alongside the authorization code. Duplicate params were already rejected by `readSingleParam()`. | Already correct; fragment check added |
| Test AS `/token` code replay | `packages/tiny-oauth-test-server/src/index.ts:1126-1191` | Rejects `/token` if the code, redirect URI, client ID, or `resource` do not exactly match the `/authorize` record. | Already correct; fragment check added |
| Test AS refresh replay | `packages/tiny-oauth-test-server/src/index.ts:1193-1225` | Rejects refresh if the refresh token’s stored `resource` does not match the presented `resource`. | Already correct; fragment check added |
| Test AS token issuance | `packages/tiny-oauth-test-server/src/index.ts:1231-1295` | Issues JWTs with `aud` set exactly to the requested `resource` string. There is no AS config path that emits multiple audiences. | Already correct |
| Protected-resource auth bridge | `packages/tiny-http-mcp-server/src/auth.ts:305-352` | Passes the configured `resource` into the verifier and converts verifier failures into `401/403` Bearer challenges. Verification does not consult `Host` or `X-Forwarded-Host`. | Already correct; regression-pinned |
| PRM publication (standalone) | `packages/tiny-http-mcp-server/src/http-server.ts:157-174, 223-236` | Publishes the configured `resource` in PRM and routes requests through the auth bridge. | Already correct |
| PRM publication (Express) | `packages/tiny-http-mcp-server/src/express-middleware.ts:34-97` | Publishes the configured `resource` in PRM and routes requests through the same auth bridge. | Already correct |
| JWT audience verifier | `packages/mcp-oauth/src/server/jwks-token-verifier.ts:90-120, 140-163, 284-312` | Canonicalizes the configured resource URI, canonicalizes the JWT `aud`, rejects multi-audience claims, and returns `invalid_token` / `audience mismatch` on mismatch. | Fixed |
| End-to-end fixture | `packages/tiny-http-mcp-oauth-test-server/src/index.ts:227-256` | Wires `createJwksTokenVerifier()` into `tiny-http-mcp-server`, making the fixture representative of the real verifier path. | Already correct |

## Spec Checklist Results

- Client sends one canonical `resource` on every `/authorize` request: yes.
- Client sends one canonical `resource` on every `/token` request, including refresh: yes.
- Canonical resource URI handling now strips fragments, collapses default ports, lowercases scheme/host, and preserves explicit query strings: yes.
- Test AS rejects `/token` when `/authorize` and `/token` disagree on `resource`: yes.
- Test AS issues `aud` exactly equal to the requested `resource`: yes.
- Multi-audience AS issuance: no supported configuration path exists; verifier now rejects multi-audience JWT claims defensively.
- Server verifier compares `aud` against the configured canonical resource URI and returns `401 invalid_token` with `error_description="audience mismatch"` on mismatch: yes.
- Proxy or alternate-origin deployment still verifies against the configured resource URI rather than request `Host` headers: yes.

## Regression Coverage

- `packages/mcp-oauth/src/resource-indicator.test.ts`
  - Known canonical-URI vector set.
- `packages/mcp-oauth/src/mcp-oauth.test.ts`
  - Canonical auth-store keying.
  - Canonical request mapping.
  - Canonical `resource` on `/authorize`, code exchange, and refresh.
- `packages/mcp-oauth/src/server-token-verifier.test.ts`
  - Canonical-equivalent configured resource URIs are accepted.
  - Multi-audience JWTs are rejected as `invalid_token` / `audience mismatch`.
- `packages/tiny-oauth-test-server/src/index.test.ts`
  - Fragment-bearing `resource` rejection.
  - `/authorize` vs `/token` resource replay rejection.
- `packages/tiny-http-mcp-server/src/oauth.test.ts`
  - `invalid_token` / `audience mismatch`.
  - Host-header / forwarded-host downgrade resistance.
- `packages/tiny-http-mcp-oauth-test-server/src/index.test.ts`
  - End-to-end wrong-audience rejection through the real JWKS verifier.

## Verification Run

- `npm run test:unit -- packages/mcp-oauth/src/server-token-verifier.test.ts packages/mcp-oauth/src/resource-indicator.test.ts packages/mcp-oauth/src/mcp-oauth.test.ts packages/tiny-oauth-test-server/src/index.test.ts packages/tiny-http-mcp-server/src/oauth.test.ts packages/tiny-http-mcp-oauth-test-server/src/index.test.ts`
- `npm run test:unit -- packages/tiny-mcp-client/src/http-oauth.test.ts packages/tiny-mcp-client/src/http-oauth.integration.test.ts`
- `npm run lint:types`
- `npx eslint packages/mcp-oauth/src/resource-indicator.ts packages/mcp-oauth/src/resource-indicator.test.ts packages/mcp-oauth/src/index.ts packages/mcp-oauth/src/client/auth-store-session-store.ts packages/mcp-oauth/src/client/token-endpoint.ts packages/mcp-oauth/src/client/default-oauth-client-provider.ts packages/mcp-oauth/src/server/jwks-token-verifier.ts packages/mcp-oauth/src/mcp-oauth.test.ts packages/tiny-mcp-client/src/oauth-discovery.ts packages/tiny-oauth-test-server/src/index.ts packages/tiny-oauth-test-server/src/index.test.ts packages/tiny-http-mcp-server/src/oauth.test.ts packages/tiny-http-mcp-oauth-test-server/src/index.test.ts`
