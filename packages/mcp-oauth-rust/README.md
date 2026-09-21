# mcp-oauth-rust

Independent Rust MCP OAuth with native Node bindings and zero external npm runtime
dependencies. This private additive package is under development.

PKCE helpers generate URL-safe verifiers from operating-system randomness and
compute S256 challenges in the reusable Rust core. UTF-16 inputs follow Node's
UTF-8 encoding rules, including lone surrogates. The core uses its own SHA-256
implementation, checked against standard vectors and seeded Node comparisons.

```ts
import { generateCodeVerifier, generateCodeChallenge } from "mcp-oauth-rust";
const verifier = generateCodeVerifier();
const challenge = generateCodeChallenge(verifier);
```

The Rust authorization-state core creates opaque nonce payloads and validates
issuer/flag fields. Its decoder preserves Node-compatible base64url and UTF-16
behavior. Host bindings supply operating-system randomness; protocol logic stays
in Rust.

Token exchange and refresh validate token fields and expiry in Rust, encode OAuth
form bodies and classify protocol errors. The host adapter bounds token responses
to 1 MiB, refuses redirects and uses a 30-second request deadline. Public
`OAuthError` instances preserve protocol fields and retry/terminal classification.

Loopback sessions use an ephemeral `127.0.0.1` port or your exact registered
HTTP redirect on `localhost`, `127.0.0.1` or `[::1]`. They support browser or pasted
callback input, caller cancellation and a configurable two-minute deadline. Rust enforces state/issuer binding before accepting codes
or denials and renders escaped success pages. Closing a session disposes its
listeners and rejects pending waits; close is idempotent and code waits are single-use.

Encrypted session and client-registration persistence uses the embedded Rust
credential store. URI-specific filenames and Keychain accounts match the original
package, including resource normalization and machine-bound encrypted documents.
Session admission and client-field projection run in Rust. The package ships these
capabilities in its own addon and has no runtime import of `auth-store`.

The default provider supports cached tokens, coalesced refresh/authorization,
static clients and dynamic registration. Its Rust effect machine owns expiry,
credential binding, endpoint security, registration plans, PKCE parameters and
bounded retry decisions. Host callbacks provide browser input, fetch and storage. Successful request
authorization returns an owned normalized token snapshot as well as attaching the
Authorization header.

```ts
import { createDefaultOAuthClientProvider } from "mcp-oauth-rust";
const provider = createDefaultOAuthClientProvider({
  client: { mode: "static", clientId: "my-client" },
  browser: {
    openBrowser: async (url) => {
      /* open your browser */
    }
  }
});
```

JWKS verification supports ES256/384/512, RS256/384/512, PS256/384/512 and EdDSA.
Rust validates protected headers, selects verification keys, enforces issuer,
expiry, clock tolerance, optional access-token type and required scopes, and owns
JWKS cache/refresh policy. Node's built-in WebCrypto supplies signature primitives.
Unknown key IDs trigger one coalesced refresh within the configured cooldown.
JWKS responses have a 1 MiB bound and configured fetch deadline; requests refuse
redirects and release body readers on failure or timeout.

```ts
import { createJwksTokenVerifier } from "mcp-oauth-rust";
const verifier = createJwksTokenVerifier({
  jwksUrl: "https://auth.example/keys",
  requireAccessTokenType: true
});
const accessToken = await verifier.verify({
  token: "signed-access-token",
  resource: "https://api.example/mcp",
  authorizationServers: ["https://auth.example"],
  requiredScopes: ["mcp.read"]
});
```

This package preserves application imports while the additive rewrite is developed.
Profile persistence, session transactions and
client/scope/refresh-outcome contracts are being reconciled with the evolving
original; full provider conformance is currently incomplete. Integration and
broader performance validation remain separate work.

`fetchMcpResponse` refuses redirects and cancels unexpected redirect bodies.
`readBoundedResponseText` enforces declared and actual byte limits, decodes strict
UTF-8 incrementally and releases reader locks/tracking entries on completion,
failure or abort. Length admission uses the allocation-free Rust core.
