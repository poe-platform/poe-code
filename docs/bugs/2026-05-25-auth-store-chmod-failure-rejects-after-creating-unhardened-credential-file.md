# Auth Store Chmod Failure Rejects After Creating Unhardened Credential File

## Summary

The exported `EncryptedFileStore.set()` writes the encrypted credential document before enforcing its intended `0600` permissions. If the permission update fails, `set()` rejects but leaves the newly written, decryptable credential file on disk without the promised hardening.

## Reproduction

Create a disposable Vitest probe at `packages/auth-store/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { expect, it } from "vitest";

import {
  EncryptedFileStore,
  type EncryptedFileStoreFileSystem
} from "./encrypted-file-store.js";

it("rejects after creating a readable credential when chmod hardening fails", async () => {
  const backing = createFsFromVolume(Volume.fromJSON({}, "/")).promises as unknown as EncryptedFileStoreFileSystem & {
    stat(filePath: string): Promise<{ mode: number }>;
  };
  const fs: EncryptedFileStoreFileSystem = {
    ...backing,
    async chmod() {
      throw new Error("chmod failed");
    }
  };
  const store = new EncryptedFileStore({
    fs,
    filePath: "/home/credentials.enc",
    salt: "test-salt",
    getMachineIdentity: () => ({ hostname: "machine", username: "user" }),
    getRandomBytes: () => Buffer.alloc(12, 2)
  });

  await expect(store.set("new-secret")).rejects.toThrow("chmod failed");
  await expect(store.get()).resolves.toBe("new-secret");
  expect((await backing.stat("/home/credentials.enc")).mode & 0o777).not.toBe(0o600);
});
```

Run:

```sh
npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/auth-store/src/__probe__.test.ts > rejects after creating a readable credential when chmod hardening fails
```

Remove the disposable probe after validation.

## Observed Behavior

`EncryptedFileStore.set()` creates the encrypted JSON payload, writes it to its credential path, and only afterward applies `ENCRYPTION_FILE_MODE` through `chmod()` at `packages/auth-store/src/encrypted-file-store.ts:110` through `packages/auth-store/src/encrypted-file-store.ts:132`. In the probe, `chmod()` throws, so `set("new-secret")` rejects; nevertheless, the same store successfully decrypts `new-secret` from the created file, whose mode is not `0600`.

## Expected Behavior

Credential persistence should not expose a newly saved secret in a file that has not been secured to the intended permissions. The operation should create content with secure permissions from the outset or remove/roll back the new file when hardening fails before reporting failure.

## Impact

Permission or filesystem failures during first-time credential storage can cause login/setup operations to report failure while leaving valid encrypted credentials behind with broader default permissions than intended. On shared systems or permissive directory setups, another local user or process may access the stored ciphertext even though the caller believes credential storage did not complete safely.
