# mcp-oauth

OAuth client primitives for MCP HTTP transports.

## Usage

```ts
import {
  createAuthStoreSessionStore,
  createDefaultOAuthClientProvider,
  createJwksTokenVerifier
} from "mcp-oauth";

const provider = createDefaultOAuthClientProvider({
  client: { mode: "dynamic" },
  browser: { openBrowser: async (url) => console.log(url) },
  sessionStore: createAuthStoreSessionStore({ serviceName: "mcp-client" })
});

const verifier = createJwksTokenVerifier({
  jwksUrl: "https://example.com/.well-known/jwks.json"
});
```

## Public API

- `createDefaultOAuthClientProvider(options)`: default MCP OAuth client provider with dynamic or static client registration.
- `createOAuthClientProvider(options)`: lower-level provider constructor.
- `createAuthStoreSessionStore(options)`: persisted OAuth session store backed by `auth-store`.
- `createLoopbackAuthorizationSession(options)`: local callback server for browser authorization.
- `generateCodeVerifier()` and `generateCodeChallenge(...)`: PKCE helpers.
- `canonicalizeResourceIndicator(value)`: resource indicator canonicalization.
- `createJwksTokenVerifier(options)`: JWKS-backed access-token verifier for MCP servers.
- `OAuthError`: token endpoint error type.

## Configuration

`createDefaultOAuthClientProvider(options)` accepts:

- `client`
  - `mode: "dynamic"` with optional `metadata`
  - `mode: "static"` with `clientId`, optional `clientSecret`, optional `metadata`
- `allowInteractive: false` prevents interactive login while retaining cached tokens and silent refresh
- `browser.openBrowser(url)` optional
- `browser.readLine()` optional
- `browser.createServer()` optional
- `browser.landingPage` optional
- `browser.redirectUri` optional exact registered HTTP loopback callback with a fixed port
- `browser.signal` optional cancellation signal
- `browser.timeoutMs` optional authorization deadline (default 120,000 ms)
- `sessionStore` optional
- `authStore` optional `auth-store` backend config for the default session store
- `now()` optional clock override

`createJwksTokenVerifier(options)` accepts:

| Option                   | Type                | Default        | Description                                                                              |
| ------------------------ | ------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `jwksUrl`                | `string \| URL`     | none           | Authorization server JWKS endpoint.                                                      |
| `clockSkewSeconds`       | `number`            | `30`           | Allowed JWT time-claim clock skew.                                                       |
| `allowedAlgorithms`      | `readonly string[]` | asymmetric set | Allowed JWT signature algorithms.                                                        |
| `jwksCacheTtlMs`         | `number`            | `300000`       | Successful JWKS cache lifetime.                                                          |
| `jwksFetchTimeoutMs`     | `number`            | `5000`         | Timeout for each JWKS HTTP fetch.                                                        |
| `jwksRefreshCooldownMs`  | `number`            | `30000`        | Minimum interval between forced refreshes after an unknown key id.                       |
| `allowInsecureJwks`      | `boolean`           | `false`        | Permit non-HTTPS JWKS URLs. Loopback HTTP URLs are allowed without enabling this option. |
| `requireAccessTokenType` | `boolean`           | `false`        | Require the JWT `typ` protected header to be `at+jwt`.                                   |
| `fetch`                  | `typeof fetch`      | global `fetch` | Custom fetch implementation.                                                             |

Fixed redirects support `localhost`, `127.0.0.1`, and `::1` over HTTP. Their
exact spelling, port, path and query are preserved through registration,
authorization and code exchange. Credentials, fragments, port zero and reserved
OAuth callback query parameters are rejected before binding a listener. Omit
`redirectUri` to allocate a random loopback port. Standalone callback sessions
accept the same `redirectUri`, `signal` and `timeoutMs` options. Cancellation,
timeout and explicit close settle pending code waits and release listeners.
Always close a successful standalone session in `finally`.

Configure `client.metadata.scope` to request a precise scope set; broader
discovery metadata does not override it.

`createAuthStoreSessionStore(options)` accepts the standard `auth-store` config.

## Environment Variables

This package exposes no direct environment variables. When `authStore` is used,
`auth-store` honors its own backend environment variables.
