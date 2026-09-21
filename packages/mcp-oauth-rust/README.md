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
form bodies and classify protocol errors. Token helpers support public clients,
POST secrets and HTTP Basic authentication with form-encoded credentials.
Explicit public-client authentication never sends an available secret. Caller
cancellation combines with the request deadline. Scope sets reject invalid syntax,
retain case, sort and deduplicate printable ASCII tokens. Token-response scopes
must be nonempty when supplied; invalid scopes reject after expiry validation. The host adapter bounds token responses
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
Imported grants retain their original client and resource, anchor relative lifetimes at import,
and yield to persisted rotations and revocations.
`parseOAuthTokenGrant(raw, { issuedAt, expiresAt, now })` admits bounded raw
Bearer responses, validates every supplied timing field, anchors relative expiry
once and returns independent normalized credentials. Absolute overrides retain
precedence while invalid overridden timing still rejects. Clock callback failures
preserve their original cause.
Optional persistence namespaces isolate profiles sharing a resource or issuer.
Session transactions use the backing credential lock across independent provider instances.
Session admission runs in Rust and client registration loads retain all validated metadata.
Malformed stored JSON reports an explicit recovery error. The package ships these
capabilities in its own addon and has no runtime import of `auth-store`.

`parseOAuthClientRegistration` returns an owned copy of full RFC 7591 metadata,
including provider JSON extensions. It validates known fields without invoking
accessors or serialization hooks, with a 64 KiB UTF-8 limit, depth 64 and
20,000 values. String ingress is bounded before copying into Rust; the complete
serialized budget is checked before field diagnostics. Invalid metadata errors
never quote credential input.

`withOAuthSessionTransaction` serializes complete operations for a resource
across callers sharing a store, while other resources proceed independently.
Canceled or timed-out waiters cannot release the owner, and failures allow later
operations to continue. An optional backend `withLock` encloses the operation.
Rust owns ticket ordering and timeout admission; Node supplies promises and timers.

The default provider supports cached tokens, coalesced refresh/authorization,
static clients and dynamic registration. Its Rust effect machine owns expiry,
credential binding, endpoint security, registration plans, PKCE parameters and
bounded retry decisions. Host callbacks provide browser input, fetch and storage. Successful request
Provider persistence retains requested scopes and dynamic registration metadata.
Complete session operations serialize per store and resource. Refreshes persist a
tokenless intent before redemption; uncertain outcomes require new authorization.
Request cancellation aborts token reads and callback waits. Rejected requests
retain their full grant provenance, so delayed 401s reuse a newer persisted winner.
Cached tokens must match the configured static client ID and secret. Successful request
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
Cancellation settles even when an injected host fetch ignores its signal; late
response bodies are canceled and request abort listeners are retired.
`readBoundedResponseText` enforces declared and actual byte limits, decodes strict
UTF-8 incrementally and releases reader locks/tracking entries on completion,
failure or abort. Length admission uses the allocation-free Rust core.

The default provider retains configured/imported token authentication methods
through code exchange and refresh. Discovery method lists are bounded and checked
before credentials are sent. Dynamic registration prefers public authentication,
then Basic, then POST when supported; explicit selections must be advertised.
Cached grants with a different explicitly selected method are rejected.

Explicit scope profiles compare normalized case-sensitive sets before cached grants
are attached. Refresh retains the previous scope when omitted and rejects changed
profiles while leaving the pending outcome marker intact. Code exchange rejects a
supplied broader scope. Client metadata is captured at provider creation, so later
caller mutation cannot change the authorization request's scope.

Registrations bind to the exact authorization-server issuer. Known expired secrets
are rejected before refresh; native-owned registrations can be replaced during
interactive authorization. Imported registrations keep durable caller ownership
across persisted sessions and caches, so obsolete callbacks or expired secrets
require an explicit caller update. Refresh errors never retire caller-owned
registration caches. Live access tokens remain usable without redeeming an expired
secret. Unlimited/public-client expiry checks avoid reading the clock.

`provider.authenticate({ requestUrl, fetch, discover, signal })` explicitly establishes
a grant, reuses cached/imported credentials and invokes lazy discovery only when
needed. Without discovery it only recovers known grants. It returns owned token
snapshots and respects cancellation and headless policy before interactive consent.
