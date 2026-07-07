# mcp-oauth-server

Production OAuth 2.1 authorization-server primitives for MCP applications.

The package provides:

- authorization code with mandatory PKCE `S256`
- RFC 8414 authorization-server metadata
- RFC 7591 dynamic registration for public MCP clients
- exact registered redirect URI validation
- RFC 8707 resource indicators and audience-bound JWT access tokens
- JWKS publication and short-lived `at+jwt` access tokens
- rotating refresh tokens with replay-triggered family revocation
- token and grant revocation
- asynchronous durable storage interfaces
- an application-owned browser authorization interaction
- CSRF, state, nonce, and secure cookie helpers
- a Toolcraft adapter through `createHTTPMCPAuthorization()` from `toolcraft/http`

## Availability

This package is bundled privately inside the published `toolcraft` package and
is supported through the `toolcraft/http` exports. It is not published as a
standalone npm package because that npm package name is owned outside this
repository.

## Quick Start

```ts
import { generateKeyPairSync } from "node:crypto";
import { exportJWK } from "jose";
import {
  createHTTPMCPAuthorization,
  createOAuthAuthorizationServer,
  runHTTPMCP,
  type AuthorizationInteraction,
  type AuthorizationServerStore
} from "toolcraft/http";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256"
});

const store: AuthorizationServerStore = createDurableStore();
const interaction: AuthorizationInteraction = {
  async start({ transaction }) {
    return renderApplicationAuthorizationPage(transaction);
  }
};

const authorizationServer = createOAuthAuthorizationServer({
  issuer: "https://auth.example.com",
  resources: ["https://mcp.example.com/mcp"],
  signingKey: {
    algorithm: "ES256",
    keyId: "2026-07",
    privateKey,
    publicJwk: await exportJWK(publicKey)
  },
  store,
  interaction
});

await runHTTPMCP(groups, {
  oauth: createHTTPMCPAuthorization({
    authorizationServer,
    resource: "https://mcp.example.com/mcp",
    requiredScopes: ["mcp.read"]
  }),
  requestServices(context) {
    if (context.auth === undefined) throw new Error("OAuth subject required");
    return {
      babyDaybook: loadBabyDaybookSession(context.auth.subject)
    };
  }
});
```

Route requests for `/.well-known/oauth-authorization-server`,
`/.well-known/jwks.json`, `/register`, `/authorize`, `/token`, and `/revoke`
to `authorizationServer.handle(request)` in the application HTTP framework.

## Application Authorization Interaction

`interaction.start({ request, transaction })` owns the browser experience. It
may render a login page, redirect to an upstream identity provider, or render a
one-time credential completion form. The application finishes the OAuth flow
only after authenticating its user:

```ts
const completion = await authorizationServer.completeAuthorization({
  transactionId,
  subject: applicationUserId,
  scopes: approvedScopes
});

return Response.redirect(completion.redirectUrl);
```

For an Apple `intent://callback?...` completion flow:

1. Generate the application CSRF token, upstream state, and nonce with
   `createAuthorizationInteractionSecurity()`.
2. Bind the upstream state to the pending authorization transaction in the
   application's durable store.
3. Render the callback paste form with the hidden CSRF token and returned
   `Set-Cookie` value.
4. On submission, bound the request body, verify CSRF with
   `verifyAuthorizationInteractionCsrf()`, validate the exact intent callback
   shape and state, and consume the application transaction once.
5. Exchange the one-time callback immediately. Never log or persist the
   callback, password, authorization code, access token, or refresh token in
   plaintext.
6. Persist only the encrypted upstream refresh session under the approved OAuth
   subject, then call `completeAuthorization()`.

The application credential is deliberately absent from all package APIs so it
cannot accidentally enter OAuth transaction or token storage.

## Durable Storage

Production deployments must implement `AuthorizationServerStore`. The
interface covers:

- dynamic clients
- browser authorization transactions
- authorization grants
- one-time authorization codes
- access-token revocation records
- refresh-token families

`takeAuthorizationTransaction()`, `takeAuthorizationCode()`, and
`rotateRefreshToken()` must be atomic. Refresh replay detection depends on the
store retaining rotated token-family relationships and revoking the family
when an old token is presented again.

`createInMemoryAuthorizationServerStore()` is intended for tests and local
development only. It is not durable and must not be used in production.

## Subject Isolation

The access token `sub` claim is the only identity passed to Toolcraft as
`context.auth.subject`. Application service lookup must require that subject
and load only credentials stored under the same subject. Do not fall back to a
shared environment credential when a subject session is missing.

Grant and token revocation use opaque identifiers and token hashes. Raw
authorization codes, access tokens, and refresh tokens are never stored by the
provided store contract.

## Security Requirements

- Terminate TLS before exposing any endpoint publicly.
- Keep signing private keys outside source control and rotate keys with an
  overlap period long enough for issued access tokens to expire.
- Use a durable store implementation with transactional or compare-and-swap
  semantics for one-time consumption and refresh rotation.
- Keep access-token lifetimes short. The default is five minutes.
- Set restrictive CSP, `Referrer-Policy: no-referrer`, and `Cache-Control:
  no-store` on application authorization pages.
- Require exact redirect URI matches. Do not add wildcard or prefix matching.
- Treat every OAuth subject as a separate security boundary.
- Encrypt application-owned upstream refresh tokens at rest with a
  production key-management service.
- Redact authorization headers, cookies, codes, callbacks, and tokens from
  logs and traces.

## Configuration

`createOAuthAuthorizationServer(options)` accepts:

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `issuer` | yes | none | HTTPS authorization-server issuer. Loopback HTTP is allowed for local development. |
| `resources` | yes | none | Exact protected resource identifiers accepted through the OAuth `resource` parameter. |
| `signingKey` | yes | none | Current `ES256` or `RS256` private key, public JWK, and key id. |
| `additionalPublicJwks` | no | `[]` | Previous public signing keys retained in JWKS during a key-rotation overlap. |
| `store` | yes | none | Durable `AuthorizationServerStore` implementation. |
| `interaction` | yes | none | Application-owned browser authorization hook. |
| `accessTokenTtlSeconds` | no | `300` | Signed access-token lifetime. |
| `authorizationCodeTtlSeconds` | no | `60` | One-time authorization-code lifetime. |
| `authorizationTransactionTtlSeconds` | no | `600` | Pending browser interaction lifetime. |
| `refreshTokenTtlSeconds` | no | `2592000` | Rotating refresh-token lifetime. |
| `maxRequestBodyBytes` | no | `65536` | Maximum DCR, token, and revocation request body size. |
| `now` | no | `Date.now` | Clock override for tests. |
| `randomToken` | no | cryptographic random | Opaque identifier generator override for tests. |

## Environment Variables

This package reads no environment variables. Signing keys, durable database
connections, encryption keys, issuer URLs, and protected resource identifiers
must be passed explicitly by the application.
