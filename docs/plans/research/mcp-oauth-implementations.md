# MCP OAuth Implementations Survey

This survey captures how MCP OAuth is implemented in the upstream SDKs and reference clients today, then maps the concrete integration seams inside this repo.

## Source snapshots

- TypeScript SDK client / v2 `main`: `modelcontextprotocol/typescript-sdk` at `7d7e62ccc876b1a144e456a47dae9949b9f68c36`
- TypeScript SDK server auth / v1.x: `modelcontextprotocol/typescript-sdk` at `bf1e022bd219f678b3865093d58595c6c8a67f1a`
- Python SDK: `modelcontextprotocol/python-sdk` `main` at `3d7b311de07aade1281d18aa7b04689a81ab8793`
- Inspector: `modelcontextprotocol/inspector` `main` at `adfcccca529088099d41d08459f55214bfb9b874`
- Local repo files inspected:
  - `packages/tiny-mcp-client/src/internal.ts`
  - `packages/tiny-http-mcp-server/src/http-server.ts`
  - `packages/tiny-http-mcp-server/src/http-transport.ts`
  - `packages/tiny-http-mcp-server/src/express-middleware.ts`
  - `packages/tiny-http-mcp-server/src/session.ts`

## Primary source links

- TypeScript SDK
  - https://github.com/modelcontextprotocol/typescript-sdk/blob/7d7e62ccc876b1a144e456a47dae9949b9f68c36/packages/client/src/client/auth.ts
  - https://github.com/modelcontextprotocol/typescript-sdk/blob/7d7e62ccc876b1a144e456a47dae9949b9f68c36/packages/client/src/client/streamableHttp.ts
  - https://github.com/modelcontextprotocol/typescript-sdk/blob/bf1e022bd219f678b3865093d58595c6c8a67f1a/src/server/auth/router.ts
  - https://github.com/modelcontextprotocol/typescript-sdk/blob/bf1e022bd219f678b3865093d58595c6c8a67f1a/src/server/auth/middleware/bearerAuth.ts
  - https://github.com/modelcontextprotocol/typescript-sdk/blob/bf1e022bd219f678b3865093d58595c6c8a67f1a/src/server/auth/providers/proxyProvider.ts
  - https://github.com/modelcontextprotocol/typescript-sdk/blob/7d7e62ccc876b1a144e456a47dae9949b9f68c36/docs/migration.md
  - https://github.com/modelcontextprotocol/typescript-sdk/blob/7d7e62ccc876b1a144e456a47dae9949b9f68c36/examples/shared/src/auth.ts
  - https://github.com/modelcontextprotocol/typescript-sdk/blob/7d7e62ccc876b1a144e456a47dae9949b9f68c36/examples/shared/src/authServer.ts
  - https://github.com/modelcontextprotocol/typescript-sdk/blob/7d7e62ccc876b1a144e456a47dae9949b9f68c36/examples/shared/src/authMiddleware.ts
- Python SDK
  - https://github.com/modelcontextprotocol/python-sdk/blob/3d7b311de07aade1281d18aa7b04689a81ab8793/src/mcp/client/auth/oauth2.py
  - https://github.com/modelcontextprotocol/python-sdk/blob/3d7b311de07aade1281d18aa7b04689a81ab8793/src/mcp/client/auth/utils.py
  - https://github.com/modelcontextprotocol/python-sdk/blob/3d7b311de07aade1281d18aa7b04689a81ab8793/src/mcp/server/auth/routes.py
  - https://github.com/modelcontextprotocol/python-sdk/blob/3d7b311de07aade1281d18aa7b04689a81ab8793/src/mcp/server/auth/provider.py
  - https://github.com/modelcontextprotocol/python-sdk/blob/3d7b311de07aade1281d18aa7b04689a81ab8793/src/mcp/server/auth/middleware/bearer_auth.py
- Inspector
  - https://github.com/modelcontextprotocol/inspector/blob/adfcccca529088099d41d08459f55214bfb9b874/client/src/lib/auth.ts
  - https://github.com/modelcontextprotocol/inspector/blob/adfcccca529088099d41d08459f55214bfb9b874/client/src/lib/oauth-state-machine.ts
  - https://github.com/modelcontextprotocol/inspector/blob/adfcccca529088099d41d08459f55214bfb9b874/client/src/lib/hooks/useConnection.ts
  - https://github.com/modelcontextprotocol/inspector/blob/adfcccca529088099d41d08459f55214bfb9b874/client/src/components/OAuthCallback.tsx
- Product docs
  - Cursor MCP overview: https://docs.cursor.com/en/context/model-context-protocol
  - Cursor CLI MCP docs: https://docs.cursor.com/cli/mcp
  - Cline remote MCP docs: https://docs.cline.bot/mcp/connecting-to-a-remote-server

## Executive summary

- The current TypeScript SDK has a fairly complete OAuth client stack for HTTP MCP transports, centered on `OAuthClientProvider`, `auth()`, and `StreamableHTTPClientTransport`.
- The current TypeScript story is split: `main` (v2) has the client OAuth stack but removed SDK-owned server auth; the maintained `v1.x` branch still contains `mcpAuthRouter`, `requireBearerAuth`, `ProxyOAuthServerProvider`, and the old server auth stack.
- The living v2 TypeScript server reference is the demo `better-auth` integration under `examples/shared`; the concrete SDK implementation of the server APIs named in this task is on `v1.x`.
- The current Python SDK still ships both sides: an HTTPX OAuth client and a server auth stack with route builders, handlers, provider protocols, and bearer-auth middleware. It is the best current reference for what a complete server implementation looks like.
- The Inspector is a browser reference client layered on top of the TypeScript client APIs. It stores tokens, client registration, code verifier, scope, and debug state in `sessionStorage`.
- This repo's `tiny-mcp-client` and `tiny-http-mcp-server` do not currently have upstream-style OAuth hooks. The main extension points are exactly the HTTP transport request/response paths called out below.

---

## TypeScript SDK: client implementation

### `OAuthClientProvider` interface

`OAuthClientProvider` in `packages/client/src/client/auth.ts` is an application-owned persistence and UX boundary. The transport and `auth()` orchestrator do not own storage.

| Member | Type | Notes |
| --- | --- | --- |
| `redirectUrl` | getter → `string \| URL \| undefined` | Provider supplies redirect URI. `undefined` for non-interactive flows. |
| `clientMetadataUrl?` | optional `string` property | URL-based client ID (SEP-991) when AS supports `client_id_metadata_document_supported`. |
| `clientMetadata` | getter → `OAuthClientMetadata` | Includes `redirect_uris`, grant types, auth method, optional scope. |
| `state?()` | `(): string \| Promise<string>` | OAuth `state` parameter. SDK sends it but does not verify on return. |
| `clientInformation()` | `(): OAuthClientInformationMixed \| undefined \| Promise<...>` | Loads pre-registered or DCR client credentials. |
| `saveClientInformation?(info)` | `(info): void \| Promise<void>` | Required if SDK-managed DCR persistence is wanted. |
| `tokens()` | `(): OAuthTokens \| undefined \| Promise<...>` | Loads saved tokens for the current session. |
| `saveTokens(tokens)` | `(tokens): void \| Promise<void>` | Persists access and refresh tokens. |
| `redirectToAuthorization(url)` | `(url): void \| Promise<void>` | SDK calls this when user must authorize. |
| `saveCodeVerifier(v)` | `(v): void \| Promise<void>` | Provider persists PKCE verifier before redirect. |
| `codeVerifier()` | `(): string \| Promise<string>` | Retrieved for code exchange after redirect. |
| `addClientAuthentication?(h, p, u, m?)` | optional | Overrides token-endpoint client auth. |
| `validateResourceURL?(serverUrl, resource?)` | optional → `Promise<URL \| undefined>` | Overrides RFC 8707 resource selection. |
| `invalidateCredentials?(scope)` | optional | `scope` is `'all' \| 'client' \| 'tokens' \| 'verifier' \| 'discovery'`. |
| `prepareTokenRequest?(scope?)` | optional → `URLSearchParams \| Promise<...> \| undefined` | Enables non-authorization-code grants like `client_credentials`. |
| `saveAuthorizationServerUrl?(url)` / `authorizationServerUrl?()` | optional pair | Persist/restore discovered AS URL across sessions. |
| `saveResourceUrl?(url)` / `resourceUrl?()` | optional pair | Persist/restore discovered resource URL. |
| `saveDiscoveryState?(state)` / `discoveryState?()` | optional pair | Persist/restore combined PRM + AS discovery results (`OAuthDiscoveryState`). |

Key ownership rules:

- **Redirect URI ownership** is entirely provider-side. The SDK reads `provider.redirectUrl` and the provider's `clientMetadata.redirect_uris` must already contain it.
- **State persistence** is provider-side. The SDK asks `state?()` for a value but does not verify the returned `state` against a stored value itself.
- **All storage** is the provider's responsibility. The SDK never writes disk, browser storage, or keychain.

### How authorization-required callbacks work

`StreamableHTTPClientTransport` accepts an `AuthProvider` (minimal) or an `OAuthClientProvider` (full). If an `OAuthClientProvider` is passed, the transport wraps it via `adaptOAuthProvider()`:

```typescript
// auth.ts
function adaptOAuthProvider(provider: OAuthClientProvider): AuthProvider {
    return {
        token: async () => (await provider.tokens())?.access_token,
        onUnauthorized: async ctx => handleOAuthUnauthorized(provider, ctx),
    };
}
```

`handleOAuthUnauthorized()` extracts `resource_metadata` and `scope` from `WWW-Authenticate`, then calls `auth(provider, ...)`. If `auth()` returns `AUTHORIZED`, the transport retries the request once. If it returns `REDIRECT`, `handleOAuthUnauthorized()` throws `UnauthorizedError`. The caller then has to complete browser auth out-of-band and later call `transport.finishAuth(code)`.

The SDK callback when auth is required is not a typed event. The callback is the provider's `redirectToAuthorization()` plus the transport throwing `UnauthorizedError` when interactive authorization is still in progress.

### `401 → PRM → AS → register → authorize → token` chain inside `StreamableHTTPClientTransport`

1. `_commonHeaders()` injects `Authorization: Bearer <token>` if `authProvider.token()` returns one.
2. If a response is `401` and an auth provider exists, the transport calls `extractWWWAuthenticateParams(response)` and caches `_resourceMetadataUrl` and `_scope`.
3. On the first attempt, the transport calls `authProvider.onUnauthorized({ response, serverUrl, fetchFn })`.
4. For OAuth providers, `onUnauthorized` runs `auth(provider, { serverUrl, resourceMetadataUrl, scope, fetchFn })`.
5. Inside `auth()`:
   a. Check `provider.discoveryState?.()` for cached discovery state. If found, skip discovery.
   b. Otherwise call `discoverOAuthServerInfo()` → PRM then AS metadata.
   c. Save discovery state via `provider.saveDiscoveryState?.()`.
   d. Determine effective scope via `determineScope()` (priority: WWW-Authenticate → PRM scopes → clientMetadata.scope; append `offline_access` if AS and client both support refresh).
   e. Check `provider.clientInformation()`. If absent, check URL-based client ID (`clientMetadataUrl` + `client_id_metadata_document_supported`). If absent, do DCR via `registerClient()` and call `provider.saveClientInformation?.()`.
   f. If an authorization code is available or the flow is non-interactive (`prepareTokenRequest`), call `fetchToken()`, save tokens, return `AUTHORIZED`.
   g. If a refresh token exists, call `refreshAuthorization()`. On success, return `AUTHORIZED`.
   h. Otherwise, call `startAuthorization()` to build the authorization URL with PKCE. Call `provider.saveCodeVerifier()` and `provider.redirectToAuthorization(url)`. Return `REDIRECT`.
6. If `auth()` returned `AUTHORIZED`, the transport retries the original request once.
7. If the retry still gets `401`, the transport throws `SdkError(ClientHttpAuthentication)`.
8. `finishAuth(code)` re-enters `auth()` with the cached `_resourceMetadataUrl` and `_scope`, so code exchange happens against the same AS context.

On `InvalidClient` or `UnauthorizedClient` errors from the AS, `auth()` invalidates all credentials via `provider.invalidateCredentials?.('all')` and retries the discovery + registration path once.

### `403 insufficient_scope` upscoping path

On `403`, if the transport has an `OAuthClientProvider` and `WWW-Authenticate` contains `error="insufficient_scope"`:

- Extract the new `scope` from `WWW-Authenticate`.
- Compare against the last header that triggered upscoping. If identical, circuit-break to prevent infinite loops.
- Call `auth()` again with the updated scope.
- If `AUTHORIZED`, retry the request once.

---

## TypeScript SDK: discovery, validation, and caching

### Protected Resource Metadata discovery

`discoverOAuthProtectedResourceMetadata()`:

- Tries path-aware discovery `/.well-known/oauth-protected-resource{path}` first.
- Falls back to root `/.well-known/oauth-protected-resource` on 4xx, 502, or CORS failure.
- Sends `MCP-Protocol-Version` header.
- Validates the body with `OAuthProtectedResourceMetadataSchema`.
- Does not maintain an internal HTTP cache. Does not respect HTTP cache headers.
- Resource validation (`checkResourceAllowed`) happens later in `selectResourceURL()`.

### Authorization Server Metadata discovery

`discoverAuthorizationServerMetadata()`:

- Builds an ordered candidate URL list via `buildDiscoveryUrls()`:
  1. `/.well-known/oauth-authorization-server`
  2. `/.well-known/openid-configuration`
  3. `/.well-known/openid-configuration{pathname}` (OIDC Discovery 1.0)
- Treats 4xx and 502 as "try next candidate".
- Validates the successful body with `OAuthMetadataSchema` or `OpenIdProviderDiscoveryMetadataSchema`.
- In browser environments, retries failing requests without custom headers to survive CORS preflight rejection.
- No explicit RFC 8414 `issuer` equality check found in the current TypeScript client code (shape is validated, but strict issuer matching is not enforced).

### Discovery-state caching

The SDK's caching model is opt-in and provider-owned:

- `auth()` calls `provider.discoveryState?.()` first. On cache hit, reuses saved AS URL and metadata.
- On partial cache (missing pieces), fetches what is missing and saves enriched state via `provider.saveDiscoveryState?.()`.
- Cached shape is `OAuthDiscoveryState` = `OAuthServerInfo` + optional `resourceMetadataUrl`.
- The SDK itself never writes to disk, browser storage, or keychain.

### Legacy fallback

`discoverOAuthServerInfo()` still falls back to `new URL("/", serverUrl)` as the authorization server if PRM discovery fails. This matches older MCP behavior and is still present in current client code.

---

## TypeScript SDK: server-side status (`main` vs `v1.x`)

### `main` (v2) current status

TypeScript SDK `main` does not contain `mcpAuthRouter`, `requireBearerAuth`, `ProxyOAuthServerProvider`, or related server exports. The repo's own migration guide confirms these were removed in v2. The recommended replacement is an external auth library such as `better-auth`.

There is no current TypeScript SDK implementation to inspect for:

- how `mcpAuthRouter` mounted `/.well-known/...` and `/register`
- how the old `requireBearerAuth` validated audience / scope / expiry
- how `ProxyOAuthServerProvider` behaved internally

### `v1.x` current maintained server auth implementation

The TypeScript server-side APIs named in this task still exist on `v1.x`, which remains the maintained v1 branch.

#### `mcpAuthRouter`

`mcpAuthRouter(options)` builds an Express router that mounts:

- `authorization_endpoint` at `/authorize`
- `token_endpoint` at `/token`
- metadata via `mcpAuthMetadataRouter(...)`
- `registration_endpoint` at `/register` only when `provider.clientsStore.registerClient` exists
- `revocation_endpoint` at `/revoke` only when `provider.revokeToken` exists

`createOAuthMetadata()` derives endpoint URLs from `issuerUrl` / `baseUrl` and advertises:

- `authorization_endpoint`
- `token_endpoint`
- `registration_endpoint` if DCR is enabled
- `revocation_endpoint` if revocation is enabled
- `response_types_supported = ["code"]`
- `code_challenge_methods_supported = ["S256"]`
- `grant_types_supported = ["authorization_code", "refresh_token"]`
- `token_endpoint_auth_methods_supported = ["client_secret_post", "none"]`

`mcpAuthMetadataRouter(...)` mounts:

- `/.well-known/oauth-protected-resource{resourcePath}` where `resourcePath` is the protected resource URL pathname, with `/` collapsing to the root form
- `/.well-known/oauth-authorization-server`

Both metadata handlers use CORS and only allow `GET, OPTIONS`. `mcpAuthRouter` is intended to be mounted at the application root.

#### `requireBearerAuth`

`requireBearerAuth({ verifier, requiredScopes = [], resourceMetadataUrl })` is Express middleware that runs before the MCP handler when installed that way by the application.

Validation order:

1. Read `Authorization` header.
2. Require `Bearer <token>` format.
3. Call `verifier.verifyAccessToken(token)`.
4. Check that every `requiredScopes` entry is present in `authInfo.scopes`.
5. Check that `authInfo.expiresAt` is a number.
6. Check that `authInfo.expiresAt >= now`.
7. Attach `req.auth = authInfo` and call `next()`.

Error behavior:

- `401 invalid_token` for missing header, malformed header, missing expiry, or expired token.
- `403 insufficient_scope` for missing required scopes.
- Adds `WWW-Authenticate: Bearer ...`.
- Includes `scope="..."` when scopes are required.
- Includes `resource_metadata="..."` when `resourceMetadataUrl` is configured.

Audience/resource behavior:

- The middleware itself does **not** validate audience or RFC 8707 resource binding.
- `AuthInfo` does have an optional `resource?: URL` field, but `requireBearerAuth` never compares it against the current MCP resource URL.
- Any audience/resource validation must therefore happen inside `verifier.verifyAccessToken(...)` before it returns `AuthInfo`.

#### `ProxyOAuthServerProvider`

`ProxyOAuthServerProvider` is the v1.x adapter for delegating OAuth server behavior to an upstream AS:

- `clientsStore.getClient` delegates to caller-supplied `getClient`
- `clientsStore.registerClient` proxies `POST /register` when `registrationUrl` is configured
- `authorize(...)` redirects to upstream `authorizationUrl` with `client_id`, `response_type=code`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, plus optional `state`, `scope`, and `resource`
- `exchangeAuthorizationCode(...)` proxies `POST tokenUrl` with authorization-code fields
- `exchangeRefreshToken(...)` proxies `POST tokenUrl` with refresh-token fields
- `verifyAccessToken(...)` delegates to caller-supplied `verifyAccessToken`
- optional `revokeToken(...)` proxies `POST revocationUrl`

Important PKCE detail: `skipLocalPkceValidation = true`, so the token handler skips local challenge verification and forwards `code_verifier` upstream. The normal token handler does local PKCE validation unless the provider opts out.

### Current TypeScript server reference: `examples/shared`

The demo is split across `examples/shared/src/{auth,authServer,authMiddleware}.ts`.

What it does:

- Creates a `better-auth` instance with the MCP plugin.
- Enables DCR via `allowDynamicClientRegistration: true`.
- Mounts the plugin handler at `/api/auth/{*splat}`.
- Exposes `/.well-known/oauth-authorization-server` explicitly.
- Exposes PRM at `/.well-known/oauth-protected-resource{resourcePath}` (default `/mcp`) via `createProtectedResourceMetadataRouter()`.

What the demo bearer middleware does:

- Requires `Authorization: Bearer ...`.
- Calls `verifyAccessToken()` → `better-auth.getMcpSession()`.
- On failure: `401` with `WWW-Authenticate: Bearer error="invalid_token"`.
- On missing scopes: `403` with `error="insufficient_scope"` and `scope="..."`.
- If `resourceMetadataUrl` is configured: includes `resource_metadata="..."` in the challenge.

Notable gap: audience/resource binding is not enforced. `strictResource` mode logs a warning and skips validation because `getMcpSession` does not expose the resource in the session object.

---

## Python SDK: client and server implementation

The Python SDK ships both sides and is the best current living reference for a complete server auth stack.

### Client side

`src/mcp/client/auth/oauth2.py` implements `OAuthClientProvider` as an `httpx.Auth` subclass.

Storage is abstracted behind the `TokenStorage` protocol:

```python
class TokenStorage(Protocol):
    async def get_tokens() -> OAuthToken | None: ...
    async def set_tokens(tokens: OAuthToken): ...
    async def get_client_info() -> OAuthClientInformationFull | None: ...
    async def set_client_info(client_info: OAuthClientInformationFull): ...
```

In-memory, file-based, and database implementations all satisfy this protocol via duck typing.

`OAuthClientProvider` fields:

- `server_url`, `client_metadata`, `storage`
- optional `redirect_handler(url)` → sends user to auth page
- optional `callback_handler()` → returns `(authorization_code, state)`
- optional `client_metadata_url` for URL-based client ID
- optional `validate_resource_url` override

The `async_auth_flow(request)` generator runs the same high-level chain as the TypeScript SDK (try token → send → on 401 discover → register → authorize → exchange → retry; on 403 upscope → retry). Key differences from TypeScript:

- Callback handling is explicit: `redirect_handler` + `callback_handler` are injected, not `redirectToAuthorization` + `finishAuth`.
- Refresh logic is inline inside the auth flow generator.
- All state is held in an `OAuthContext` dataclass per-call (no long-lived transport-level cache to populate).

### Server side

Routes mounted by the Python server auth stack:

- `/.well-known/oauth-authorization-server`
- `/authorize`
- `/token`
- `/register` (when DCR enabled)
- `/revoke` (when revocation enabled)
- `/.well-known/oauth-protected-resource{resourcePath}`

Token validation before the MCP handler:

- `BearerAuthBackend` (Starlette `AuthenticationBackend`) extracts the bearer token and calls `TokenVerifier.verify_token(token)` → `AccessToken | None`.
- `RequireAuthMiddleware` checks required scopes before forwarding to the MCP app.
- `AccessToken` includes: `token`, `client_id`, `scopes: list[str]`, `expires_at: int | None`, `resource: str | None`.
- Explicit `expires_at` check is present.
- There is no built-in audience/resource check in the generic middleware. Audience validation is expected in the concrete `TokenVerifier` implementation, which has access to the `resource` field.

`OAuthServerProvider` protocol — the methods a server implementation must supply:

```python
async def get_client(client_id) -> OAuthClientInformationFull | None
async def register_client(client_info)
async def authorize(client, params) -> str  # redirect URL, may delegate to 3rd-party AS
async def load_authorization_code(client, code) -> AuthorizationCode | None
async def exchange_authorization_code(client, code) -> OAuthToken
async def load_refresh_token(client, token) -> RefreshToken | None
async def exchange_refresh_token(client, refresh_token, scopes) -> OAuthToken
async def load_access_token(token) -> AccessToken | None
async def revoke_token(token)
```

The token handler enforces PKCE: it computes `base64url(sha256(code_verifier))` and compares against the stored `code_challenge`.

The Python server uses `RequireAuthMiddleware` wrapping `BearerAuthBackend`, which means Bearer validation runs as Starlette ASGI middleware before any route handler fires.

---

## Python vs TypeScript client: comparison

| Aspect | TypeScript | Python |
| --- | --- | --- |
| Token storage | Provider-owned optional methods on `OAuthClientProvider` | Explicit `TokenStorage` protocol (separate from provider) |
| 401 handling | `onUnauthorized` callback from transport; `auth()` called externally | Inline in `async_auth_flow` generator; transport is the auth provider |
| Redirect + callback | `redirectToAuthorization()` + out-of-band `finishAuth(code)` | `redirect_handler(url)` + `callback_handler() → (code, state)` injected at construction |
| Discovery caching | Optional provider methods (`saveDiscoveryState` / `discoveryState`) | Per-call `OAuthContext` dataclass; no cross-call cache without custom storage |
| Extensibility | Many optional interface methods; custom grant via `prepareTokenRequest` | Fixed handlers; grant type locked to authorization_code + refresh |
| Resource indicator (RFC 8707) | Included when PRM available; `validateResourceURL` override | Included when protocol version ≥ 2025-06-18 or PRM present |
| PKCE | S256 via `pkce-challenge` library | S256 via `hashlib.sha256`; 128-char verifier |
| Client auth method selection | `selectClientAuthMethod()` → basic → post → none | Based on `token_endpoint_auth_method` in client metadata |

---

## Inspector: how the reference browser client drives OAuth

The Inspector uses the TypeScript client APIs but owns persistence and UX in the browser.

### Storage model

`sessionStorage`, keyed by server URL: `[${serverUrl}] ${baseKey}`.

Persisted items: tokens, dynamically registered client info, pre-registered client info, code verifier, current server URL, discovered scope, debug-only server metadata snapshot.

### `InspectorOAuthClientProvider`

- `redirectUrl` = `window.location.origin + "/oauth/callback"`
- `clientMetadata.redirect_uris` includes both `/oauth/callback` and `/oauth/callback/debug`
- `token_endpoint_auth_method` = `"none"` (public client)
- Grant types: `authorization_code` + `refresh_token`
- `state()` delegates to `generateOAuthState()`
- `redirectToAuthorization(url)` validates the URL then assigns `window.location.href`

### Automatic connection path (`useConnection.ts`)

On connection, the Inspector manually injects `Authorization: Bearer <token>` from the provider's stored tokens if the user has not overridden Authorization headers.

On auth failure, `handleAuthError()`:

1. Discovers scope via `discoverScopes()` if needed.
2. Saves scope to `sessionStorage`.
3. Creates a fresh `InspectorOAuthClientProvider`.
4. Calls `auth(provider, { serverUrl, scope, fetchFn? })`.
5. On `AUTHORIZED`, retries the connection.

On disconnect, explicitly clears tokens, client info, and code verifier from the provider.

### Manual debugger path (`oauth-state-machine.ts`)

Six explicit steps, each a state in a state machine:

1. **metadata_discovery** — discover PRM, derive AS URL, discover AS metadata.
2. **client_registration** — DCR or reuse existing client info.
3. **authorization_redirect** — `startAuthorization()` + `provider.saveCodeVerifier()` + display URL.
4. **authorization_code** — user pastes the code from the redirect.
5. **token_request** — `exchangeAuthorization()` + `provider.saveTokens()`.
6. **complete** — terminal.

This is the clearest step-by-step representation of what the SDK does automatically during a normal `auth()` call.

### Callback path (`OAuthCallback.tsx`)

- Parses callback params from `window.location.search`.
- Loads saved server URL from `sessionStorage`.
- Recreates `InspectorOAuthClientProvider`.
- Calls `auth(provider, { serverUrl, authorizationCode })`.
- On success, triggers reconnect.

---

## Cursor and Cline: documented MCP HTTP/OAuth behavior

Product-facing documentation, links only:

- Cursor MCP overview: https://docs.cursor.com/en/context/model-context-protocol — documents SSE and Streamable HTTP as remote transports using OAuth.
- Cursor CLI MCP: https://docs.cursor.com/cli/mcp — documents `cursor-agent mcp login <identifier>` for authenticating configured MCP servers.
- Cline remote server: https://docs.cline.bot/mcp/connecting-to-a-remote-server — recommends Streamable HTTP for remote MCP, documents OAuth 2.1 browser auth, and shows a user-visible "Authenticate" flow after connection failure.

All three align on the same pattern: attempt connection first → if auth required surface a login affordance → open browser → cache result across sessions.

---

## Claude Code integration in this repo

No embedded OAuth/MCP HTTP implementation found. What exists is config and spawn support for Claude Code as an MCP consumer:

- `packages/agent-defs/src/agents/claude-code.ts` — agent identity and config path metadata.
- `packages/agent-spawn/src/configs/claude-code.ts` — injects MCP config at spawn time via `--mcp-config`.
- `packages/agent-mcp-config/src/configs.ts` — writes persistent Claude Code MCP config under `~/.claude.json` key `mcpServers`.
- `packages/agent-spawn/src/configs/mcp.ts` — serializes spawn-time MCP server config.

For this repo, "Claude Code MCP integration" is config serialization and CLI wiring, not an OAuth-capable HTTP MCP client.

---

## Repo plug-in points: `tiny-mcp-client`

### What exists today

`HttpTransport` lives at `packages/tiny-mcp-client/src/internal.ts:2301` (class declaration) with the constructor at ~2320.

Constructor accepts:

```typescript
interface HttpTransportOptions {
  url: string;
  headers?: HeadersInit;   // static; merged into every request
  fetch?: HttpTransportFetch;
}
```

Request headers are assembled per-request in three private methods:

- `createPostHeaders()` (~2425) — merges constructor headers, sets `Accept`, `Content-Type`, `Mcp-Session-Id`.
- `createGetHeaders()` (~2435) — merges constructor headers, sets `Accept`, `Mcp-Session-Id`, `Last-Event-ID`.
- `createDeleteHeaders(sessionId)` (~2447) — merges constructor headers, sets `Mcp-Session-Id`.

Error handling: `throwForPostHttpError()` (~2523) treats any `>= 400` response as fatal. No `401` special-case, no retry.

Existing tests (`transports.test.ts:187-260`) confirm that static `Authorization: Bearer token-123` in constructor `headers` is forwarded correctly on all three request types. Dynamic refresh is not tested and not implemented.

### Where OAuth would plug in

| Location | Line approx. | What to add |
| --- | --- | --- |
| `HttpTransportOptions` | 2301 | `auth?: AuthProvider` option alongside static `headers` |
| `createPostHeaders()` | 2425 | `await authProvider.token()` → inject `Authorization: Bearer` |
| `createGetHeaders()` | 2435 | Same |
| `createDeleteHeaders()` | 2447 | Same (optional) |
| `consumeWrittenLines()` | ~2400 | After `throwForPostHttpError()`: if `401`, call `authProvider.onUnauthorized({response, serverUrl, fetchFn})`, then retry once |
| `consumeGetSseStream()` | ~2500 | Same `401 → re-auth → retry once` path |
| Transport state fields | ~2310 | Add `_resourceMetadataUrl`, `_scope`, `_lastUpscopingHeader` for `finishAuth()` parity |

The transport itself should not become a persistence layer. The auth provider (an `OAuthClientProvider`-shaped object or a simpler `{ token(): Promise<string | undefined>; onUnauthorized(ctx): Promise<void> }`) should own storage.

---

## Repo plug-in points: `tiny-http-mcp-server`

### What exists today

`packages/tiny-http-mcp-server/src/http-server.ts`:

- `listenHttp()` creates a Node.js `http.createServer`.
- Only routes exact `path` matches (default `/mcp`). All other paths get `404` immediately (~line 129).
- Calls `transport.handleRequest(req, res)` (~line 135) with no pre-flight checks.

`packages/tiny-http-mcp-server/src/http-transport.ts`:

- `handleRequest(req, res)` (~line 49) dispatches by method: `POST → handlePost`, `GET → handleGet`, `DELETE → handleDelete`, else `405`.
- No auth middleware, no pre-handler hook, no well-known metadata routing.
- `req.headers` is accessible in all three handler methods (confirmed: `readSessionId()` ~line 264 reads `req.headers["mcp-session-id"]`).

`packages/tiny-http-mcp-server/src/express-middleware.ts`:

- `createExpressMiddleware(server)` returns a minimal Express `RequestHandler` that calls `server.handleRequest(req, res)`.

`packages/tiny-http-mcp-server/src/session.ts`:

- `Session` interface has only `{ id, initialized, createdAt }`. No auth context slot.

### Where OAuth/resource-server support would plug in

| Location | File | What to add |
| --- | --- | --- |
| Extra routes | `http-server.ts:~125` | Router or explicit handlers for `/.well-known/oauth-protected-resource{path}`, optionally `/.well-known/oauth-authorization-server`, `/register` |
| Pre-dispatch auth gate | `http-transport.ts:49` | At the top of `handleRequest()`, before the `switch (req.method)`, validate bearer token and return `401`/`403` early |
| Bearer validation | `http-transport.ts` | New `verifyBearer(req): Promise<AuthInfo | null>` helper; reads `req.headers.authorization`, checks token validity/expiry/scopes |
| `WWW-Authenticate` generation | `http-transport.ts` | Extend `respondWithStatus()` or add `respondUnauthorized()` helper that emits `Bearer error="..."`, `scope=...`, `resource_metadata=...` |
| Auth context propagation | `session.ts:7` | Add optional `authInfo?: AuthInfo` to `Session` interface so tool handlers can access token claims |
| Express middleware path | `express-middleware.ts:7` | Insert bearer auth Express middleware before `server.handleRequest()` for apps using Express |

The auth gate in `handleRequest()` must fire before `handlePost()`, `handleGet()`, and `handleDelete()`, otherwise session-existence semantics leak through before auth is established.

### Practical split

Following upstream direction:

- `tiny-mcp-client` — client-side OAuth orchestration and retry hooks.
- `tiny-http-mcp-server` — resource-server bearer validation and PRM routing.
- External auth server (or a separate optional package) — `/authorize`, `/token`, DCR; only if this repo wants to embed an AS rather than rely on an external one.

---

## Bottom line

- For client-side parity with the current TypeScript ecosystem, model after `OAuthClientProvider`, `auth()`, and `StreamableHTTPClientTransport` on `typescript-sdk` `main`.
- For TypeScript server-side parity with the APIs named in this task, the concrete implementation is on `typescript-sdk` `v1.x`; `main` removed that layer in v2.
- For a still-maintained full server stack with the same concepts on `main`, the Python SDK remains the clearest source of truth because it still ships route builders, token verification middleware, and provider protocols together.
- The concrete extension seams in this repo are:
  - `packages/tiny-mcp-client/src/internal.ts:2301` — `HttpTransport` constructor, `createPostHeaders`, `createGetHeaders`, `throwForPostHttpError`
  - `packages/tiny-http-mcp-server/src/http-transport.ts:49` — top of `handleRequest()` before the method switch
  - `packages/tiny-http-mcp-server/src/http-server.ts:~125` — routing layer for well-known endpoints
  - `packages/tiny-http-mcp-server/src/express-middleware.ts:7` — middleware insertion point for Express-hosted servers
