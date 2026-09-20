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

Token exchange/refresh, session storage, browser
callbacks and JWKS verification are still being implemented. Keep applications on
their existing OAuth package until conformance and integration are complete.

`fetchMcpResponse` refuses redirects and cancels unexpected redirect bodies.
`readBoundedResponseText` enforces declared and actual byte limits, decodes strict
UTF-8 incrementally and releases reader locks/tracking entries on completion,
failure or abort. Length admission uses the allocation-free Rust core.
