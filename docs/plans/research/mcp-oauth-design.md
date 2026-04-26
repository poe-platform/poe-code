# MCP OAuth Package Layout

## 1. Decision

Choose option **(b)**: keep `packages/poe-oauth` as the Poe-specific preset and add a sibling `packages/mcp-oauth` package for MCP-spec-compliant OAuth primitives.

The trade-off is one more package and two new dependency edges (`tiny-mcp-client -> mcp-oauth` and `tiny-http-mcp-server -> mcp-oauth`), but it keeps the semantic boundary clean. Today `packages/poe-oauth/src/oauth-client.ts` is intentionally Poe-shaped: `buildAuthorizationUrl()` hard-codes `scope=apikey:create`, `exchangeCodeForApiKey()` expects `api_key` and `api_key_expires_in`, and the public `OAuthResult` is `{ apiKey, expiresIn }`. If we chose option **(a)**, the generic pieces in that file would need to move first: `generateCodeVerifier()`, `generateCodeChallenge()`, `startServer()`, `waitForAuthorizationCode()`, `extractCodeFromInput()`, and `buildSuccessPage()` would become shared PKCE/loopback helpers, while `buildAuthorizationUrl()`, `exchangeCodeForApiKey()`, and the exported result types would have to be rewritten around RFC 6749 access tokens and refresh tokens. `packages/opencode-poe-auth/src/poe-auth-plugin.ts` would then need to become a thin Poe preset on top of the new generic core. Option **(b)** avoids that churn, leaves the existing Poe login flow stable, and lets the new package be named and typed around MCP concepts from day one.

## 2. Public API Surface

### Client side

`packages/mcp-oauth` owns the transport-facing client contract. `tiny-mcp-client` only calls this interface; it does not implement discovery, DCR, PKCE, token exchange, or refresh itself.

```ts
export interface OAuthClientProvider {
  authorizeRequest(input: {
    requestUrl: URL;
    headers: Headers;
    fetch: typeof globalThis.fetch;
  }): Promise<void>;

  handleUnauthorized(input: {
    requestUrl: URL;
    response: Response;
    fetch: typeof globalThis.fetch;
  }): Promise<{ action: "retry" } | { action: "fail"; error?: Error }>;

  handleForbidden?(input: {
    requestUrl: URL;
    response: Response;
    fetch: typeof globalThis.fetch;
  }): Promise<{ action: "retry" } | { action: "fail"; error?: Error }>;
}

export interface StoredOAuthSession {
  resource: string;
  authorizationServer: string;
  client: {
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
  };
  tokens: {
    accessToken: string;
    refreshToken?: string;
    tokenType: "Bearer";
    expiresAt: number | null;
    scope?: string;
  };
  discovery: {
    resourceMetadataUrl: string;
    resourceMetadata: Record<string, unknown>;
    authorizationServerMetadata: Record<string, unknown>;
  };
}

export interface OAuthSessionStore {
  load(resource: string): Promise<StoredOAuthSession | null>;
  save(resource: string, session: StoredOAuthSession): Promise<void>;
  clear(resource: string): Promise<void>;
}

export interface DefaultOAuthClientProviderOptions {
  client:
    | {
        mode: "dynamic";
        metadata: OAuthClientMetadata;
      }
    | {
        mode: "static";
        clientId: string;
        redirectUri: string;
        clientSecret?: string;
        metadata?: Partial<OAuthClientMetadata>;
      };
  browser: {
    openBrowser(url: string): Promise<void>;
    readLine?: () => Promise<string>;
    createServer?: () => import("node:http").Server;
    landingPage?: { title: string; body: string };
  };
  sessionStore?: OAuthSessionStore;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export function createAuthStoreSessionStore(
  options?: import("auth-store").CreateSecretStoreInput
): OAuthSessionStore;

export function createDefaultOAuthClientProvider(
  options: DefaultOAuthClientProviderOptions
): OAuthClientProvider;
```

Notes:

- `authorizeRequest()` is the hot path. It loads the cached session, refreshes proactively when needed, and injects `Authorization: Bearer <access_token>`.
- `handleUnauthorized()` owns the full `401 -> WWW-Authenticate parse -> PRM -> AS metadata -> DCR or static client -> PKCE browser flow -> token exchange -> persist -> retry` path.
- `handleForbidden()` is optional so `tiny-mcp-client` can stay compatible with a first rollout that ships `401` handling before `403 insufficient_scope` upscoping.
- Runtime validation stays in plain TypeScript type guards inside `mcp-oauth`; no `zod`.
- If `mcp-oauth` later ships IdP presets, they must be plain declarative config objects passed into `createDefaultOAuthClientProvider()`, not provider-specific branching in the core flow.
- `createAuthStoreSessionStore()` reuses `packages/auth-store` by storing one JSON session document per canonical resource URI. No new persistence layer is introduced.

### Server side

`packages/mcp-oauth` also owns the resource-server primitives. `tiny-http-mcp-server` wires them in, but does not embed OAuth metadata generation or token-verification logic directly.

```ts
export interface OAuthMetadataRouterOptions {
  resource: string | URL;
  authorizationServers: readonly (string | URL)[];
  scopesSupported?: readonly string[];
  bearerMethodsSupported?: readonly string[];
  authorizationServerMetadata?: {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint?: string;
    response_types_supported?: readonly string[];
    grant_types_supported?: readonly string[];
    token_endpoint_auth_methods_supported?: readonly string[];
    code_challenge_methods_supported?: readonly string[];
  };
  registerProxy?: {
    target: string | URL;
    endpointPath?: string;
    headers?: HeadersInit;
  };
}

export interface OAuthMetadataRouter {
  readonly protectedResourceMetadataUrl: URL;
  handle(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse
  ): Promise<boolean>;
}

export interface VerifiedAccessToken {
  token: string;
  issuer: string;
  audience: readonly string[];
  scopes: readonly string[];
  expiresAt: number;
  claims: Record<string, unknown>;
  subject?: string;
  clientId?: string;
}

export interface TokenVerifier {
  verify(input: {
    token: string;
    resource: string;
    authorizationServers: readonly string[];
    requiredScopes: readonly string[];
  }): Promise<VerifiedAccessToken>;
}

export interface BearerAuthGuard {
  authorize(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse
  ): Promise<VerifiedAccessToken | null>;
  challenge(input?: {
    error?: "invalid_token" | "insufficient_scope";
    errorDescription?: string;
    scope?: readonly string[];
  }): string;
}

export function createOAuthMetadataRouter(
  options: OAuthMetadataRouterOptions
): OAuthMetadataRouter;

export function createBearerAuthGuard(options: {
  resource: string | URL;
  authorizationServers: readonly (string | URL)[];
  requiredScopes?: readonly string[];
  protectedResourceMetadataUrl: string | URL;
  verifier: TokenVerifier;
}): BearerAuthGuard;
```

Notes:

- `createOAuthMetadataRouter()` always serves the RFC 9728 protected-resource metadata endpoint for the configured canonical resource URI.
- The same router may also serve `/.well-known/oauth-authorization-server` when local AS metadata is supplied, and `/register` when `registerProxy` is configured.
- `createBearerAuthGuard()` is responsible for RFC-compliant `WWW-Authenticate: Bearer ... resource_metadata="..."` responses on missing or invalid credentials.
- `TokenVerifier` stays intentionally small. Signature validation, JWKS lookup, issuer-specific claim mapping, and token introspection remain application-owned.

## 3. Concrete File Paths

### `packages/mcp-oauth`

- `packages/mcp-oauth/package.json`
- `packages/mcp-oauth/README.md`
- `packages/mcp-oauth/src/index.ts`
- `packages/mcp-oauth/src/client/types.ts`
- `packages/mcp-oauth/src/client/runtime-guards.ts`
- `packages/mcp-oauth/src/client/www-authenticate.ts`
- `packages/mcp-oauth/src/client/discovery.ts`
- `packages/mcp-oauth/src/client/client-registration.ts`
- `packages/mcp-oauth/src/client/pkce.ts`
- `packages/mcp-oauth/src/client/loopback-authorization.ts`
- `packages/mcp-oauth/src/client/token-endpoint.ts`
- `packages/mcp-oauth/src/client/auth-store-session-store.ts`
- `packages/mcp-oauth/src/client/default-oauth-client-provider.ts`
- `packages/mcp-oauth/src/server/types.ts`
- `packages/mcp-oauth/src/server/runtime-guards.ts`
- `packages/mcp-oauth/src/server/metadata-router.ts`
- `packages/mcp-oauth/src/server/register-proxy.ts`
- `packages/mcp-oauth/src/server/bearer-auth-guard.ts`
- `packages/mcp-oauth/src/testing/test-authorization-server.ts`

### `packages/tiny-mcp-client`

- `packages/tiny-mcp-client/src/internal.ts`
- `packages/tiny-mcp-client/src/index.ts`
- `packages/tiny-mcp-client/src/http-oauth.test.ts`
- `packages/tiny-mcp-client/src/mcp-client-http-transport.integration.test.ts`

### `packages/tiny-http-mcp-server`

- `packages/tiny-http-mcp-server/src/http-server.ts`
- `packages/tiny-http-mcp-server/src/http-transport.ts`
- `packages/tiny-http-mcp-server/src/express-middleware.ts`
- `packages/tiny-http-mcp-server/src/cli.ts`
- `packages/tiny-http-mcp-server/src/load-oauth-verifier.ts`
- `packages/tiny-http-mcp-server/src/index.ts`
- `packages/tiny-http-mcp-server/src/oauth.test.ts`
- `packages/tiny-http-mcp-server/src/testing.ts`

### Reused as-is

- `packages/auth-store/src/create-secret-store.ts`
- `packages/auth-store/src/encrypted-file-store.ts`
- `packages/auth-store/src/keychain-store.ts`
- `packages/auth-store/src/provider-store.ts`
- `packages/poe-oauth/src/oauth-client.ts`
- `packages/poe-oauth/src/check-auth.ts`
- `packages/opencode-poe-auth/src/poe-auth-plugin.ts`

## 4. Wiring

### Client transport

- `tiny-mcp-client` adds `oauth?: OAuthClientProvider` to `HttpTransportOptions`. When omitted, `HttpTransport` behaves exactly as it does today.
- `packages/tiny-mcp-client/src/internal.ts` already centralizes all HTTP I/O in `fetchWithAbort()`, `consumeWrittenLines()`, `consumeGetSseStream()`, and `sendSessionTerminationRequest()`. That is the only place OAuth wiring belongs.
- Before each protected `POST`, `GET`, and `DELETE`, `HttpTransport` creates the request headers and calls `oauth.authorizeRequest(...)`. That is where the bearer token is added and where proactive refresh is allowed to happen.
- On a `401` from `POST` or `GET`, `HttpTransport` does not immediately throw from `throwForPostHttpError()`. Instead it parses `WWW-Authenticate`, extracts `resource_metadata` when present, and calls `oauth.handleUnauthorized(...)`. If the provider returns `{ action: "retry" }`, the transport retries the same request once with freshly authorized headers.
- If the `401` challenge is missing `resource_metadata`, the provider falls back to the path-aware RFC 9728 URL derived from the original request URL.
- `DELETE` uses the same header injection path, but shutdown stays best-effort: `dispose()` must not launch a new browser flow. A proactive refresh that is already in progress may complete before `DELETE`; a terminal `401` during session teardown is ignored.

### Token cache and refresh

- The default provider keeps a short-lived in-memory cache per canonical resource URI for the fast path.
- The durable store is `packages/auth-store`, wrapped by `createAuthStoreSessionStore()`. The stored payload is the JSON form of `StoredOAuthSession`.
- The default file backend should map each canonical resource URI to its own encrypted file under `.poe-code/mcp-oauth/<sha256(resource)>.enc`.
- The default keychain backend should use service `poe-code-mcp-oauth` and account `provider:<sha256(resource)>`.
- The canonical cache key is the `resource` value returned by PRM after validation, not the original request URL.
- Refresh is single-flight per canonical resource URI. If several requests notice an expiring token at once, they await the same refresh promise.
- Full interactive authorization is also single-flight per canonical resource URI. One request drives the browser flow; concurrent requests await the same result instead of spawning duplicate loopback servers or browser tabs.
- If refresh fails with a terminal OAuth error such as `invalid_grant`, the provider clears the persisted session from `auth-store` and falls back to a fresh authorization-code flow.

### Server composition

- `tiny-http-mcp-server` adds `oauth?: TinyHttpMcpServerOAuthOptions` to `createHttpServer()` options. When omitted, standalone HTTP mode and Express mode stay unchanged and the current stdio/HTTP test matrix still applies.
- In standalone mode, `packages/tiny-http-mcp-server/src/http-server.ts` gives the metadata router first chance to handle the request. If it returns `false`, normal MCP path routing continues.
- On the MCP path, `http-server.ts` runs the bearer-auth guard before `StreamableHttpTransport.handleRequest(...)`. When the guard returns `null`, it has already written the correct `401` or `403` response and request handling stops.
- `packages/tiny-http-mcp-server/src/express-middleware.ts` keeps `createExpressMiddleware(server)` untouched for the existing no-OAuth path.
- For OAuth deployments, add `createExpressOAuthHandlers({ path, server, oauth })`, returning `{ metadataMiddleware, mcpMiddleware }`.
- `metadataMiddleware` is mounted at the app root or at the same base path that corresponds to the canonical resource URI so it can serve `/.well-known/oauth-protected-resource...` and optional AS metadata routes.
- `mcpMiddleware` wraps the existing `createExpressMiddleware(server)` with the bearer-auth guard, so current Express users can opt in without changing their MCP handler code.

## 5. CLI / Config Surface For `tiny-http-mcp-server`

Programmatic API:

```ts
createHttpServer({
  name: "example-server",
  version: "1.0.0",
  oauth: {
    resource: "https://example.com/mcp",
    authorizationServers: ["https://auth.example.com"],
    requiredScopes: ["mcp.read"],
    scopesSupported: ["mcp.read", "mcp.write"],
    bearerMethodsSupported: ["header"],
    verifier,
    registerProxy: {
      target: "https://auth.example.com/register"
    }
  }
});
```

CLI flags:

- `--oauth-resource <uri>`: enables OAuth mode and sets the canonical protected resource URI.
- `--oauth-authorization-server <issuer>`: repeatable; at least one is required when `--oauth-resource` is set.
- `--oauth-required-scope <scope>`: repeatable; scopes enforced by the bearer-auth guard on MCP requests.
- `--oauth-supported-scope <scope>`: repeatable; values published in PRM `scopes_supported`.
- `--oauth-bearer-method <method>`: repeatable; values published in PRM `bearer_methods_supported`.
- `--oauth-verifier-module <path-or-file-url>`: required when `--oauth-resource` is set; loads the verifier implementation for CLI mode.
- `--oauth-verifier-export <name>`: optional; defaults to `default`.
- `--oauth-register-proxy-target <url>`: optional; when set, the metadata router also serves `/register` and proxies to that upstream endpoint.

Notes:

- `--path` still controls the local MCP handler mount path. `--oauth-resource` is the canonical public URI used for PRM, audience checks, and the auth-store cache key. It may differ from the local bind address when the server sits behind a reverse proxy.
- The programmatic API accepts a `TokenVerifier` function reference directly.
- The CLI loader in `packages/tiny-http-mcp-server/src/load-oauth-verifier.ts` should resolve relative paths, absolute paths, package specifiers, and `file:` URLs, then read the export named by `--oauth-verifier-export`.

## 6. Test Strategy Summary

### `packages/mcp-oauth`

- Unit-test all runtime guards with plain objects: `WWW-Authenticate` parsing, PRM documents, AS metadata, DCR responses, and token responses.
- Unit-test discovery, registration, token exchange, and refresh with mocked `fetch`; no real network.
- Unit-test `createAuthStoreSessionStore()` with `memfs` for the file backend and a mocked keychain command runner for the macOS backend.
- Unit-test the loopback authorization helper with mocked `openBrowser`, mocked callback server behavior, and deterministic PKCE inputs.

### `packages/tiny-mcp-client`

- Add focused transport tests for bearer-header injection, `401 -> handleUnauthorized -> retry`, and, when implemented, `403 insufficient_scope -> handleForbidden -> retry`.
- Keep all existing no-OAuth transport tests unchanged to prove OAuth is opt-in only.
- Add an integration test that pairs `tiny-mcp-client` with a protected `tiny-http-mcp-server` instance and the `mcp-oauth` test authorization server.
- Cover first-run authorization, warm-start token reuse from `auth-store`, refresh after expiry, and concurrent requests collapsing onto one refresh.

### `packages/tiny-http-mcp-server`

- Unit-test the standalone wiring with fake `IncomingMessage` / `ServerResponse`: PRM route, optional AS metadata route, register proxy, `401` challenge shape, `403 insufficient_scope`, and verifier invocation.
- Unit-test CLI verifier loading in `load-oauth-verifier.ts` with fixture modules.
- Extend `packages/tiny-http-mcp-server/src/testing.ts` so integration tests can boot a protected server and the test authorization server without duplicating setup.
- Add an integration test that drives the full path with `tiny-mcp-client`: unauthenticated call gets `401`, client discovers PRM, authorizes, retries successfully, and later refreshes successfully.

## Open Questions

- Should the first client rollout include `403 insufficient_scope` upscoping, or should the initial implementation ship `401` plus refresh and leave `handleForbidden()` unused until the follow-up task?
- Do we want the CLI verifier loader to stop at local paths, package specifiers, and `file:` URLs, or is remote `https:` module loading a real requirement that deserves a separate security review?
