# auth-store

Generic encrypted secret storage with platform-aware backends.

## Usage

```ts
import { createSecretStore } from "auth-store";

const { store, backend } = createSecretStore({
  backendEnvVar: "MY_AUTH_BACKEND",
  fileStore: {
    salt: "my-app:encrypted-store:v1",
    defaultDirectory: ".my-app",
    defaultFileName: "credentials.enc"
  },
  keychainStore: {
    service: "my-app",
    account: "api-key"
  }
});

await store.set("secret-value");
const value = await store.get(); // "secret-value"
await store.delete();
```

## Backends

| `backendEnvVar` value | Platform | Backend        |
| --------------------- | -------- | -------------- |
| _(unset)_             | any      | Encrypted file |
| `file`                | any      | Encrypted file |
| `keychain`            | macOS    | macOS Keychain |
| `keychain`            | other    | Error          |

### Encrypted file

- AES-256-GCM with machine-derived key (hostname + username via scrypt)
- Configurable salt, directory, and file name
- File permissions: `0600`
- Random IV per write

### macOS Keychain

- Uses the `security` CLI (`add-generic-password`, `find-generic-password`, `delete-generic-password`)
- Configurable service and account names

## Configuration Options

`createSecretStore()` accepts:

- `backendEnvVar`: optional env var name that selects `file` or `keychain`.
- `fileStore.salt`: application-specific encryption salt.
- `fileStore.defaultDirectory`: default credential directory.
- `fileStore.defaultFileName`: encrypted file name.
- `keychainStore.service`: macOS Keychain service name.
- `keychainStore.account`: macOS Keychain account name.

## Environment Variables

This package reads only the caller-selected `backendEnvVar`. It does not define a fixed public env var.
