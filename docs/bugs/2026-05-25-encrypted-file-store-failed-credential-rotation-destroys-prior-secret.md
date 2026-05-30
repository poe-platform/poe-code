---
name: "Encrypted File Store Failed Credential Rotation Destroys Prior Secret"
---

# Encrypted File Store Failed Credential Rotation Destroys Prior Secret

## Summary

The exported `auth-store` `EncryptedFileStore.set()` method replaces the live encrypted credential file directly. If an update partially overwrites that file and then rejects, the operation reports failure but destroys the previous decryptable credential instead of preserving it for continued authentication or retry.

## Reproduction

Create a disposable Vitest probe at `packages/auth-store/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { EncryptedFileStore, type EncryptedFileStoreFileSystem } from "./encrypted-file-store.js";

describe("encrypted credential interrupted rotation", () => {
  it("destroys the previous credential when updating write partially fails", async () => {
    const filePath = "/home/user/.poe-code/credentials.poe.enc";
    const base = createFsFromVolume(new Volume()).promises as unknown as EncryptedFileStoreFileSystem;
    const common = {
      filePath,
      salt: "test:salt",
      getMachineIdentity: () => ({ hostname: "host", username: "user" }),
      getRandomBytes: () => Buffer.alloc(12, 1),
    };
    const original = new EncryptedFileStore({ ...common, fs: base });
    await original.set("old-secret");
    await expect(original.get()).resolves.toBe("old-secret");

    const fs: EncryptedFileStoreFileSystem = {
      ...base,
      async writeFile(path, data, options) {
        if (path === filePath) {
          await base.writeFile(path, "{", options);
          throw new Error("credential disk full");
        }
        await base.writeFile(path, data, options);
      },
    };
    const rotating = new EncryptedFileStore({ ...common, fs });

    await expect(rotating.set("new-secret")).rejects.toThrow("credential disk full");
    const raw = await base.readFile(filePath, "utf8");
    const loaded = await original.get();
    console.log(JSON.stringify({ raw, loaded }));
    expect(raw).toBe("{");
    expect(loaded).toBeNull();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"{","loaded":null}
✓ packages/auth-store/src/__probe__.test.ts > encrypted credential interrupted rotation > destroys the previous credential when updating write partially fails
```

Remove the disposable probe after validation.

## Observed Behavior

`EncryptedFileStore.get()` returns `null` whenever the encrypted document can no longer be parsed or decrypted at `packages/auth-store/src/encrypted-file-store.ts:71`. `set()` builds a new ciphertext document and writes it directly to `this.filePath` at `packages/auth-store/src/encrypted-file-store.ts:128` before applying final permissions. In the probe, an update rejects with `"credential disk full"` after leaving the file as `"{"`; reading the original stored secret now returns `null`.

## Expected Behavior

Credential rotation should preserve the prior encrypted secret until the replacement ciphertext and its required permissions are committed successfully. A failed `set()` should leave the last successfully stored credential readable, or perform explicit rollback before reporting failure.

## Impact

A transient filesystem failure while refreshing or migrating a stored API key can unexpectedly log the user out and remove the only usable encrypted credential despite the attempted replacement failing. Commands that rely on the stored provider secret then lose authentication and expose no recoverable old value for retry or diagnosis.
