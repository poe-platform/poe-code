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

Use `resolveSecretStoreBackend(options)` to select and validate the backend
without constructing a store or reading credentials. Pass the returned backend
explicitly when deferred operations must keep the same environment selection.

Both built-in backends expose `store.withLock(operation, { signal, timeoutMs })`
for transactions spanning a read, external operation and write. Independent
instances and processes serialize the same encrypted file or Keychain
service/account; unrelated identities proceed independently. The default
acquisition timeout is 30 seconds. Cancellation during acquisition does not
release the active owner's lock. Each acquisition retains its original signal
and timeout before path checks wait, including nonenumerable declared options;
replacing the caller's option handles cannot
bypass original cancellation or introduce another signal's cancellation. Individual `get`, `set` and `delete` calls do
not implicitly acquire it.

Locks use private filesystem claim directories, containing PID/random names
and numeric tickets without credentials. Dead-owner claims are recovered;
live claims are never stolen because of age. Empty directories remain so an
arriving contender cannot race directory removal. Keychain lock storage defaults
to `~/.auth-store/keychain-locks`; `keychainStore.lock` can select another
directory or filesystem adapter. Injected encrypted-file adapters need
`readdir` support when using transactions.

## Workers and portable hosts

The `workerd`, `worker`, `browser`, and fallback exports contain no Node built-ins.
Node retains the desktop API above. Use `auth-store/portable` to select the portable
API explicitly on any host. It exports `SafeFsSecretStore`, `MigratingSecretStore`,
`key`, and the portable `SecretStore` contract.

```ts
import { SafeFsSecretStore } from "auth-store/portable";

const store = new SafeFsSecretStore({
  fs, // Host-owned @poe-code/safe-fs FileSystem
  filePath: "/credentials/service.enc",
  key: encryptionKey, // Host-managed AES-256-GCM CryptoKey; encrypt + decrypt usages
});
await store.set("secret-value");
const value = await store.get();
await store.delete();
```

Keep the key in host-managed secret storage; use the same key to read persisted
credentials across requests. No machine identity, home directory, process, or
Keychain access is inferred. Web Crypto encrypts UTF-8 bytes with a fresh nonce
for every write. The AES-GCM document format matches the desktop store when the
host imports the same derived key. Missing files return `null`; malformed or
unauthenticated documents throw and remain untouched.

The filesystem must support exclusive creation and atomic rename, and its
namespace must be controlled by the trusted host. Writes stage a private `0600`
file and publish it by rename; path checks reject existing symbolic links.
These checks do not protect against an untrusted actor concurrently changing
filesystem ancestry. The portable store does not advertise `withLock`: hosts
must provide transaction coordination across requests or Workers when needed.
Desktop PID locks and automatic dead-process recovery are not portable.

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
- `fileStore.throwOnInvalidDocument: true` makes malformed or unauthenticated
  existing documents fail with a safe diagnostic; missing files still return
  `null`. The default treats invalid documents as absent. Strict reads preserve
  the existing file until an explicit reset or replacement.

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
