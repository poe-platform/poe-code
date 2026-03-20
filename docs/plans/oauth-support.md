# OAuth Support — Minimal Plan

## Context

Today `@poe-code/auth` stores a single API key via `AuthStore` (file or keychain backend).
Consumers resolve credentials through `getPoeApiKey()` which checks `POE_API_KEY` env → auth store.

OAuth provides a browser-based login flow that produces an API key — the same credential type we already store.

## Design Constraints

- `AuthStore` interface is **unchanged** — OAuth produces an API key, stored via existing `setApiKey()`.
- Consumers (`getPoeApiKey`) need zero changes — they already read the API key.
- No new if/case branching per-backend (CLAUDE.md rule).

## Library Choice

**`oauth4webapi`** (v3.x) — 309 KB unpacked, zero dependencies.

Standards-compliant (OAuth 2.1 / FAPI 2.0), composable building blocks for the PKCE flow.
Handles: PKCE challenge generation, authorization URL construction, code-for-token exchange.
We provide: localhost callback server (`node:http`), browser open (`node:child_process`), key storage.

## Poe OAuth Specifics

| Detail | Value |
| --- | --- |
| Authorization endpoint | `https://poe.com/authorize` |
| Token endpoint | `https://api.poe.com/token` |
| Scope | `apikey:create` |
| PKCE | Mandatory, S256 |
| Client secret | None (public client) |
| Localhost redirect URIs | Accepted without registration |
| Token response | `{ api_key, api_key_expires_in }` — returns an API key, not an OAuth access token |
| Refresh tokens | None — the API key is the final credential |

## Flow

```text
CLI                         Browser                     poe.com
 │                                                          │
 ├─ generate code_verifier + code_challenge (S256)          │
 ├─ start local HTTP server on ephemeral port               │
 ├─ open browser ──────────────► /authorize?                │
 │                               response_type=code&        │
 │                               client_id=...&             │
 │                               scope=apikey:create&       │
 │                               code_challenge=...&        │
 │                               redirect_uri=localhost:PORT/callback
 │                                                          │
 │                    user reviews + clicks "Connect"        │
 │                                                          │
 │  ◄─── redirect to localhost:PORT/callback?code=CODE ─────┤
 ├─ POST /token  (code + code_verifier) ───────────────────►│
 │  ◄─── { api_key, api_key_expires_in } ──────────────────┤
 ├─ store api_key via AuthStore.setApiKey()                 │
 └─ done                                                    │
```

## What to Add

### 1. `OAuthClient` — the PKCE flow orchestrator (uses `oauth4webapi`)

Single new file: `packages/auth/src/oauth-client.ts`

```ts
import * as oauth from "oauth4webapi";

interface OAuthClientConfig {
  clientId: string;
  // DI seams
  openBrowser?: (url: string) => Promise<void>;
  createServer?: () => http.Server;
  fetch?: typeof globalThis.fetch;
}

interface OAuthResult {
  apiKey: string;
  expiresIn: number | null; // seconds, or null if no expiry
}

interface OAuthClient {
  authorize(): Promise<OAuthResult>;
}
```

`oauth4webapi` handles:

- PKCE code_verifier / code_challenge (S256) generation
- Authorization URL construction
- Token exchange (`authorizationCodeGrantRequest`)
- Response validation

We handle:

- Ephemeral localhost HTTP server for the redirect callback (any available port — no registration needed)
- Open browser + print the authorization URL to the terminal so the user can also navigate manually
- Accept the auth code from **whichever completes first**: localhost callback OR user pasting the redirect URL into the terminal
- Storing the resulting API key via existing `AuthStore.setApiKey()`

Terminal UX:

```text
Opening browser to log in...

  https://poe.com/authorize?client_id=...&code_challenge=...

Waiting for authorization. You can also paste the redirect URL here:
> http://localhost:54321/callback?code=abc123

✓ Logged in successfully
```

### 2. Feature gate via `POE_CODE_OAUTH_LOGIN`

- `POE_CODE_OAUTH_LOGIN=1` → `poe-code login` uses the OAuth browser flow
- Unset or `0` → current manual API key entry (existing behavior)
- No CLI flag — the env var is the only toggle until OAuth becomes the default
- On success, stores the API key via `AuthStore.setApiKey()` — same as manual login

Once OAuth becomes the default, `poe-code login` will always use the browser flow. Manual API key usage is only via:

- `--api-key <key>` CLI flag
- `POE_API_KEY` env var

### 3. No changes needed

- **`AuthStore` interface** — unchanged, OAuth produces a regular API key
- **`EncryptedFileAuthStore` / `KeychainAuthStore`** — unchanged
- **`getPoeApiKey()`** — unchanged, already reads the stored API key
- **`types.ts`** — no new types needed on the store side

## What NOT to Add

- No new `AuthStore` methods — OAuth result is just an API key
- No refresh token logic — Poe returns a long-lived API key
- No new backend type
- No device code flow
- No multi-account support

## File Inventory

| File | Action |
| --- | --- |
| `packages/auth/src/oauth-client.ts` | **New** — PKCE flow via `oauth4webapi` |
| `packages/auth/src/oauth-client.test.ts` | **New** — tests |
| `packages/auth/src/index.ts` | Export `OAuthClient` + types |
| `packages/auth/package.json` | Add `oauth4webapi` dependency |
| `src/cli/commands/login-command.ts` | Add `--oauth` flag |

## Open Questions

1. **Client ID** — Is there already a registered OAuth app / client ID for the CLI, or do we need to create one?
2. **Expiry handling** — When `api_key_expires_in` is set, should the CLI warn the user or silently re-auth on next use?
