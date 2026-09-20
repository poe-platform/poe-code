# mcp-oauth-server-rust

Rust authorization-server primitives with native Node bindings and zero npm runtime
dependencies. This private additive rewrite currently provides credential records,
refresh-token rotation/replay protection, grant/token revocation and CSRF helpers.
Authorization endpoints and signed token issuance are still being implemented.

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
