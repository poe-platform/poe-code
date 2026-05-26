# Auth store chmod failure leaves a new credential file behind

## Summary

`EncryptedFileStore.set()` writes a new encrypted credential file before applying its promised `0600` permissions. If that permission-hardening step rejects, `set()` reports failure but does not remove or roll back the newly written credential. The store can immediately read the credential after the rejected write operation, leaving authentication material persisted even though secure storage setup failed.

## Reproduction

Add the following temporary probe as `packages/auth-store/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { EncryptedFileStore, type EncryptedFileStoreFileSystem } from "./encrypted-file-store.js";

describe("encrypted credential chmod failure", () => {
  it("leaves newly written credential content behind after permission hardening rejects", async () => {
    let storedContent: string | undefined;
    const fs: EncryptedFileStoreFileSystem = {
      readFile: vi.fn(async () => storedContent ?? Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }))),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (_path, data) => { storedContent = String(data); }),
      chmod: vi.fn(async () => { throw new Error("chmod denied"); }),
      unlink: vi.fn(async () => { storedContent = undefined; })
    };
    const store = new EncryptedFileStore({
      fs,
      filePath: "/credentials.enc",
      salt: "test-salt",
      getMachineIdentity: () => ({ hostname: "host", username: "user" }),
      getRandomBytes: () => Buffer.alloc(12, 1)
    });

    await expect(store.set("secret")).rejects.toThrow("chmod denied");

    console.log(JSON.stringify({ storedContent, chmodCalls: vi.mocked(fs.chmod).mock.calls.length }));
    expect(storedContent).toContain("ciphertext");
    await expect(store.get()).resolves.toBe("secret");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
rm packages/auth-store/src/__probe__.test.ts
nl -ba packages/auth-store/src/encrypted-file-store.ts | sed -n '110,142p'
nl -ba packages/auth-store/src/auth-store.test.ts | sed -n '232,246p'
```

The reproduction passes and logs the encrypted document remaining after `chmod()` rejects:

```text
{"storedContent":"{\"version\":1,\"iv\":\"AQEBAQEBAQEBAQEB\",\"authTag\":\"5vkGP7OrCQSxkoKE7IhdNA==\",\"ciphertext\":\"JlOn5HVX\"}","chmodCalls":1}
✓ packages/auth-store/src/__probe__.test.ts > encrypted credential chmod failure > leaves newly written credential content behind after permission hardening rejects
```

## Observed Behavior

`EncryptedFileStore.set()` creates the containing directory, writes the credential document, and only afterward invokes `chmod()` in `packages/auth-store/src/encrypted-file-store.ts:110` through `packages/auth-store/src/encrypted-file-store.ts:132`. When `chmod()` fails, the rejected operation has already committed the encrypted credential content and performs no cleanup. The package's existing security test describes the intended write property by asserting `0600` permissions after credential storage in `packages/auth-store/src/auth-store.test.ts:232` through `packages/auth-store/src/auth-store.test.ts:246`.

## Expected Behavior

A credential write that cannot establish the required restrictive permissions should not leave a newly persisted credential file behind. The store should write with restrictive permissions atomically where possible, or remove/roll back the new file before rejecting permission-hardening failure.

## Impact

On filesystems or environments where a newly created file initially inherits broader access than `0600`, a permission failure leaves encrypted authentication material stored with unverified permissions despite the caller receiving an error. This can expose the credential ciphertext for offline attack and causes login or key-rotation flows to report failure while silently retaining the new secret on disk.
