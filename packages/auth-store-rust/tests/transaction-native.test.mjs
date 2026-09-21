import assert from "node:assert/strict";
import { test } from "node:test";
import { Volume, createFsFromVolume } from "memfs";
import { EncryptedFileStore, KeychainStore } from "../dist/index.js";

for (const backend of ["file", "keychain"]) {
  test(`${backend} transactions exclude independent owners and preserve waiter cancellation`, async () => {
    const fs = createFsFromVolume(new Volume()).promises;
    const make = backend === "file"
      ? () => new EncryptedFileStore({ fs, salt: "lock-fixture", filePath: "/vault/session.enc" })
      : () => new KeychainStore({ service: "fixture", account: "fixture", lock: { fs, directory: "/locks" }, runCommand: async () => { throw new Error("must not access credentials"); } });
    const first = make(), second = make();
    assert.equal(typeof first.withLock, "function");
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const owner = first.withLock(async () => { entered.resolve(); await release.promise; return "owner"; });
    await entered.promise;
    try {
      await assert.rejects(second.withLock(async () => "bypassed", { timeoutMs: 0 }), /lock/);
      const controller = new AbortController();
      const reason = new Error("cancel waiter");
      const waiter = second.withLock(async () => "bypassed", { signal: controller.signal }).catch(error => error);
      controller.abort(reason);
      assert.equal(await waiter, reason);
    } finally { release.resolve(); assert.equal(await owner, "owner"); }
    assert.equal(await second.withLock(async () => "next", { timeoutMs: 0 }), "next");
  });
}
