# BCP / Passthrough Audit

Audit scope:

- `packages/mcp-oauth`
- `packages/tiny-mcp-client`
- `packages/tiny-oauth-test-server`
- `packages/tiny-http-mcp-server`
- `packages/tiny-http-mcp-oauth-test-server`

Verification executed on this tree:

- `npm run test:unit -- packages/mcp-oauth/src/mcp-oauth.test.ts packages/tiny-mcp-client/src/http-oauth.test.ts packages/tiny-mcp-client/src/http-oauth.integration.test.ts packages/tiny-oauth-test-server/src/index.test.ts packages/tiny-http-mcp-server/src/oauth.test.ts`
- `npm run lint:types`

Result: all requested RFC 9700 guardrails and the audited MCP anti-pattern checks pass in the current implementation.

## RFC 9700 / OAuth BCP

| Requirement | Status | Implementation | Test reference |
| --- | --- | --- | --- |
| Implicit grant is never used; the client never sends `response_type=token`. | Pass | `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:534-560` hard-codes `response_type=code`. `packages/mcp-oauth/src/types.compile-check.ts:25-35` makes `responseType: "token"` invalid through the public API. | `packages/mcp-oauth/src/types.compile-check.ts:25-35` via `npm run lint:types` |
| Resource Owner Password Credentials grant is never used. | Pass | `packages/mcp-oauth/src/client/token-endpoint.ts:48-125` only emits `authorization_code` and `refresh_token`. `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:622-630` registers only `authorization_code` and `refresh_token`. `packages/mcp-oauth/src/types.compile-check.ts:37-46` rejects `grantType: "password"` in the public API. | `packages/mcp-oauth/src/types.compile-check.ts:37-46` via `npm run lint:types` |
| `state` is sent on `/authorize` and verified on the callback; mismatch aborts with no fallback. | Pass | `packages/mcp-oauth/src/client/authorization-state.ts:10-48` creates an opaque state that pins issuer expectations. `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:534-560` always sends it. `packages/mcp-oauth/src/client/loopback-authorization.ts:52-129,160-217` rejects missing or mismatched callback state. | `packages/mcp-oauth/src/mcp-oauth.test.ts:722-754`; `packages/tiny-oauth-test-server/src/index.test.ts:314-368` |
| PKCE is used even when a client secret is present. | Pass | `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:548-553` always sends `code_challenge` with `S256`. `packages/mcp-oauth/src/client/token-endpoint.ts:61-71,110-125` always sends `code_verifier` and adds `client_secret` in addition, not instead. | `packages/mcp-oauth/src/mcp-oauth.test.ts:879-901` |
| Mix-up mitigation: the client verifies callback `iss` when supported; otherwise it pins the AS issuer in authorization state. | Pass | `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:544-547` stores issuer expectations in `state`. `packages/mcp-oauth/src/client/loopback-authorization.ts:160-217` requires and verifies `iss` when advertised and still checks the state-pinned issuer otherwise. `packages/tiny-oauth-test-server/src/index.ts:905-919,1087-1094` advertises and returns `iss` in callbacks. | `packages/mcp-oauth/src/mcp-oauth.test.ts:756-799`; `packages/tiny-oauth-test-server/src/index.test.ts:270-290,314-368` |
| Authorization requests use GET query parameters only on `/authorize`; `/token` uses POST form encoding, never JSON. | Pass | `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:542-560` builds the authorization request in the URL query. `packages/mcp-oauth/src/client/token-endpoint.ts:102-125` posts `application/x-www-form-urlencoded`. | `packages/tiny-mcp-client/src/http-oauth.integration.test.ts:509-530`; `packages/tiny-oauth-test-server/src/index.test.ts:789-849` |
| HTTPS is enforced for every endpoint except loopback redirect URIs. | Pass | `packages/tiny-mcp-client/src/oauth-discovery.ts:58-68,174-217,272-305` rejects non-loopback HTTP protected resources and AS issuers during discovery. `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:582-604` rejects non-loopback HTTP authorization, token, and registration endpoints even when discovery is bypassed. | `packages/tiny-mcp-client/src/http-oauth.test.ts:267-320`; `packages/mcp-oauth/src/mcp-oauth.test.ts:801-840`; `packages/tiny-oauth-test-server/src/index.test.ts:947-1005` |
| No bearer tokens appear in URIs; protected requests use only `Authorization: Bearer`. | Pass | `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:52-71,595-611` rejects `access_token` in protected-resource and OAuth endpoint URIs and only writes the `Authorization` header. `packages/tiny-http-mcp-server/src/auth.ts:151-180,305-352` only accepts bearer tokens from the `Authorization` header. | `packages/mcp-oauth/src/mcp-oauth.test.ts:995-1018`; `packages/tiny-http-mcp-server/src/oauth.test.ts:244-275` |

## MCP-Specific Anti-Patterns

| Requirement | Status | Implementation | Test reference |
| --- | --- | --- | --- |
| Token passthrough is forbidden: a token issued for resource A is never attached to resource B. | Pass | `packages/mcp-oauth/src/client/auth-store-session-store.ts:32-58,125-136` keys persisted sessions by canonical resource URI. `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:52-71,100-135,614-619` loads by canonical request URL and rejects request/discovery resource mismatches before any attach, refresh, or exchange. | `packages/mcp-oauth/src/mcp-oauth.test.ts:903-993,1020-1050` |
| Confused deputy: if the MCP server acts as a downstream OAuth client, it must mint its own token and never forward the inbound one. | Pass (no outbound OAuth client path exists in the audited server packages) | The built-in server path only verifies inbound bearer tokens and exposes claims to handlers: `packages/tiny-http-mcp-server/src/auth.ts:305-352`. The bundled fixture only wires verifier + protected-resource metadata and does not make downstream OAuth calls with inbound credentials: `packages/tiny-http-mcp-oauth-test-server/src/index.ts:226-255`. | `packages/tiny-http-mcp-server/src/oauth.test.ts:244-275,457-488,525-556` |
| Redirect URI registration is enforced end to end on the test authorization server. | Pass | `packages/tiny-oauth-test-server/src/index.ts:1020-1094,1126-1138` enforces registered loopback redirect URIs during authorization. `packages/tiny-oauth-test-server/src/index.ts:1230-1259` requires the token request `redirect_uri` to match the code exactly. | `packages/tiny-oauth-test-server/src/index.test.ts:1007-1026,1028-1054,1056-1086,1088-1115` |
| Authorization codes are single-use even if the redirect handler fires twice. | Pass | `packages/mcp-oauth/src/client/loopback-authorization.ts:60-67,87-100` settles the loopback callback once. `packages/tiny-oauth-test-server/src/index.ts:1230-1287` invalidates authorization codes after first use. | `packages/mcp-oauth/src/mcp-oauth.test.ts:1052-1073`; `packages/tiny-oauth-test-server/src/index.test.ts:852-893` |

## Additional Existing Security Coverage Used By This Audit

- Protected-resource and authorization-server metadata mismatches are rejected in `packages/tiny-mcp-client/src/oauth-discovery.ts:70-149,230-319`, exercised by `packages/tiny-mcp-client/src/http-oauth.test.ts:25-120,201-265`.
- Bearer token audience and issuer validation are enforced in `packages/tiny-http-mcp-server/src/auth.ts:331-352`, exercised by `packages/tiny-http-mcp-server/src/oauth.test.ts:457-488,525-556`.
- Cached-token reuse and refresh deduplication remain covered by `packages/mcp-oauth/src/mcp-oauth.test.ts:1075-1160` and `packages/tiny-mcp-client/src/http-oauth.integration.test.ts:630-736`.
