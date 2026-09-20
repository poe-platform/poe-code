# tiny-oauth-test-server-rust

Test OAuth clients against a controllable authorization server with independent
Rust grant policies, native Node bindings and no npm runtime dependencies.

| Capability | API or endpoint |
| --- | --- |
| Discover issuer endpoints and signing keys | OAuth metadata, JWKS |
| Register public clients and require PKCE | `/register`, `/authorize`, `/token` |
| Rotate refresh tokens and reject grant replay | `/token` |
| Show consent or approve the next request | `setNextAuthorization` |
| Issue signed ES256 or RS256 test credentials | `issueTokenFor`, `/testing/issue-token` |
| Revoke credentials and inspect sanitized traffic | `revoke`, `isTokenRevoked`, `requestLog` |
| Bind an ephemeral local listener and close it | `listen` |

```typescript
import { createOAuthTestServer } from 'tiny-oauth-test-server-rust';

const oauth = createOAuthTestServer({
  signingKeySeed: 'repeatable-test-key',
  defaultAuthorization: { autoApprove: true }
});
const listener = await oauth.listen();
const token = await oauth.issueTokenFor({
  clientId: 'test-client',
  resource: 'https://resource.example/mcp',
  scopes: ['read']
});
console.log(oauth.issuer, token);
await listener.close();
```

Tokens default to 60 seconds. Dynamic registration requires loopback HTTP redirect
URIs; authorization allows port-only variance against registered redirects, while
code exchange requires the exact authorized redirect. Codes expire after 300
seconds, refresh tokens after 3600 seconds. Both are consumed once. Reused PKCE
verifiers are rejected, and verifiers/refresh tokens are redacted from form logs.
RSA signing requires at least 2048 bits. Deterministic EC seeds are for fixtures.

The optional `tiny-oauth-test-server-rust` CLI accepts `--port`, `--hostname`,
`--issuer`, `--ttl-seconds`, `--auto-approve`, repeatable `--static-client` and
`--help`. The `./cli` subpath exposes `runCli` for captured output and shutdown.

Rust owns validation, grant/revocation state, listener admission, token/response
plans, endpoint paths, consent rendering, redaction and CLI values/output. Builtin
Node HTTP, URL, entropy, key and asynchronous signing primitives provide transport.
The core uses std and own repository JSON/SHA crates; one napi-rs addon is bundled.
No TypeScript implementation or runtime SDK executes as a fallback. Existing
applications retain their original imports; this is an additive private package.

Request logs, used-verifier history, client registrations and explicit revocations
persist for the fixture's lifetime. Unobservable access-token metadata copies are
omitted. A bounded direct-token comparison measured 81–89µs native versus 73–83µs
SDK, with sampled heap 6.40→6.47MB versus 9.52→20.25MB across 16,384 more tokens.
Final RSS 94/110MB and live buffers 76KB. This establishes a memory benefit for
that workload, without a general speed or memory claim. Full malformed/getter,
cross-platform and aggregate acceptance remain unfinished.
