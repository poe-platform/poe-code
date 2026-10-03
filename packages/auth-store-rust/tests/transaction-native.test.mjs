import assert from "node:assert/strict";
import { test } from "node:test";
import { Volume, createFsFromVolume } from "memfs";
import { EncryptedFileStore, KeychainStore } from "../dist/index.js";
import { withSecretStoreFileLock } from "../dist/credential-transaction-lock.js";

for (const backend of ["file", "keychain", "raw"]) {
  for (const cancelOriginal of [true, false]) {
    test(`${backend} locks capture cancellation before waiting for path checks (${cancelOriginal})`, async () => {
      const memory = createFsFromVolume(new Volume()).promises;
      const entered = Promise.withResolvers(), resume = Promise.withResolvers();
      let waiting = true, calls = 0;
      const fs = { ...memory, lstat: async (...args) => {
        if (waiting) { waiting = false; entered.resolve(); await resume.promise; }
        return memory.lstat(...args);
      } };
      const controller = new AbortController(), reason = new Error("original lock cancellation");
      const options = { signal: controller.signal };
      const operation = async () => { calls++; return "original lock policy"; };
      const store = backend === "file"
        ? new EncryptedFileStore({ fs, salt: "lock-fixture", filePath: "/vault/session.enc" })
        : new KeychainStore({ service: "fixture", account: "fixture", lock: { fs, directory: "/locks" }, runCommand: async () => { throw new Error("must not access credentials"); } });
      const pending = (backend === "raw"
        ? withSecretStoreFileLock(fs, "/vault/raw-lock", operation, options)
        : store.withLock(operation, options)).catch(error => error);
      try {
        await entered.promise;
        if (cancelOriginal) controller.abort(reason);
        options.signal = cancelOriginal ? new AbortController().signal : AbortSignal.abort(new Error("unrelated signal"));
        resume.resolve();
        assert.equal(await pending, cancelOriginal ? reason : "original lock policy");
        assert.equal(calls, cancelOriginal ? 0 : 1);
      } finally { resume.resolve(); await pending; }
    });
  }
}

for (const backend of ["file", "keychain"]) {
  test(`${backend} transactions accept unlimited lock waits`, async () => {
    const fs = createFsFromVolume(new Volume()).promises;
    const store = backend === "file"
      ? new EncryptedFileStore({ fs, salt: "lock-fixture", filePath: "/vault/session.enc" })
      : new KeychainStore({ service: "fixture", account: "fixture", lock: { fs, directory: "/locks" }, runCommand: async () => { throw new Error("must not access credentials"); } });
    assert.equal(await store.withLock(async () => "unlimited", { timeoutMs: Infinity }), "unlimited");
  });
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
