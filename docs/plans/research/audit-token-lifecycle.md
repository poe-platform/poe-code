# Audit: Token Validation And Lifecycle

## Scope

This audit covers the server-side JWT verifier in `packages/mcp-oauth` and the client-side token persistence and refresh lifecycle in `packages/mcp-oauth` plus the OAuth fixture in `packages/tiny-oauth-test-server`.

## Result

Status: pass after fixes in this change.

Gaps found and fixed:

- `JWKS` verification previously delegated to `createLocalJWKSet()`, which rejects duplicate matching `kid` values instead of trying each candidate key.
- `HS*` algorithms could be allow-listed accidentally even though the verifier has no shared-secret mode.
- Critical protected-header claims were not rejected explicitly.
- The test suite did not prove encrypted auth-store persistence stayed free of plaintext resource URIs and token values.
- The test suite did not prove `invalid_grant` on refresh clears cached tokens and falls back to exactly one fresh authorization flow.
- The test OAuth server rotated refresh tokens, but reuse rejection after rotation was not asserted.

## Spec-To-Code Matrix

| Requirement | Status | Code path | Test coverage |
| --- | --- | --- | --- |
| Signature validation against JWKS; matching `kid` keys are all tried | pass | `packages/mcp-oauth/src/server/jwks-token-verifier.ts` filters candidate keys and verifies against each candidate until one succeeds | `packages/mcp-oauth/src/server-token-verifier.test.ts` -> `tries every matching kid in the JWKS until one verifies the signature` |
| Reject unsupported `alg`; reject `none`; reject `HS*` unless a shared secret mode exists | pass | `resolveAlgorithm()` rejects `none`, all `HS*`, and anything outside the allow-list | `packages/mcp-oauth/src/server-token-verifier.test.ts` -> `rejects alg=none tokens`, `rejects HS* tokens when no shared secret is configured...` |
| `iss` exact-match against configured AS URL | pass | `jwtVerify(..., { issuer: [...authorizationServers] })` | `packages/mcp-oauth/src/server-token-verifier.test.ts` -> `requires an exact issuer match...` |
| `aud` bound to the configured canonical protected resource | pass | `tiny-http-mcp-server` passes the configured resource to the verifier; `normalizeVerifiedAudience()` canonicalizes and enforces exact equality | Existing coverage in `packages/mcp-oauth/src/server-token-verifier.test.ts` and the earlier audit in `docs/plans/research/audit-resource-indicator.md` |
| `exp` enforced with bounded clock skew; default is `30s` | pass | `clockSkewSeconds ?? 30` and `jwtVerify(..., { clockTolerance })` | `packages/mcp-oauth/src/server-token-verifier.test.ts` -> `accepts tokens inside the configured expiration clock-skew window`, `rejects tokens outside the configured expiration clock-skew window...` |
| `nbf` enforced when present | pass | `jwtVerify()` enforces `nbf`; verifier maps the failure to `invalid_token` / `token not active yet` | `packages/mcp-oauth/src/server-token-verifier.test.ts` -> `rejects tokens whose nbf is beyond the configured clock-skew window` |
| Expired tokens return `401 invalid_token` with `error_description="token expired"` | pass | `normalizeVerificationError()` maps `JWTExpired` and `exp` claim failures to `token expired` | `packages/mcp-oauth/src/server-token-verifier.test.ts` -> `rejects tokens outside the configured expiration clock-skew window with token expired` |
| `scope` or `scopes` must intersect endpoint-required scopes | pass | `parseScopes()` supports `scope` and `scopes`; verifier returns `insufficient_scope` when no intersection exists | Existing coverage in `packages/mcp-oauth/src/server-token-verifier.test.ts` -> `rejects tokens that do not satisfy the required scopes`; `tiny-http-mcp-server` challenge formatting is already covered in `packages/tiny-http-mcp-server/src/oauth.test.ts` |
| Reject unknown critical claims / `crit` | pass | `resolveAlgorithm()` rejects any protected header with a non-empty `crit` list before JWKS fetch or signature verification | `packages/mcp-oauth/src/server-token-verifier.test.ts` -> `rejects tokens with critical headers the verifier does not understand` |
| Persist tokens via `auth-store`, keyed by canonical resource URI | pass | `createAuthStoreSessionStore()` canonicalizes the resource and derives a SHA-256 file key | Existing coverage plus new encrypted-file assertion in `packages/mcp-oauth/src/mcp-oauth.test.ts` -> `stores session files under a canonical hashed key...` |
| No plaintext token values or resource URIs in storage writes | pass | `auth-store` writes encrypted JSON blobs; session store uses derived hashed filenames | `packages/mcp-oauth/src/mcp-oauth.test.ts` -> `stores session files under a canonical hashed key without plaintext tokens or resource URIs` and existing `packages/auth-store/src/auth-store.test.ts` encrypted file-store tests |
| Tokens are not echoed back during refresh failure handling | pass | `invalid_grant` is handled internally by clearing cached tokens and re-authorizing instead of surfacing the refresh token in an error | `packages/mcp-oauth/src/mcp-oauth.test.ts` -> `clears invalid refresh tokens, avoids echoing them, and falls back to one fresh authorization flow` |
| Refresh tokens rotate on every refresh | pass | `tiny-oauth-test-server` deletes the old refresh token and issues a new one from `createTokenResponse()` | Existing coverage in `packages/tiny-oauth-test-server/src/index.test.ts` -> `rotates refresh tokens and issues a new access token` |
| Old refresh token becomes invalid after rotation; reuse fails | pass | `rotateRefreshToken()` deletes the consumed refresh token and rejects reuse with `invalid_grant` | `packages/tiny-oauth-test-server/src/index.test.ts` -> `rejects refresh-token reuse after rotation invalidates the old token` |
| Concurrent refresh dedup results in exactly one `/token` refresh request | pass | `refreshPromises` memoizes the in-flight refresh per canonical resource | Existing coverage in `packages/mcp-oauth/src/mcp-oauth.test.ts` -> `reloads persisted tokens and refreshes them only once for concurrent callers` |
| `invalid_grant` clears cached tokens and triggers one fresh authorization flow | pass | `refreshSession()` clears stored tokens on `invalid_grant`; `ensureAuthorizedSession()` then performs interactive authorization once | `packages/mcp-oauth/src/mcp-oauth.test.ts` -> `clears invalid refresh tokens, avoids echoing them, and falls back to one fresh authorization flow` |
| Unit tests use `memfs`, not the real filesystem | pass | Session-store and auth-store tests inject `memfs` file APIs | Existing coverage in `packages/mcp-oauth/src/mcp-oauth.test.ts` and `packages/auth-store/src/auth-store.test.ts` |

## Code Notes

- The JWKS verifier still has no shared-secret verification mode. That is intentional in the current API shape, so `HS*` remains rejected even if it is placed in `allowedAlgorithms`.
- `scope` challenge formatting on the HTTP layer remains owned by `tiny-http-mcp-server`; this audit revalidated the verifier input path and reused the existing HTTP-level challenge assertions there.

## Files Changed In This Pass

- `packages/mcp-oauth/src/server/jwks-token-verifier.ts`
- `packages/mcp-oauth/src/server-token-verifier.test.ts`
- `packages/mcp-oauth/src/mcp-oauth.test.ts`
- `packages/tiny-oauth-test-server/src/index.test.ts`
