# mcp-oauth-server-rust

Rust MCP authorization server with native Node bindings and zero npm runtime
dependencies. Register public clients, request consent, issue ES256 or RS256 access
tokens, rotate refresh tokens, revoke grants and verify resource-bound credentials.
This private package is an additive alternative to `mcp-oauth-server`.

```ts
import {
  createInMemoryAuthorizationServerStore,
  createAuthorizationInteractionSecurity,
  verifyAuthorizationInteractionCsrf
} from "mcp-oauth-server-rust";

const store = createInMemoryAuthorizationServerStore();
const security = createAuthorizationInteractionSecurity();
const accepted = verifyAuthorizationInteractionCsrf({
  cookieHeader: "__Host-mcp_oauth_csrf=opaque-token",
  submittedToken: "opaque-token"
});
```

The store consumes authorization transactions/codes once, rotates refresh tokens
atomically and revokes their family on replay. Returned records are independent
copies. Node's built-in clone/serialization primitives preserve optional undefined
fields and typed values; Rust owns record retention and revocation decisions.

CSRF helpers produce host-bound HttpOnly, Secure, SameSite=Lax cookies and compare
submitted UTF-8 token bytes using the platform's timing-safe primitive.

The in-memory store retains records for its lifetime, including replay history;
use a persistent store with an application retention policy for production.
Existing packages and application imports remain unchanged.

Create a server with your consent interaction and storage adapter:

```ts
import { generateKeyPairSync } from "node:crypto";
import { createOAuthAuthorizationServer } from "mcp-oauth-server-rust";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const server = createOAuthAuthorizationServer({
  issuer: "https://auth.example",
  resources: ["https://api.example/mcp"],
  scopesSupported: ["read"],
  signingKey: {
    algorithm: "ES256", keyId: "current", privateKey,
    publicJwk: publicKey.export({ format: "jwk" })
  },
  store,
  interaction: {
    start: ({ transaction }) => new Response(`Consent for ${transaction.clientId}`)
  }
});
const response = await server.handle(request);
// After authenticating the user and validating consent/CSRF:
const result = await server.completeAuthorization({ transactionId, subject: userId });
```

| Endpoint | Purpose |
| --- | --- |
| `/.well-known/oauth-authorization-server` | Authorization metadata |
| `/.well-known/jwks.json` | Public verification keys |
| `/register` | Public client registration |
| `/authorize` | Authorization-code consent with S256 PKCE |
| `/token` | Code exchange and refresh-token rotation |
| `/revoke` | Token and associated grant revocation |

Rust owns request admission, protocol errors, PKCE hashing, token plans and JWT claim
policy. Node built-ins supply HTTP objects, URL parsing, storage callbacks and
cryptographic signing/verification. Request bodies have configured byte limits;
cancellation releases readers without waiting for a stalled underlying cancel.

`verifyAccessToken(token, resource)` checks the signature, issuer, audience, token
type and retained authorization record. `denyAuthorization(transactionId)` returns
a denial redirect; `revokeGrant(grantId)` revokes associated credentials.

Native artifacts are currently validated on the development platform. Broader
platform packaging and performance measurements remain in progress.
