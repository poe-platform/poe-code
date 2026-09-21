# auth-store-rust

Credential storage with reusable Rust policy and native TypeScript bindings. This
private additive package has zero external npm runtime dependencies.

- AES-256-GCM encrypted files compatible with `auth-store`.
- Machine-bound scrypt keys, a bounded key cache, atomic writes and `0600` permissions.
- File and Keychain transaction locks shared by independent stores, with waiter cancellation and timeouts.
- Credential path checks that refuse symbolic links.
- macOS Keychain commands and matching error diagnostics.
- Serialized legacy migration with rollback when mirrored mutations fail.

```ts
import { createSecretStore } from "auth-store-rust";
const { store } = createSecretStore({
  backend: "file",
  fileStore: { salt: "my-app:credentials:v1" }
});
await store.set("my-secret");
const secret = await store.get();
```

Rust owns document validation, credential path admission, Keychain command/result
policy, backend selection and migration/rollback plans. Node supplies filesystem,
process and platform cryptography operations. Existing consumers are unchanged.

The completed-key cache retains at most 64 entries with least-recently-used eviction.
Identity keys exceeding 16,384 UTF-16 units bypass caching. Concurrent derivations
share pending work, and failed work is released so later requests can retry.
