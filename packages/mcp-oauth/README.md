# mcp-oauth

OAuth client primitives for MCP HTTP transports.

## Config

`createDefaultOAuthClientProvider(options)` accepts:

- `client`
  - `mode: "dynamic"` with optional `metadata`
  - `mode: "static"` with `clientId`, optional `clientSecret`, optional `metadata`
- `browser.openBrowser(url)`
- `browser.readLine()` optional
- `browser.createServer()` optional
- `browser.landingPage` optional
- `sessionStore` optional
- `authStore` optional `auth-store` backend config for the default session store
- `now()` optional clock override

`createJwksTokenVerifier(options)` accepts:

- `jwksUrl`
- `clockSkewSeconds` optional, defaults to `30`
- `allowedAlgorithms` optional asymmetric allow-list
- `fetch` optional override

`createAuthStoreSessionStore(options)` accepts the standard `auth-store` config.

## Environment Variables

None directly. When `authStore` is used, `auth-store` honors its own backend env var configuration.
