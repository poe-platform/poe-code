# MCP OAuth Authorization Summary

This note summarizes the MCP authorization profile so later implementation tasks can work from one page instead of re-reading the spec set. Citations use short references such as `[MCP 2025-06-18, Authorization Server Location]` or `[RFC 9728 §3.3]`.

## Current Profile And Legacy Delta

- Treat the June 18, 2025 MCP authorization page as the current profile. It makes Protected Resource Metadata (`/.well-known/oauth-protected-resource`) and Authorization Server Metadata discovery mandatory, requires `resource` on both `/authorize` and `/token`, and explicitly forbids token passthrough. `[MCP 2025-06-18, Overview; MCP 2025-06-18, Resource Parameter Implementation; MCP 2025-06-18, Access Token Privilege Restriction]`
- The March 26, 2025 page is useful only as a legacy compatibility note: it allowed RFC 8414 fallback URLs (`/authorize`, `/token`, `/register`) derived from the MCP server base URL, but the June 2025 profile removed that fallback. Treat that fallback as legacy-only behavior. `[MCP 2025-03-26, Fallbacks for Servers without Metadata Discovery; MCP 2025-06-18, Overview]`

## Transport Scope

- Authorization is optional for MCP implementations overall. When implemented on an HTTP-based transport, the implementation should follow this OAuth profile; in practice this means Streamable HTTP. `[MCP 2025-06-18, Purpose and Scope; MCP 2025-06-18, Protocol Requirements]`
- STDIO should not use this OAuth profile and should obtain credentials from the environment instead. `[MCP 2025-06-18, Protocol Requirements]`
- Alternative transports are outside this profile and must follow the security best practices of their own protocol. `[MCP 2025-06-18, Protocol Requirements]`

## Protected MCP HTTP Requests

- The MCP client must send `Authorization: Bearer <access-token>` on every protected HTTP request, even when requests are part of one logical session. Tokens must not appear in the URI query string. `[MCP 2025-06-18, Token Requirements]`
- The MCP server must validate the presented access token before serving the request. Invalid or expired tokens must produce `401 Unauthorized`; insufficient scopes must produce `403 Forbidden`; malformed authorization requests must produce `400 Bad Request`. `[MCP 2025-06-18, Token Handling; MCP 2025-06-18, Error Handling; RFC 6749 §7]`

## Protected Resource Discovery

### PRM endpoint and document

- The MCP server must implement OAuth 2.0 Protected Resource Metadata (RFC 9728). The metadata document is fetched with `GET` from the well-known URL formed by inserting `/.well-known/oauth-protected-resource` between the host and the resource path/query, if any. `[MCP 2025-06-18, Overview; MCP 2025-06-18, Authorization Server Location; RFC 9728 §3.1]`
- The PRM JSON object must contain RFC 9728 metadata members. In base RFC 9728, `resource` is required and `authorization_servers` is optional; the MCP June 2025 profile tightens this and requires `authorization_servers` with at least one authorization server. `[RFC 9728 §2; MCP 2025-06-18, Authorization Server Location]`
- Relevant PRM shape for MCP:
  - `resource`: required protected-resource identifier. `[RFC 9728 §2]`
  - `authorization_servers`: required by MCP, array of authorization-server issuer identifiers. `[RFC 9728 §2; MCP 2025-06-18, Authorization Server Location]`
  - `scopes_supported`: recommended. `[RFC 9728 §2]`
  - `bearer_methods_supported`: optional; if omitted, no default is implied. `[RFC 9728 §2]`

### 401 challenge

- When returning `401 Unauthorized`, the MCP server must include a `WWW-Authenticate` challenge that points the client at the protected-resource metadata URL via the `resource_metadata` auth-param. RFC 9728 defines the parameter; MCP makes its use mandatory for 401 discovery. `[RFC 9728 §5.1; MCP 2025-06-18, Authorization Server Location]`
- The MCP client must be able to parse `WWW-Authenticate` and react to `401 Unauthorized` responses accordingly. In practice, that means using the challenge to start or restart discovery and authorization. `[MCP 2025-06-18, Authorization Server Location; MCP 2025-03-26, Example: authorization code grant]`

### Client validation of PRM

- The client must fetch PRM over TLS and validate the server certificate for the resource identifier URL. `[RFC 9728 §7.1; RFC 9728 §7.3]`
- The client must ensure the returned `resource` exactly matches the protected-resource identifier used to construct the PRM URL; if PRM was discovered through `WWW-Authenticate`, the returned `resource` must also exactly match the URL the client used to call the MCP server. Otherwise the metadata must not be used. `[RFC 9728 §3.3; RFC 9728 §7.3]`
- If the MCP server advertises multiple authorization servers, selecting which one to use is the client's responsibility. `[MCP 2025-06-18, Authorization Server Location; RFC 9728 §7.6]`
- Clients should defend discovery fetches against SSRF, for example by rejecting metadata URLs that resolve to internal address ranges. `[RFC 9728 §7.7]`

## Authorization Server Discovery

- The authorization server must publish OAuth 2.0 Authorization Server Metadata, and the MCP client must use it. `[MCP 2025-06-18, Overview; MCP 2025-06-18, Server Metadata Discovery]`
- Starting from the chosen PRM `authorization_servers` issuer, the client fetches `/.well-known/oauth-authorization-server`, inserting that path before any issuer path component and removing a trailing `/` first if present. `[RFC 8414 §3]`
- The client must query the AS metadata with `GET` and must reject the document unless its returned `issuer` exactly matches the issuer identifier used to form the discovery URL. `[RFC 8414 §3; RFC 8414 §3.3; RFC 8414 §6.2]`
- Minimum AS metadata that matters to MCP:
  - `issuer`: required. `[RFC 8414 §2]`
  - `authorization_endpoint`: required for authorization-code flow. `[RFC 8414 §2]`
  - `token_endpoint`: required for token exchange unless only implicit is supported, which MCP does not rely on. `[RFC 8414 §2]`
  - `response_types_supported`: required. `[RFC 8414 §2]`
  - `registration_endpoint`: optional, but needed for Dynamic Client Registration. `[RFC 8414 §2]`
  - `code_challenge_methods_supported`: optional metadata field; for MCP, practical interoperability requires `S256`. `[RFC 8414 §2; RFC 9700 §2.1.1]`

## Dynamic Client Registration

- MCP clients and authorization servers should support RFC 7591 Dynamic Client Registration so clients can obtain a `client_id` without user-managed setup. `[MCP 2025-06-18, Dynamic Client Registration]`
- If the AS does not support DCR, the client must fall back to one of two paths: use a pre-configured `client_id` (and credentials if applicable) for that AS, or prompt the user to supply details from a manually created OAuth client. `[MCP 2025-06-18, Dynamic Client Registration]`
- DCR uses `POST` with `application/json` to the AS `registration_endpoint`, over TLS. The endpoint may require an initial access token, but RFC 7591 recommends allowing open registration for interoperability. `[RFC 7591 §3.1; RFC 7591 §3.2; RFC 7591 §5]`
- For redirect-based flows, `redirect_uris` must be registered, and dynamic-registration-capable authorization servers for redirect-based flows must support that metadata. `[RFC 7591 §2; RFC 6749 §3.1.2]`
- Useful DCR request metadata for MCP authorization-code clients:
  - `redirect_uris`. `[RFC 7591 §2]`
  - `token_endpoint_auth_method`; use `"none"` for a public client. `[RFC 7591 §2]`
  - `grant_types`; default is `authorization_code` if omitted, but explicit `["authorization_code"]` is clearer. `[RFC 7591 §2]`
  - `response_types`; default is `["code"]` if omitted. `[RFC 7591 §2]`
  - `client_name`; recommended so consent screens do not fall back to raw `client_id`. `[RFC 7591 §2]`
- On success the AS returns `201 Created` JSON containing at least `client_id`, optional `client_secret`, required `client_secret_expires_at` if a secret is issued, and all registered metadata. The AS may replace requested metadata values with server-chosen values, so the registration response is the authoritative result. `[RFC 7591 §3.2.1]`

## Authorization Code Flow With PKCE

### Required flow and disallowed flow choices

- For browser-mediated user authorization, MCP relies on the authorization code flow. The March 2025 page also mentioned client-credentials as a separate non-user flow, but the transport-level OAuth profile covered by the June 2025 page centers authorization code plus PKCE. `[MCP 2025-03-26, Example: authorization code grant; MCP 2025-06-18, Authorization Code Protection]`
- MCP clients must implement PKCE. RFC 9700 says clients should use a PKCE code challenge method that does not expose the verifier in the authorization request, and `S256` is currently the only such method. Authorization servers must provide a way for clients to detect PKCE support; publishing `code_challenge_methods_supported` in RFC 8414 metadata is the recommended way. `[MCP 2025-06-18, Authorization Code Protection; RFC 9700 §2.1.1]`
- Clients should not use the implicit flow (`response_type=token`) for MCP user authorization, and the resource-owner-password grant must not be used. `[RFC 9700 §2.1.2; RFC 9700 §2.4]`

### `/authorize` request

- The authorization request must include `response_type=code` and `client_id`. `[RFC 6749 §4.1.1]`
- The authorization request should include `state`, and the client should verify it on return and discard responses with missing or mismatched state. MCP June 2025 calls this out explicitly. `[RFC 6749 §4.1.1; MCP 2025-06-18, Open Redirection]`
- The authorization request must include `resource`, and the value must identify the MCP server the token is meant for. `[MCP 2025-06-18, Resource Parameter Implementation]`
- Because MCP clients must implement PKCE, the authorization request must also carry a PKCE `code_challenge`, and for real interoperability it should set `code_challenge_method=S256`. `[MCP 2025-06-18, Authorization Code Protection; RFC 9700 §2.1.1; RFC 8414 §2]`
- `redirect_uri` is optional in bare RFC 6749 if only one redirect URI is pre-registered, but MCP security requirements around exact redirect matching make it safer to send it explicitly and then require the same value again at the token endpoint. `[RFC 6749 §4.1.1; RFC 6749 §10.6; MCP 2025-06-18, Open Redirection]`

### `/token` request for code exchange

- The token request must include `grant_type=authorization_code` and `code`. `[RFC 6749 §4.1.3]`
- If the authorization request included `redirect_uri`, the token request must include the same `redirect_uri` value byte-for-byte. `[RFC 6749 §4.1.3; RFC 6749 §10.6]`
- If the client is not authenticating at the token endpoint, the token request must include `client_id`. This is the normal public-client case. `[RFC 6749 §4.1.3]`
- Because MCP requires PKCE, the token request must include the PKCE `code_verifier`; the AS must enforce that binding before issuing tokens. `[MCP 2025-06-18, Authorization Code Protection; RFC 9700 §2.1.1]`
- The token request must include `resource` as well. MCP June 2025 says the client must send `resource` in both authorization requests and token requests, even if the AS does not otherwise advertise support. `[MCP 2025-06-18, Resource Parameter Implementation]`

## Resource Indicator And Audience Binding

- MCP clients must implement RFC 8707 Resource Indicators. `[MCP 2025-06-18, Resource Parameter Implementation]`
- The client must include `resource` on both `/authorize` and `/token`; it must identify the MCP server the token is for; it must use the MCP server's canonical URI. `[MCP 2025-06-18, Resource Parameter Implementation]`
- The client should use the most specific canonical URI it can for the MCP server. For robustness, implementations should accept uppercase scheme/host components even though canonical form is lowercase. `[MCP 2025-06-18, Canonical Server URI]`
- RFC 8707 requires the `resource` value to be an absolute URI, forbids fragment components, and says it should avoid query components unless the query is part of the resource identity. `[RFC 8707 §2]`
- RFC 8707 lets an AS treat `resource` as optional, default it, or reject it with `invalid_target`, but MCP tightens client behavior: the client must send it regardless. `[RFC 8707 §2.1; MCP 2025-06-18, Resource Parameter Implementation]`
- The authorization server should audience-restrict issued access tokens to the requested resource. It may map the literal `resource` URI to a broader audience identifier, but the token still has to be bound to the intended resource server. `[RFC 8707 §2; RFC 9700 §2.3; RFC 9728 §7.4]`
- The MCP server must validate that presented tokens were issued specifically for it and must reject tokens whose audience does not match. `[MCP 2025-06-18, Token Handling; MCP 2025-06-18, Token Audience Binding and Validation; RFC 9700 §2.3]`

## Token Responses, Refresh, And Client Re-Authentication

- The token response must include `access_token` and `token_type`; `expires_in` is recommended; `refresh_token` is optional. The client must not use an access token if it does not understand the token type. `[RFC 6749 §5.1; RFC 6749 §7.1]`
- For MCP HTTP calls, the usable token type is Bearer because protected requests use `Authorization: Bearer`. `[MCP 2025-06-18, Token Requirements]`
- Clients and servers must store tokens securely. Authorization servers should issue short-lived access tokens to reduce leakage impact. `[MCP 2025-06-18, Token Theft]`
- If refresh tokens are issued, RFC 9700 says they must be bound to the consented scope and resource servers. MCP is stricter for public clients: authorization servers must rotate refresh tokens. RFC 6749 also says that when a new refresh token is issued, the client must discard the old one and replace it. `[RFC 9700 §4.14.2; MCP 2025-06-18, Token Theft; RFC 6749 §6]`
- RFC 9700 further recommends refresh-token expiry on inactivity and allows revocation on security events such as password change or logout. `[RFC 9700 §4.14.2]`
- The client must treat `401 Unauthorized` as a re-authentication trigger. Concretely:
  - no token or authorization not yet proven -> start the authorization flow. `[MCP 2025-03-26, Example: authorization code grant]`
  - invalid or expired token -> obtain fresh tokens, then retry. `[MCP 2025-06-18, Token Handling]`
  - new `WWW-Authenticate` `resource_metadata` hint -> re-run discovery from PRM, because the server may be pointing at updated metadata. `[MCP 2025-06-18, Authorization Server Location; RFC 9728 §5.1]`

## Server-Side Token Validation And Security Boundaries

- The MCP server must validate access tokens before processing requests. The explicit normative floor is:
  - validate the token and reject invalid tokens, `[MCP 2025-06-18, Token Handling]`
  - reject expired tokens, `[MCP 2025-06-18, Token Handling; RFC 6749 §7]`
  - ensure scope covers the requested resource/action, `[RFC 6749 §7; RFC 9700 §2.3]`
  - ensure the token was issued specifically for this MCP server as audience, `[MCP 2025-06-18, Token Handling; RFC 9700 §2.3]`
  - only accept tokens issued by the MCP server's advertised authorization server, `[MCP 2025-06-18, Token Handling]`
  - never accept or transit tokens issued for other resources. `[MCP 2025-06-18, Token Handling; MCP 2025-06-18, Access Token Privilege Restriction]`
- The client must not send tokens to the MCP server other than tokens issued by that MCP server's authorization server. The authorization server or server-side validation path must only accept tokens valid for its own resources. `[MCP 2025-06-18, Token Handling]`
- Signature and issuer validation are implementation consequences rather than new MCP-specific token-format rules. RFC 6749 leaves token-validation mechanics out of scope, but if the server validates self-contained signed tokens locally, it necessarily needs to verify cryptographic integrity/signature and issuer; if it uses opaque-token validation or introspection, those checks happen through coordination with the authorization server. `[RFC 6749 §7; MCP 2025-06-18, Token Handling]`
- The MCP server must not pass through the client's token to upstream APIs. If it calls an upstream API, it acts as a separate OAuth client and must use a separate upstream token issued for that upstream resource. `[MCP 2025-06-18, Access Token Privilege Restriction]`
- The no-passthrough rule is the main confused-deputy boundary: do not let a token meant for the MCP server become a downstream token, and do not accept downstream tokens as if they were MCP tokens. `[MCP 2025-06-18, Access Token Privilege Restriction; MCP 2025-06-18, Confused Deputy Problem]`

## Redirect URI And Consent Security

- All authorization-server endpoints must be served over HTTPS. `[MCP 2025-06-18, Communication Security; MCP 2025-03-26, Security Considerations]`
- Redirect URIs must be either HTTPS or localhost/loopback. RFC 9700 is more precise: authorization responses must not be sent over unencrypted connections, except for native-app loopback redirect URIs; exact string matching is required except for the port number on localhost native-app redirects. `[MCP 2025-06-18, Communication Security; RFC 9700 §2.1; RFC 9700 §2.6]`
- MCP clients must have redirect URIs registered with the authorization server, and authorization servers must validate exact redirect URIs against pre-registered values. `[MCP 2025-06-18, Open Redirection; RFC 6749 §10.6; RFC 9700 §2.1]`
- Authorization servers must take precautions against redirecting user agents to untrusted URIs. They should only auto-redirect when the redirection URI is trusted; otherwise they may stop and rely on explicit user choice. `[MCP 2025-06-18, Open Redirection]`
- MCP proxy servers that use static client IDs must obtain user consent for each dynamically registered client before forwarding to third-party authorization servers. `[MCP 2025-06-18, Confused Deputy Problem]`

## Conformance Checklist

- `Transport Scope`: HTTP-based MCP transports should follow this OAuth profile; STDIO should not; alternative transports must use their own best-practice security model. `[MCP 2025-06-18, Protocol Requirements]`
- `Protected MCP HTTP Requests`: Client must send `Authorization: Bearer <access-token>` on every protected HTTP request; tokens must not go in the query string. `[MCP 2025-06-18, Token Requirements]`
- `Protected MCP HTTP Requests`: Server must validate access tokens before serving the request. `[MCP 2025-06-18, Token Handling; RFC 6749 §7]`
- `Protected MCP HTTP Requests`: Server must return `401` for missing, invalid, or expired tokens; `403` for insufficient scope; `400` for malformed authorization requests. `[MCP 2025-06-18, Token Handling; MCP 2025-06-18, Error Handling]`
- `Protected Resource Discovery`: Server must implement RFC 9728 Protected Resource Metadata. `[MCP 2025-06-18, Overview; MCP 2025-06-18, Authorization Server Location]`
- `Protected Resource Discovery`: PRM must be exposed from the RFC 9728 well-known location via `GET`. `[RFC 9728 §3.1]`
- `Protected Resource Discovery`: PRM must include `authorization_servers` with at least one issuer. `[MCP 2025-06-18, Authorization Server Location]`
- `Protected Resource Discovery`: On `401`, server must send `WWW-Authenticate` with the `resource_metadata` auth-param pointing at PRM. `[RFC 9728 §5.1; MCP 2025-06-18, Authorization Server Location]`
- `Protected Resource Discovery`: Client must parse `WWW-Authenticate` and respond appropriately to `401`. `[MCP 2025-06-18, Authorization Server Location]`
- `Protected Resource Discovery`: Client must validate TLS and certificate checks when fetching PRM. `[RFC 9728 §7.1; RFC 9728 §7.3]`
- `Protected Resource Discovery`: Client must reject PRM unless the returned `resource` exactly matches the resource identifier used for discovery and, when discovered from `WWW-Authenticate`, the URL used to call the resource server. `[RFC 9728 §3.3; RFC 9728 §7.3]`
- `Protected Resource Discovery`: Client should defend PRM/AS discovery against SSRF. `[RFC 9728 §7.7]`
- `Authorization Server Discovery`: Authorization server must publish RFC 8414 metadata, and client must use it. `[MCP 2025-06-18, Overview; MCP 2025-06-18, Server Metadata Discovery]`
- `Authorization Server Discovery`: Client must derive the RFC 8414 well-known URL from the issuer identifier and fetch it with `GET`. `[RFC 8414 §3]`
- `Authorization Server Discovery`: Client must reject AS metadata whose returned `issuer` does not exactly match the issuer used for discovery. `[RFC 8414 §3.3; RFC 8414 §6.2]`
- `Dynamic Client Registration`: Client and authorization server should support RFC 7591 Dynamic Client Registration. `[MCP 2025-06-18, Dynamic Client Registration]`
- `Dynamic Client Registration`: If DCR is unavailable, client must use a pre-configured client registration or prompt the user for manually obtained client details. `[MCP 2025-06-18, Dynamic Client Registration]`
- `Dynamic Client Registration`: Registration endpoint must accept JSON `POST` over TLS. `[RFC 7591 §3.1; RFC 7591 §5]`
- `Dynamic Client Registration`: Registration endpoint should allow open registration for interoperability when policy permits. `[RFC 7591 §3.1]`
- `Dynamic Client Registration`: Redirect-based clients must register `redirect_uris`. `[RFC 7591 §2; RFC 6749 §3.1.2]`
- `Dynamic Client Registration`: Authorization servers that support dynamic registration for redirect-based flows must support `redirect_uris` metadata. `[RFC 7591 §2]`
- `Dynamic Client Registration`: Authorization server must return `201 Created` with `client_id`, and if it issues `client_secret`, it must also return `client_secret_expires_at`. `[RFC 7591 §3.2.1]`
- `Authorization Code Flow With PKCE`: Client must implement PKCE. `[MCP 2025-06-18, Authorization Code Protection]`
- `Authorization Code Flow With PKCE`: Authorization server must provide a way for clients to detect PKCE support. `[RFC 9700 §2.1.1]`
- `Authorization Code Flow With PKCE`: Client should use `S256` as the PKCE code challenge method. `[RFC 9700 §2.1.1]`
- `Authorization Code Flow With PKCE`: Client should not use implicit response types for MCP user authorization, and the password grant must not be used. `[RFC 9700 §2.1.2; RFC 9700 §2.4]`
- `Authorization Code Flow With PKCE`: `/authorize` request must include `response_type=code` and `client_id`. `[RFC 6749 §4.1.1]`
- `Authorization Code Flow With PKCE`: Client should send and verify `state`. `[RFC 6749 §4.1.1; MCP 2025-06-18, Open Redirection]`
- `Authorization Code Flow With PKCE`: `/authorize` request must include `resource`. `[MCP 2025-06-18, Resource Parameter Implementation]`
- `Authorization Code Flow With PKCE`: `/token` request must include `grant_type=authorization_code` and `code`. `[RFC 6749 §4.1.3]`
- `Authorization Code Flow With PKCE`: `/token` request must repeat the same `redirect_uri` if it was sent on `/authorize`. `[RFC 6749 §4.1.3; RFC 6749 §10.6]`
- `Authorization Code Flow With PKCE`: `/token` request must include `client_id` when the client is not authenticating at the token endpoint. `[RFC 6749 §4.1.3]`
- `Authorization Code Flow With PKCE`: `/token` request must include PKCE `code_verifier` and the AS must enforce it. `[MCP 2025-06-18, Authorization Code Protection; RFC 9700 §2.1.1]`
- `Authorization Code Flow With PKCE`: `/token` request must include `resource`. `[MCP 2025-06-18, Resource Parameter Implementation]`
- `Resource Indicator And Audience Binding`: Client must implement RFC 8707 Resource Indicators. `[MCP 2025-06-18, Resource Parameter Implementation]`
- `Resource Indicator And Audience Binding`: Client must send `resource` on both authorization and token requests, and it must identify the MCP server using its canonical URI. `[MCP 2025-06-18, Resource Parameter Implementation]`
- `Resource Indicator And Audience Binding`: `resource` must be an absolute URI and must not contain a fragment. `[RFC 8707 §2]`
- `Resource Indicator And Audience Binding`: `resource` should not contain a query component unless the query is part of the resource identity. `[RFC 8707 §2]`
- `Resource Indicator And Audience Binding`: Client should use the most specific canonical URI it can for the MCP server. `[MCP 2025-06-18, Canonical Server URI]`
- `Resource Indicator And Audience Binding`: Implementations should accept uppercase scheme and host components for robustness. `[MCP 2025-06-18, Canonical Server URI]`
- `Resource Indicator And Audience Binding`: Authorization server should audience-restrict tokens to the requested resource. `[RFC 8707 §2; RFC 9728 §7.4; RFC 9700 §2.3]`
- `Resource Indicator And Audience Binding`: MCP server must validate that tokens were issued specifically for it and reject audience mismatches. `[MCP 2025-06-18, Token Handling; MCP 2025-06-18, Token Audience Binding and Validation]`
- `Token Responses, Refresh, And Client Re-Authentication`: Token response must include `token_type`; client must not use a token type it does not understand. `[RFC 6749 §5.1; RFC 6749 §7.1]`
- `Token Responses, Refresh, And Client Re-Authentication`: Clients and servers must store tokens securely. `[MCP 2025-06-18, Token Theft]`
- `Token Responses, Refresh, And Client Re-Authentication`: Authorization servers should issue short-lived access tokens. `[MCP 2025-06-18, Token Theft]`
- `Token Responses, Refresh, And Client Re-Authentication`: Refresh tokens must be bound to consented scope/resource servers. `[RFC 9700 §4.14.2]`
- `Token Responses, Refresh, And Client Re-Authentication`: For public clients, authorization servers must rotate refresh tokens. `[MCP 2025-06-18, Token Theft]`
- `Token Responses, Refresh, And Client Re-Authentication`: If a new refresh token is issued, the client must discard the old one. `[RFC 6749 §6]`
- `Token Responses, Refresh, And Client Re-Authentication`: Refresh tokens should expire after client inactivity. `[RFC 9700 §4.14.2]`
- `Token Responses, Refresh, And Client Re-Authentication`: Client must treat `401` as a re-authentication trigger and restart discovery/authorization as needed. `[MCP 2025-03-26, Example: authorization code grant; MCP 2025-06-18, Authorization Server Location; MCP 2025-06-18, Token Handling]`
- `Server-Side Token Validation And Security Boundaries`: Server must validate token expiry, scope coverage, intended audience, and authorization-server ownership before serving the request. `[MCP 2025-06-18, Token Handling; RFC 6749 §7; RFC 9700 §2.3]`
- `Server-Side Token Validation And Security Boundaries`: Client must not send tokens from another authorization server, and the authorization server or server-side validation path must only accept tokens valid for its own resources. `[MCP 2025-06-18, Token Handling]`
- `Server-Side Token Validation And Security Boundaries`: Server must not accept or transit tokens issued for other resources. `[MCP 2025-06-18, Token Handling; MCP 2025-06-18, Access Token Privilege Restriction]`
- `Server-Side Token Validation And Security Boundaries`: Server must not pass through the client token to downstream APIs; downstream calls need separate upstream tokens. `[MCP 2025-06-18, Access Token Privilege Restriction]`
- `Redirect URI And Consent Security`: All authorization-server endpoints must be served over HTTPS. `[MCP 2025-06-18, Communication Security; MCP 2025-03-26, Security Considerations]`
- `Redirect URI And Consent Security`: Redirect URIs must be HTTPS or localhost/loopback, and authorization servers must use exact string matching except for localhost port variance in native loopback redirects. `[MCP 2025-06-18, Communication Security; RFC 9700 §2.1]`
- `Redirect URI And Consent Security`: Client must have registered redirect URIs, and authorization servers must validate exact redirect URI matches against the registered values. `[MCP 2025-06-18, Open Redirection; RFC 6749 §10.6; RFC 9700 §2.1]`
- `Redirect URI And Consent Security`: Authorization servers must take precautions against redirecting to untrusted URIs; they should auto-redirect only when the URI is trusted. `[MCP 2025-06-18, Open Redirection]`
- `Redirect URI And Consent Security`: MCP proxy servers using static client IDs must obtain user consent for each dynamically registered client before forwarding to third-party authorization servers. `[MCP 2025-06-18, Confused Deputy Problem]`
