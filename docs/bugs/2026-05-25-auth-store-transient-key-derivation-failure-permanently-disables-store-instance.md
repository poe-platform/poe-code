# Auth store transient key derivation failure permanently disables store instance

## Summary

`EncryptedFileStore` caches the promise returned by its first encryption-key derivation attempt. If that attempt rejects because machine identity lookup fails transiently, the rejected promise remains cached. Later `set()` operations on the same store instance immediately reject with the original error without retrying identity lookup, even after the underlying condition recovers.

## Reproduction

From the repository root, run a disposable Vitest probe whose injected machine-identity provider fails once and then succeeds:

```sh
cat > packages/auth-store/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { EncryptedFileStore, type EncryptedFileStoreFileSystem } from "./encrypted-file-store.js";

describe("encrypted-store key derivation retry repro", () => {
  it("never retries after one transient machine identity failure", async () => {
    let document: string | undefined;
    const fs: EncryptedFileStoreFileSystem = {
      readFile: vi.fn(async () => document ?? Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }))),
      writeFile: vi.fn(async (_path, data) => { document = String(data); }),
      mkdir: vi.fn(async () => undefined),
      chmod: vi.fn(async () => undefined),
      unlink: vi.fn(async () => { document = undefined; }),
    };
    const getMachineIdentity = vi.fn()
      .mockRejectedValueOnce(new Error("identity unavailable"))
      .mockResolvedValue({ hostname: "host", username: "user" });
    const store = new EncryptedFileStore({
      fs,
      filePath: "/credentials.enc",
      salt: "test-salt",
      getMachineIdentity,
      getRandomBytes: () => Buffer.alloc(12, 1),
    });

    await expect(store.set("token")).rejects.toThrow("identity unavailable");
    await expect(store.set("token")).rejects.toThrow("identity unavailable");

    console.log(JSON.stringify({ calls: getMachineIdentity.mock.calls.length, wrote: document !== undefined }));
    expect(getMachineIdentity).toHaveBeenCalledTimes(1);
    expect(document).toBeUndefined();
  });
});
EOF
npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
rm -f packages/auth-store/src/__probe__.test.ts
nl -ba packages/auth-store/src/encrypted-file-store.ts | sed -n '51,70p;107,143p;146,170p'
```

## Observed Behavior

Although the identity callback is ready to succeed on its second invocation, the store never invokes it again and both writes reject with the original transient failure:

```text
{"calls":1,"wrote":false}
✓ packages/auth-store/src/__probe__.test.ts > encrypted-store key derivation retry repro > never retries after one transient machine identity failure
```

The store initializes `keyPromise` to `null` at `packages/auth-store/src/encrypted-file-store.ts:51` through `packages/auth-store/src/encrypted-file-store.ts:70`. Both credential writes and decrypting reads await `getEncryptionKey()`, including `set()` at `packages/auth-store/src/encrypted-file-store.ts:107` through `packages/auth-store/src/encrypted-file-store.ts:143`. `getEncryptionKey()` assigns the result of `deriveEncryptionKey(...)` once and returns it thereafter without clearing rejected promises in `packages/auth-store/src/encrypted-file-store.ts:146` through `packages/auth-store/src/encrypted-file-store.ts:151`.

## Expected Behavior

A failed encryption-key derivation should not permanently poison a long-lived credential store instance. Once identity lookup or key derivation becomes available again, a subsequent operation should retry and be able to persist or read credentials successfully.

## Impact

A transient hostname/user lookup error or temporary identity-provider outage disables authentication storage for the lifetime of the constructed store object. Long-lived CLI processes, servers, or SDK consumers must reconstruct application state or restart before credential writes can recover, despite the underlying dependency already being healthy.
