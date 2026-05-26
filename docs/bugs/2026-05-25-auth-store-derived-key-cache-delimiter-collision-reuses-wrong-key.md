# Auth store derived-key cache delimiter collision reuses wrong key

## Summary

The exported `auth-store` `EncryptedFileStore` caches derived encryption keys globally using a colon-concatenated string of `hostname`, `username`, and `salt`. Distinct machine-identity and salt tuples can produce the same cache key, so after one store derives a key, another differently configured store can reuse that cached key and successfully decrypt ciphertext it should not be able to read.

## Reproduction

Create the disposable probe `packages/auth-store/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { EncryptedFileStore } from "./encrypted-file-store.js";
import type { EncryptedFileStoreFileSystem } from "./encrypted-file-store.js";

describe("encrypted-store derived key cache delimiter collision", () => {
  it("lets different identity and salt inputs decrypt through one cached key", async () => {
    const fs = createFsFromVolume(new Volume()).promises as unknown as EncryptedFileStoreFileSystem;
    const writer = new EncryptedFileStore({
      fs,
      filePath: "/secret.enc",
      salt: "gamma:delta",
      getMachineIdentity: () => ({ hostname: "alpha", username: "beta" }),
      getRandomBytes: () => Buffer.alloc(12, 1)
    });
    const reader = new EncryptedFileStore({
      fs,
      filePath: "/secret.enc",
      salt: "delta",
      getMachineIdentity: () => ({ hostname: "alpha", username: "beta:gamma" })
    });

    await writer.set("cached-secret");
    const decrypted = await reader.get();
    console.log(JSON.stringify({ decrypted }));
    expect(decrypted).toBe("cached-secret");
  });
});
```

Run the targeted test and remove the disposable probe:

```sh
npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
rm -f packages/auth-store/src/__probe__.test.ts
```

The probe passes even though the reader supplies a different machine identity and salt:

```text
{"decrypted":"cached-secret"}
✓ packages/auth-store/src/__probe__.test.ts > encrypted-store derived key cache delimiter collision > lets different identity and salt inputs decrypt through one cached key
```

## Observed Behavior

`deriveEncryptionKey()` builds the KDF secret as ``${hostname}:${username}`` and the process-global cache key as ``${secret}:${salt}`` in `packages/auth-store/src/encrypted-file-store.ts:159` through `packages/auth-store/src/encrypted-file-store.ts:166`. For the writer input `{ hostname: "alpha", username: "beta", salt: "gamma:delta" }` and reader input `{ hostname: "alpha", username: "beta:gamma", salt: "delta" }`, both cache keys equal `alpha:beta:gamma:delta`, although the actual `scrypt(secret, salt)` inputs differ. Because the writer derives and caches first, the reader obtains the writer's cached key at `packages/auth-store/src/encrypted-file-store.ts:167` through `packages/auth-store/src/encrypted-file-store.ts:183` and decrypts its ciphertext successfully.

## Expected Behavior

Key caching must distinguish every distinct KDF input tuple. The cache key should be constructed using an unambiguous encoding of identity and salt fields, or the store should avoid sharing derived keys across configurations; a store with different `secret` and `salt` inputs must not reuse another store's key.

## Impact

Long-lived processes that construct encrypted stores with configurable or externally sourced salts and identities can accidentally collapse separate credential domains into one cached encryption key. A store configured for a different machine/user/salt boundary may read or write credential ciphertext under another store's key, breaking intended separation between authentication stores and making behavior order-dependent on which configuration derives first.
