# @poe-code/poe-auth

Secure API key storage for poe-code with two backends:

- **Encrypted file** (default) — AES-256-GCM, works on all platforms
- **macOS Keychain** — opt-in via `POE_AUTH_BACKEND=keychain`

## Usage

```ts
import { createAuthStore } from "@poe-code/poe-auth";

const { store, backend } = createAuthStore();

await store.setApiKey("poe-...");
const key = await store.getApiKey(); // string | null
await store.deleteApiKey();
```

## Backend selection

| `POE_AUTH_BACKEND` | Platform | Backend               |
| ------------------ | -------- | --------------------- |
| _(unset)_          | any      | Encrypted file        |
| `file`             | any      | Encrypted file        |
| `keychain`         | macOS    | macOS Keychain        |
| `keychain`         | other    | Error (not supported) |

## Encrypted file backend

- Encrypts with AES-256-GCM using a machine-derived key (hostname + username via scrypt)
- Stores at `~/.poe-code/credentials.enc`
- File permissions: `0600`
- Random IV per write

## Keychain backend

- Uses the `security` CLI (`add-generic-password`, `find-generic-password`, `delete-generic-password`)
- Service: `poe-code`, Account: `api-key`

## Legacy migration

On first `getApiKey()` call, if the store is empty, the package checks `~/.poe-code/credentials.json` for a plaintext `apiKey` field. If found, it migrates the key to the new store and removes `apiKey` from the JSON file (preserving other fields like `configured_services`).
