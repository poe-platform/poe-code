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

Authorization-state handling, token exchange/refresh, session storage, browser
callbacks and JWKS verification are still being implemented. Keep applications on
their existing OAuth package until conformance and integration are complete.
