import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { setImmediate } from "node:timers/promises";
import { EncryptedFileStore } from "./encrypted-file-store.js";
import { KeychainStore } from "./keychain-store.js";
import { withSecretStoreFileLock } from "./transaction-lock.js";

function fixture() {
  const fs = createFsFromVolume(new Volume()).promises;
  const store = (filePath = "/home/test/credential.enc") => new EncryptedFileStore({ fs, filePath, salt: "fixture", getMachineIdentity: () => ({ hostname: "host", username: "user" }) });
  return { fs, store };
}

it("preserves a publication file it did not create when exclusive creation fails", async () => {
  const f = fixture();
  let existing = "";
  const fs = { ...f.fs, writeFile: async (...args: Parameters<typeof f.fs.writeFile>) => {
    if (String(args[0]).endsWith(".tmp")) {
      existing = String(args[0]);
      await f.fs.writeFile(existing, "another owner's publication");
      throw Object.assign(new Error("publication exists"), { code: "EEXIST" });
    }
    return f.fs.writeFile(...args);
  } };
  const operation = vi.fn(async () => {});
  await expect(withSecretStoreFileLock(fs, "/locks", operation)).rejects.toThrow("publication exists");
  expect(operation).not.toHaveBeenCalled();
  expect(await f.fs.readFile(existing, "utf8")).toBe("another owner's publication");
});

it("cleans partial publication writes and preserves the original failure", async () => {
  const f = fixture(), failure = new Error("publication write failed");
  const fs = { ...f.fs, writeFile: async (...args: Parameters<typeof f.fs.writeFile>) => {
    await f.fs.writeFile(...args);
    if (String(args[0]).endsWith(".tmp")) throw failure;
  } };
  await expect(withSecretStoreFileLock(fs, "/locks", async () => {})).rejects.toBe(failure);
  expect(await f.fs.readdir("/locks")).toEqual([]);
});

it("retains operation and cleanup failures when removing its claim fails", async () => {
  const f = fixture(), failure = new Error("operation failed"), cleanup = new Error("claim cleanup failed");
  const fs = { ...f.fs, unlink: async () => { throw cleanup; } };
  const result = await withSecretStoreFileLock(fs, "/locks", async () => { throw failure; }).catch(error => error);
  expect(result).toBeInstanceOf(AggregateError);
  expect(result.errors).toEqual([failure, cleanup]);
});

it("rejects a Keychain lock directory reached through a symbolic-link parent", async () => {
  const f = fixture();
  await f.fs.mkdir("/home/test", { recursive: true });
  await f.fs.mkdir("/other", { recursive: true });
  await f.fs.symlink("/other", "/home/test/keychain-locks");
  const operation = vi.fn(async () => {});
  const store = new KeychainStore({ service: "service", account: "account", lock: { fs: f.fs, directory: "/home/test/keychain-locks" } });
  await expect(store.withLock(operation)).rejects.toThrow("symbolic link");
  expect(operation).not.toHaveBeenCalled();
});

it("holds a transaction lock across separate instances targeting the same file", async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const order: string[] = [];
  const first = f.store().withLock(async () => { order.push("first"); entered.resolve(); await release.promise; order.push("persisted"); });
  await entered.promise;
  const second = f.store().withLock(async () => { order.push("second"); });
  try { await setImmediate(); expect(order).toEqual(["first"]); }
  finally { release.resolve(); await Promise.allSettled([first, second]); }
  expect(order).toEqual(["first", "persisted", "second"]);
});

it("does not serialize unrelated credential files", async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const first = f.store().withLock(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  try { expect(await f.store("/home/test/other.enc").withLock(async () => "independent")).toBe("independent"); }
  finally { release.resolve(); await first; }
});

it("cancels a waiting instance without releasing another owner's lock", async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const first = f.store().withLock(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const controller = new AbortController(), reason = new Error("cancel instance waiter");
  const operation = vi.fn(async () => {});
  const waiter = f.store().withLock(operation, { signal: controller.signal }).catch(error => error);
  await setImmediate(); controller.abort(reason);
  try {
    expect(await waiter).toBe(reason);
    expect(operation).not.toHaveBeenCalled();
    const timedOut = await f.store().withLock(operation, { timeoutMs: 1 }).catch(error => error);
    expect(timedOut).toMatchObject({ message: expect.stringContaining("lock") });
    expect(operation).not.toHaveBeenCalled();
  } finally { release.resolve(); await first; }
});

it("releases failed transactions and returns operation failures unchanged", async () => {
  const f = fixture(), failure = new Error("transaction failed");
  await expect(f.store().withLock(async () => { throw failure; })).rejects.toBe(failure);
  expect(await f.store().withLock(async () => "after failure")).toBe("after failure");
});

it("rejects symbolic links in the lock path before executing the transaction", async () => {
  const f = fixture();
  await f.fs.mkdir("/home/test", { recursive: true });
  await f.fs.mkdir("/other", { recursive: true });
  await f.fs.symlink("/other", "/home/test/credential.enc.lock");
  const operation = vi.fn(async () => {});
  await expect(f.store().withLock(operation)).rejects.toThrow("symbolic link");
  expect(operation).not.toHaveBeenCalled();
});

it("recovers a dead owner's unique claim without deleting a live claim", async () => {
  const f = fixture();
  const deadPid = process.pid + 1_000_000;
  const directory = "/home/test/credential.enc.lock";
  await f.fs.mkdir(directory, { recursive: true });
  const abandoned = `${directory}/${deadPid}-abandoned.claim`;
  await f.fs.writeFile(abandoned, JSON.stringify({ ticket: 1 }));
  const kill = process.kill;
  const check = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (pid === deadPid) throw Object.assign(new Error("dead owner"), { code: "ESRCH" });
    return kill(pid, signal);
  });
  try {
    expect(await f.store().withLock(async () => "recovered")).toBe("recovered");
    expect(await f.fs.readdir(directory)).toEqual([]);
  } finally { check.mockRestore(); }
});

it("never steals a live owner's incomplete claim by age or expiry", async () => {
  const f = fixture(), directory = "/home/test/credential.enc.lock";
  await f.fs.mkdir(directory, { recursive: true });
  const incomplete = `${directory}/${process.pid}-incomplete.claim`;
  await f.fs.writeFile(incomplete, "");
  const operation = vi.fn(async () => {});
  await expect(f.store().withLock(operation, { timeoutMs: 1 })).rejects.toThrow("lock");
  expect(operation).not.toHaveBeenCalled();
  expect(await f.fs.readFile(incomplete, "utf8")).toBe("");
});

it("fails closed on a ticket overflow while retaining the current owner", async () => {
  const f = fixture(), directory = "/home/test/credential.enc.lock";
  await f.fs.mkdir(directory, { recursive: true });
  const owner = `${process.pid}-owner.claim`;
  await f.fs.writeFile(`${directory}/${owner}`, JSON.stringify({ ticket: Number.MAX_SAFE_INTEGER }));
  const operation = vi.fn(async () => {});
  await expect(f.store().withLock(operation)).rejects.toThrow("overflow");
  expect(operation).not.toHaveBeenCalled();
  expect(await f.fs.readdir(directory)).toEqual([owner]);
});

it("admits at most one concurrent owner when many instances choose tickets together", async () => {
  const f = fixture();
  let active = 0, maximum = 0, completed = 0;
  await Promise.all(Array.from({ length: 12 }, () => f.store().withLock(async () => {
    active++; maximum = Math.max(maximum, active);
    await setImmediate();
    active--; completed++;
  })));
  expect(maximum).toBe(1);
  expect(completed).toBe(12);
  expect(await f.fs.readdir("/home/test/credential.enc.lock")).toEqual([]);
});

it("locks the same Keychain service/account across instances without executing secret commands", async () => {
  const f = fixture();
  const runCommand = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
  const store = (account = "account") => new KeychainStore({ service: "service", account, runCommand, lock: { fs: f.fs, directory: "/home/test/keychain-locks" } });
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const operation = vi.fn(async () => "after owner");
  const first = store().withLock(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const second = store().withLock(operation);
  try {
    expect(await store("other-account").withLock(async () => "independent")).toBe("independent");
    await setImmediate(); expect(operation).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  } finally { release.resolve(); await Promise.allSettled([first, second]); }
  expect(await second).toBe("after owner");
  const names = await f.fs.readdir("/home/test/keychain-locks");
  expect(names).toHaveLength(2);
  expect(names.join(" ")).not.toContain("account");
  expect(names.join(" ")).not.toContain("service");
});

it.each(["file", "keychain", "raw"] as const)("retains %s lock cancellation while its initial path check waits", async kind => {
  const f = fixture(), entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  let waiting = true;
  const fs = { ...f.fs, lstat: async (...args: Parameters<typeof f.fs.lstat>) => {
    if (waiting) { waiting = false; entered.resolve(); await resume.promise; }
    return f.fs.lstat(...args);
  } };
  const controller = new AbortController(), reason = new Error("cancel original lock acquisition"), options = { signal: controller.signal };
  const operation = vi.fn(async () => "should not enter canceled lock");
  const store = kind === "file" ? new EncryptedFileStore({ fs, filePath: "/home/test/credential.enc", salt: "fixture" })
    : new KeychainStore({ service: "service", account: "account", lock: { fs, directory: "/home/test/keychain-locks" } });
  const lock = kind === "raw" ? withSecretStoreFileLock(fs, "/home/test/raw-lock", operation, options) : store.withLock(operation, options);
  const observed = lock.catch(error => error);
  try {
    await entered.promise;
    controller.abort(reason); options.signal = new AbortController().signal; resume.resolve();
    expect(await observed).toBe(reason); expect(operation).not.toHaveBeenCalled();
  } finally { resume.resolve(); await observed; }
});

it.each(["file", "keychain", "raw"] as const)("ignores an unrelated replacement %s lock signal during path checks", async kind => {
  const f = fixture(), entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  let waiting = true;
  const fs = { ...f.fs, lstat: async (...args: Parameters<typeof f.fs.lstat>) => {
    if (waiting) { waiting = false; entered.resolve(); await resume.promise; }
    return f.fs.lstat(...args);
  } };
  const options = { signal: new AbortController().signal }, operation = vi.fn(async () => "original lock policy");
  const store = kind === "file" ? new EncryptedFileStore({ fs, filePath: "/home/test/credential.enc", salt: "fixture" })
    : new KeychainStore({ service: "service", account: "account", lock: { fs, directory: "/home/test/keychain-locks" } });
  const lock = kind === "raw" ? withSecretStoreFileLock(fs, "/home/test/raw-lock", operation, options) : store.withLock(operation, options);
  const observed = lock.catch(error => error);
  try {
    await entered.promise;
    options.signal = AbortSignal.abort(new Error("unrelated replacement lock cancellation")); resume.resolve();
    expect(await observed).toBe("original lock policy"); expect(operation).toHaveBeenCalledOnce();
  } finally { resume.resolve(); await observed; }
});
