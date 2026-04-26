# Audit: Dynamic Client Registration and OAuth Error Handling

Date: 2026-04-26

## Scope

Audited:

- `packages/mcp-oauth`
- `packages/tiny-oauth-test-server`
- `packages/tiny-mcp-client`
- `packages/tiny-http-mcp-oauth-test-server`

Focus:

- RFC 7591 dynamic client registration request/response handling
- client persistence and reuse of dynamic registrations via `auth-store`
- static `client_id` fallback when `registration_endpoint` is absent
- bounded re-registration after `invalid_client`
- RFC 6749 token endpoint error handling
- RFC 6750 `WWW-Authenticate` bearer challenge handling

## Findings

Status after this change: compliant for the requested DCR and OAuth error-handling paths.

Concrete gap found and fixed:

- `mcp-oauth` preferred a stored dynamic client registration from `auth-store` even when the current authorization-server metadata no longer advertised `registration_endpoint` and the caller had configured a static fallback `client_id`.
- This could keep using a stale dynamic registration instead of the explicitly configured static client.
- Fixed in `packages/mcp-oauth/src/client/default-oauth-client-provider.ts` by checking `registration_endpoint` before loading stored dynamic clients when a static fallback is configured.

## DCR Audit

Result:

- `mcp-oauth` sends DCR requests as `application/json`.
- The registration payload includes `redirect_uris`, `grant_types`, `response_types`, and `token_endpoint_auth_method: "none"` by default.
- `client_name`, `scope`, `software_id`, and `software_version` are included when configured in client metadata.
- `tiny-oauth-test-server` validates JSON content type, `redirect_uris`, supported `grant_types`, supported `response_types`, and rejects unsupported `token_endpoint_auth_method` values with `invalid_client_metadata`.
- The registration response is canonical for a public client: `client_id`, `client_id_issued_at`, echoed metadata, and no `client_secret`.
- Registered clients are persisted in `auth-store` keyed by issuer and reused on later runs.
- When a stored dynamic client is rejected as `invalid_client`, `mcp-oauth` clears the issuer-scoped stored registration, re-registers once, and then stops retrying.
- When `registration_endpoint` is missing and a static fallback `client_id` is configured, that static client is now preferred even if an older dynamic registration exists in `auth-store`.

## Error Code Matrix

### RFC 6749 Authorization Endpoint Errors (`4.1.2.1`)

| Error code | Where the codebase reaches it | Current handling |
| --- | --- | --- |
| `invalid_request` | `tiny-oauth-test-server` returns this for malformed `/authorize` inputs such as missing required params, bad redirect/resource URLs, or unsupported PKCE method. | Server-side behavior exists. If a real AS redirects back with this error, `mcp-oauth` loopback handling currently rejects with a plain `Error`, not `OAuthError`. |
| `unauthorized_client` | `tiny-oauth-test-server` returns this when `requireDcr` is enabled and an unknown `client_id` hits `/authorize`. | Same loopback caveat as above: surfaced as a plain `Error` if returned via authorization redirect. |
| `access_denied` | Not currently synthesized by `tiny-oauth-test-server` because there is no deny action in the consent UI. | If returned by a real AS redirect, loopback handling would surface a plain `Error`. |
| `unsupported_response_type` | `tiny-oauth-test-server` returns this when `response_type !== "code"`. | Same loopback caveat as above. |
| `invalid_scope` | `tiny-oauth-test-server` returns this when requested scopes exceed a registered client’s allowed scopes. | Same loopback caveat as above. |
| `server_error` | Not intentionally emitted by the test AS authorization endpoint. | A redirect carrying this would currently surface as a plain `Error`. |
| `temporarily_unavailable` | Not intentionally emitted by the test AS authorization endpoint. | A redirect carrying this would currently surface as a plain `Error`. |

### RFC 6749 Token Endpoint Errors (`5.2`)

| Error code | Where the codebase reaches it | Current handling |
| --- | --- | --- |
| `invalid_request` | `tiny-oauth-test-server` returns this for malformed token requests; tests also inject it directly. | `mcp-oauth` parses it into `OAuthError`; terminal, no retry. |
| `invalid_client` | Injected in `mcp-oauth` tests to model revoked/stale registrations. | `mcp-oauth` treats this as terminal for static/current clients, but for stored dynamic registrations it clears the stored issuer record and re-registers exactly once. |
| `invalid_grant` | `tiny-oauth-test-server` returns this for invalid/expired codes, redirect/resource mismatches, bad or reused PKCE verifiers, and invalid/expired refresh tokens. | `mcp-oauth` surfaces `OAuthError`; on refresh it clears cached tokens and requires re-authorization, on auth-code exchange it fails terminally. |
| `unauthorized_client` | Not produced by the built-in test token endpoint, but covered by client-side error tests. | `mcp-oauth` surfaces `OAuthError`; terminal, no retry. |
| `unsupported_grant_type` | `tiny-oauth-test-server` returns this for unknown `grant_type` values. | `mcp-oauth` surfaces `OAuthError`; terminal, no retry. |
| `invalid_scope` | Covered by client-side token error tests. The built-in test AS emits `invalid_scope` on authorization requests rather than token requests. | `mcp-oauth` surfaces `OAuthError`; terminal, no retry. |
| `server_error` | Explicitly supported by client-side tests; generic non-JSON/non-OAuth 5xx responses also fall back here. | `mcp-oauth` wraps this as `OAuthError` and retries once. |
| `temporarily_unavailable` | Explicitly supported by client-side tests; a `503` fallback also maps here. | `mcp-oauth` wraps this as `OAuthError` and retries once. |

### RFC 7591 Registration Endpoint Errors (`3.2.2`)

| Error code | Where the codebase reaches it | Current handling |
| --- | --- | --- |
| `invalid_redirect_uri` | `tiny-oauth-test-server` returns this when `redirect_uris` is missing or invalid. | `mcp-oauth` reads registration responses through the same JSON/OAuth error path and surfaces `OAuthError`; terminal, no retry. |
| `invalid_client_metadata` | `tiny-oauth-test-server` returns this for unsupported `token_endpoint_auth_method`, unsupported `grant_types`, unsupported `response_types`, or malformed metadata arrays. | `mcp-oauth` surfaces `OAuthError`; terminal, no retry. Added regression coverage in this change. |
| `invalid_software_statement` | Not currently emitted because the test AS does not implement software statements. | If returned by a real AS registration endpoint, `mcp-oauth` would surface `OAuthError`; terminal, no retry. |
| `unapproved_software_statement` | Not currently emitted because the test AS does not implement software statements. | If returned by a real AS registration endpoint, `mcp-oauth` would surface `OAuthError`; terminal, no retry. |

### RFC 6750 Bearer Challenge Errors (`3.1`)

| Error code | Where the codebase reaches it | Current handling |
| --- | --- | --- |
| `invalid_request` | Not currently emitted by the bundled MCP resource-server fixtures. | `tiny-mcp-client` would map a 401/403 `WWW-Authenticate: Bearer ... error="invalid_request"` challenge to `OAuthError`. |
| `invalid_token` | Emitted by verifier-backed resource servers for bad, revoked, expired, or audience-mismatched tokens. | `tiny-mcp-client` maps the bearer challenge to `OAuthError`. `mcp-oauth` also uses a 401 `invalid_token` challenge as the signal to refresh/re-authorize once cached tokens exist. |
| `insufficient_scope` | Emitted by `createJwksTokenVerifier` when token scopes do not satisfy required scopes. | `tiny-mcp-client` maps the 403 challenge to `OAuthError`; terminal, no retry. |

## Tests Added or Tightened

Added in `packages/mcp-oauth/src/mcp-oauth.test.ts`:

- static fallback wins over a stored dynamic registration when `registration_endpoint` is absent
- DCR registration endpoint errors surface as `OAuthError`
- re-registration after `invalid_client` is bounded to one retry before failing

Existing coverage already present and revalidated:

- successful DCR plus auth-store reuse across runs
- fallback to static `client_id` when `registration_endpoint` is missing
- successful re-registration after stored `invalid_client`
- token-endpoint OAuth errors surfaced as `OAuthError`
- transient vs terminal retry policy
- bearer challenge mapping for `invalid_token` and `insufficient_scope` in `tiny-mcp-client`

## Verification

Executed:

- `npm exec vitest run packages/mcp-oauth/src/mcp-oauth.test.ts`
- `npm exec vitest run packages/tiny-oauth-test-server/src/index.test.ts`
- `npm exec vitest run packages/tiny-mcp-client/src/http-oauth.integration.test.ts`
