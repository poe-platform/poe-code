# poe-oauth

Secure API key storage and authentication for poe-code.

## Quick start

```ts
import { login, logout, checkAuth, getToken } from "poe-oauth";

// Interactive login (opens browser for OAuth, or pass apiKey directly)
const apiKey = await login();

// Check stored credentials and fetch identity
const identity = await checkAuth(); // { email, balance } | null

// Retrieve stored API key
const token = await getToken(); // string | null

// Remove stored credentials
await logout();
```

## Storage backends

| `POE_AUTH_BACKEND` | Platform | Backend               |
| ------------------ | -------- | --------------------- |
| _(unset)_          | any      | Encrypted file        |
| `file`             | any      | Encrypted file        |
| `keychain`         | macOS    | macOS Keychain        |
| `keychain`         | other    | Error (not supported) |

### Encrypted file backend

- AES-256-GCM with machine-derived key (hostname + username via scrypt)
- Stored at `~/.poe-code/credentials.enc`
- File permissions: `0600`
- Random IV per write

### Keychain backend

- Uses the macOS `security` CLI (`add-generic-password`, `find-generic-password`, `delete-generic-password`)
- Service: `poe-code`, Account: `api-key`

## OAuth

PKCE-based OAuth flow with local callback server:

```ts
import { createOAuthClient } from "poe-oauth";

const client = createOAuthClient({
  clientId: "your-client-id",
  authorizationEndpoint: "https://poe.com/oauth/authorize",
  tokenEndpoint: "https://api.poe.com/token",
  openBrowser: async (url) => { /* open url in browser */ },
  readLine: async () => { /* read manual paste from terminal */ }
});

const authorization = await client.authorize();
// authorization.authorizationUrl — URL to open in browser
const result = await authorization.waitForResult();
// result.apiKey, result.expiresIn
```

## API key validation

```ts
import { isValidApiKeyFormat, normalizeApiKey } from "poe-oauth";

isValidApiKeyFormat("sk-poe-abc123..."); // true
normalizeApiKey("  sk-poe-abc123...  "); // trimmed + validated
```

## Legacy migration

On first `getApiKey()` call, if the store is empty, the package checks `~/.poe-code/credentials.json` for a plaintext `apiKey` field. If found, it migrates the key to the new store and removes `apiKey` from the JSON file (preserving other fields like `configured_services`).
