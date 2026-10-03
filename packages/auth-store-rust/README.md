# auth-store-rust

Credential storage with reusable Rust policy, native Node bindings and a portable
WebAssembly entry point. This private additive package uses the existing safe-fs
error and filesystem type contracts; it adds no new third-party dependencies.

- AES-256-GCM encrypted files compatible with `auth-store`.
- Machine-bound scrypt keys, a bounded key cache, atomic writes and `0600` permissions.
- File and Keychain transaction locks shared by independent stores, with waiter cancellation and optional timeouts (unlimited by default or with `Infinity`).
- Credential path checks that refuse symbolic links, and optional errors for invalid encrypted documents.
- macOS Keychain commands and matching error diagnostics.
- Serialized legacy migration with rollback when mirrored mutations fail.
- Resolve the configured backend without constructing a store or reading credentials.
- Portable encrypted storage with a host-managed WebCrypto key and filesystem.

```ts
import { createSecretStore } from "auth-store-rust";
const { store } = createSecretStore({
  backend: "file",
  fileStore: { salt: "my-app:credentials:v1" }
});
await store.set("my-secret");
const secret = await store.get();
```

For browsers and Workers, provide an AES-256-GCM key with encrypt/decrypt usages
and a filesystem supporting exclusive creation and atomic rename:

```ts
import { SafeFsSecretStore } from "auth-store-rust/portable";
const store = new SafeFsSecretStore({ fs, filePath: "/credentials/secret.enc", key });
await store.set("my-secret");
```

The portable entry is also selected by the browser, worker and workerd conditions.
Workerd bundles load the included `.wasm` as a compiled WebAssembly module.
Hosts manage keys and coordinate portable transactions. Node remains the default
entry in Node environments.

Rust owns document validation, credential and lock path admission, lock timeout
and owner validation, claim ticket validation, ticket ordering, cleanup ownership,
wait delays, Keychain command/result policy, backend selection and migration/rollback
plans. Node supplies filesystem, process, cancellation, JSON and platform cryptography
operations and preserves original error objects. Existing consumers are unchanged.

The completed-key cache retains at most 64 entries with least-recently-used eviction.
Identity keys exceeding 16,384 UTF-16 units bypass caching. Concurrent derivations
share pending work, and failed work is released so later requests can retry.
