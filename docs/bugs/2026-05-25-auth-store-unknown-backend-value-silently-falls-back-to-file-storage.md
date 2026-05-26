# Auth store unknown backend value silently falls back to file storage

## Summary

The exported `auth-store` `createSecretStore()` API documents only `file` and `keychain` as accepted backend configuration values, but an unrecognized environment value is not rejected. A misspelled `keychain` selection such as `keychian` silently creates the encrypted-file backend and persists credentials to disk instead of surfacing the invalid configuration.

## Reproduction

Create the disposable probe `packages/auth-store/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createSecretStore } from "./index.js";
import type { EncryptedFileStoreFileSystem } from "./encrypted-file-store.js";

describe("invalid configured auth backend", () => {
  it("silently falls back to encrypted file storage for a misspelled keychain value", async () => {
    const fs = createFsFromVolume(new Volume()).promises as unknown as EncryptedFileStoreFileSystem;
    const result = createSecretStore({
      backendEnvVar: "MY_AUTH_BACKEND",
      env: { MY_AUTH_BACKEND: "keychian" },
      platform: "darwin",
      fileStore: {
        fs,
        filePath: "/home/test/.app/credentials.enc",
        salt: "probe:salt",
        getMachineIdentity: () => ({ hostname: "host", username: "user" })
      }
    });

    await result.store.set("sensitive-api-key");
    console.log(JSON.stringify({ backend: result.backend, persisted: await fs.readFile("/home/test/.app/credentials.enc", "utf8") !== "" }));
    expect(result.backend).toBe("file");
    await expect(fs.readFile("/home/test/.app/credentials.enc", "utf8")).resolves.toContain('"ciphertext"');
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
rm -f packages/auth-store/src/__probe__.test.ts
```

The test passes and shows that the misspelled Keychain request persisted through the file backend:

```text
{"backend":"file","persisted":true}
✓ packages/auth-store/src/__probe__.test.ts > invalid configured auth backend > silently falls back to encrypted file storage for a misspelled keychain value
```

## Observed Behavior

The package README documents `file` and `keychain` as the supported `backendEnvVar` values, with `keychain` on unsupported platforms producing an error. However, `resolveBackend()` in `packages/auth-store/src/create-secret-store.ts:48` returns `"keychain"` only for an exact match and returns `"file"` for every other configured string at `packages/auth-store/src/create-secret-store.ts:56`. Consequently, `MY_AUTH_BACKEND=keychian` on macOS is accepted as encrypted-file storage and `store.set()` writes credential ciphertext to the configured file path.

## Expected Behavior

When a backend configuration variable is present, it should be validated against the documented supported values. A misspelling or unsupported backend value should fail explicitly rather than silently selecting a different credential-storage backend.

## Impact

Operators intending to store credentials in macOS Keychain can accidentally place encrypted credential artifacts on disk because of a typo or stale configuration value, while the application reports a successful backend selection and credential save. This violates the requested storage policy and can expose credential files to backup, sync, retention, or local-file inspection workflows that Keychain selection was intended to avoid.
