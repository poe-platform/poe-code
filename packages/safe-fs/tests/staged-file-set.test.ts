import assert from "node:assert/strict";
import { test } from "vitest";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/db");
  await fs.writeFile("/db/logs.db", Uint8Array.of(1));
  await fs.writeFile("/db/logs.db-wal", Uint8Array.of(2));
  const parent = await fs.lstat("/db");
  const staged = await fs.createStagedFile("/db/.stage", "file", { type: "file", data: Uint8Array.of(3) }, { parent });
  const options = {
    parent,
    destination: await fs.lstat("/db/logs.db"),
    companions: [
      { path: "/db/logs.db-wal", expected: await fs.lstat("/db/logs.db-wal"), remove: true },
      { path: "/db/logs.db-journal", expected: null, remove: true },
    ],
  };
  return { fs, staged, options };
}

test("publishes a database and retires its checked source set together", async () => {
  const { fs, staged, options } = await fixture();
  const wal = await fs.openReadFile("/db/logs.db-wal");
  try {
    const published = await fs.publishStagedFileSet(staged, "/db/logs.db", options);
    assert.deepEqual(await fs.lstat("/db/logs.db"), published);
    assert.deepEqual(await fs.readFile("/db/logs.db"), Uint8Array.of(3));
    await assert.rejects(fs.lstat("/db/logs.db-wal"), { code: "ENOENT" });
    assert.deepEqual(await wal.read(0, 1), Uint8Array.of(2));
    await fs.removeStagedFile(staged);
    assert.deepEqual((await fs.readdir("/db")).map(entry => entry.name), ["logs.db"]);
  } finally { await wal.close(); }
});

for (const conflict of ["wal", "journal", "database"] as const) test(`rejects ${conflict} conflicts before any publication`, async () => {
  const { fs, staged, options } = await fixture();
  const path = conflict === "wal" ? "/db/logs.db-wal" : conflict === "journal" ? "/db/logs.db-journal" : "/db/logs.db";
  await fs.writeFile(path, Uint8Array.of(9));
  await assert.rejects(fs.publishStagedFileSet(staged, "/db/logs.db", options), { code: "EAGAIN" });
  assert.deepEqual(await fs.readFile("/db/logs.db"), Uint8Array.of(conflict === "database" ? 9 : 1));
  assert.deepEqual(await fs.readFile("/db/logs.db-wal"), Uint8Array.of(conflict === "wal" ? 9 : 2));
  assert.deepEqual(await fs.readFile(staged.file.path), Uint8Array.of(3));
});

test("rejects duplicate and non-sibling companions without removing files", async () => {
  for (const path of ["/db/logs.db", "/db/.stage/file", "/db/../db/logs.db-wal"]) {
    const { fs, staged, options } = await fixture();
    options.companions.push({ path, expected: await fs.lstat(path), remove: true });
    await assert.rejects(fs.publishStagedFileSet(staged, "/db/logs.db", options), { code: "EINVAL" });
    assert.deepEqual(await fs.readFile("/db/logs.db"), Uint8Array.of(1));
    assert.deepEqual(await fs.readFile("/db/logs.db-wal"), Uint8Array.of(2));
  }
});

test("only one competing source-set publication succeeds", async () => {
  const { fs, staged, options } = await fixture();
  const other = await fs.createStagedFile("/db/.other", "file", { type: "file", data: Uint8Array.of(4) }, { parent: options.parent });
  const outcomes = await Promise.allSettled([
    fs.publishStagedFileSet(staged, "/db/logs.db", options),
    fs.publishStagedFileSet(other, "/db/logs.db", options),
  ]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(result => result.status === "rejected")?.reason.code, "EAGAIN");
  assert.deepEqual(await fs.readFile("/db/logs.db"), Uint8Array.of(3));
});

test("check-only companions remain bound and unmodified", async () => {
  const { fs, staged, options } = await fixture();
  options.companions[0]!.remove = false;
  await fs.publishStagedFileSet(staged, "/db/logs.db", options);
  assert.deepEqual(await fs.lstat("/db/logs.db-wal"), options.companions[0]!.expected);
});

test("cancellation and guard failure leave the entire source set intact", async () => {
  for (const cancel of [true, false]) {
    const { fs, staged, options } = await fixture();
    const controller = new AbortController();
    const failure = new Error("stop");
    if (cancel) controller.abort(failure);
    await assert.rejects(fs.publishStagedFileSet(staged, "/db/logs.db", {
      ...options, signal: controller.signal,
      commitGuard: () => { throw failure; },
    }), error => error === failure);
    assert.deepEqual(await fs.readFile("/db/logs.db"), Uint8Array.of(1));
    assert.deepEqual(await fs.readFile("/db/logs.db-wal"), Uint8Array.of(2));
    assert.deepEqual(await fs.readFile(staged.file.path), Uint8Array.of(3));
  }
});

test("refuses directory permission failures before retiring companions", async () => {
  const { fs, staged, options } = await fixture();
  await fs.chmod("/db", 0o555);
  await assert.rejects(fs.publishStagedFileSet(staged, "/db/logs.db", options), { code: "EACCES" });
  assert.deepEqual(await fs.readFile("/db/logs.db"), Uint8Array.of(1));
  assert.deepEqual(await fs.readFile("/db/logs.db-wal"), Uint8Array.of(2));
});

test("reserves publication metadata before modifying any source entry", async () => {
  const fs = createMemoryFileSystem({ maxRetainedBytes: 256 });
  await fs.mkdir("/db");
  await fs.writeFile("/db/wal", Uint8Array.of(2));
  const parent = await fs.lstat("/db");
  const staged = await fs.createStagedFile("/db/.s", "f", { type: "file", data: Uint8Array.of(3) }, { parent });
  const destination = `/db/${"x".repeat(200)}`;
  await assert.rejects(fs.publishStagedFileSet(staged, destination, {
    parent, destination: null, companions: [{ path: "/db/wal", expected: await fs.lstat("/db/wal"), remove: true }],
  }), { code: "ENOSPC" });
  assert.deepEqual(await fs.readFile("/db/wal"), Uint8Array.of(2));
  assert.deepEqual(await fs.readFile(staged.file.path), Uint8Array.of(3));
  await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
});


test("quota wrappers withhold unsupported source-set mutation", async () => {
  const { fs } = await fixture();
  assert.equal(withFileSystemQuota(fs, { maxBytes: 100 }).publishStagedFileSet, undefined);
});


test("scoped source-set publication charges admission and preserves its receipt", async () => {
  const { fs, staged, options } = await fixture();
  let charges = 0;
  const scoped = scopeFileSystem(fs, () => { charges++; }, new AbortController().signal);
  assert.ok(scoped.publishStagedFileSet);
  const receipt = await scoped.publishStagedFileSet(staged, "/db/logs.db", options);
  assert.equal(charges, 1);
  assert.deepEqual(receipt, await fs.lstat("/db/logs.db"));
  await assert.rejects(fs.lstat("/db/logs.db-wal"), { code: "ENOENT" });
});

test("scoped publication observes scope cancellation at the atomic commit guard", async () => {
  const { fs, staged, options } = await fixture();
  const controller = new AbortController();
  const reason = new Error("scope retired");
  const view = new Proxy(fs, { get(target, key) {
    if (key === "publishStagedFileSet") return async (...args: Parameters<typeof fs.publishStagedFileSet>) => {
      controller.abort(reason);
      return target.publishStagedFileSet(...args);
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scoped = scopeFileSystem(view, () => {}, controller.signal);
  assert.ok(scoped.publishStagedFileSet);
  await assert.rejects(scoped.publishStagedFileSet(staged, "/db/logs.db", options), error => error === reason);
  assert.deepEqual(await fs.readFile("/db/logs.db"), Uint8Array.of(1));
  assert.deepEqual(await fs.readFile("/db/logs.db-wal"), Uint8Array.of(2));
});

test("scoped publication returns its committed receipt despite subsequent cancellation", async () => {
  const { fs, staged, options } = await fixture();
  const controller = new AbortController();
  const view = new Proxy(fs, { get(target, key) {
    if (key === "publishStagedFileSet") return async (...args: Parameters<typeof fs.publishStagedFileSet>) => {
      const receipt = await target.publishStagedFileSet(...args);
      controller.abort(new Error("after commit"));
      return receipt;
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scoped = scopeFileSystem(view, () => {}, controller.signal);
  assert.ok(scoped.publishStagedFileSet);
  const receipt = await scoped.publishStagedFileSet(staged, "/db/logs.db", options);
  assert.deepEqual(receipt, await fs.lstat("/db/logs.db"));
});


test("device and scope views preserve the complete source-set transaction", async () => {
  const { fs, staged, options } = await fixture();
  const scoped = scopeFileSystem(createDeviceFileSystem(fs), () => {}, new AbortController().signal);
  assert.ok(scoped.publishStagedFileSet);
  await scoped.publishStagedFileSet(staged, "/db/logs.db", options);
  assert.deepEqual(await fs.readFile("/db/logs.db"), Uint8Array.of(3));
  await assert.rejects(fs.lstat("/db/logs.db-wal"), { code: "ENOENT" });
});

test("device views refuse publication into the virtual device namespace", async () => {
  const { fs, staged, options } = await fixture();
  const view = createDeviceFileSystem(fs);
  assert.ok(view.publishStagedFileSet);
  await assert.rejects(view.publishStagedFileSet(staged, "/dev/null", options));
  assert.deepEqual(await fs.readFile("/db/logs.db"), Uint8Array.of(1));
  assert.deepEqual(await fs.readFile(staged.file.path), Uint8Array.of(3));
});


test("scope snapshots companion guards before a delayed backend observes them", async () => {
  const { fs, staged, options } = await fixture();
  const view = new Proxy(fs, { get(target, key) {
    if (key === "publishStagedFileSet") return async (...args: Parameters<typeof fs.publishStagedFileSet>) => {
      await Promise.resolve();
      options.companions[0]!.remove = false;
      return target.publishStagedFileSet(...args);
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scoped = scopeFileSystem(view, () => {}, new AbortController().signal);
  await scoped.publishStagedFileSet!(staged, "/db/logs.db", options);
  await assert.rejects(fs.lstat("/db/logs.db-wal"), { code: "ENOENT" });
});

test("scope budget and path admission failures preserve all source entries", async () => {
  for (const limitedPath of [true, false]) {
    const { fs, staged, options } = await fixture();
    const scoped = scopeFileSystem(fs, () => { if (!limitedPath) throw new Error("operation limit"); }, new AbortController().signal,
      () => {}, { maxPathComponents: 2 });
    await assert.rejects(scoped.publishStagedFileSet!(staged, "/db/logs.db", options));
    assert.deepEqual(await fs.readFile("/db/logs.db"), Uint8Array.of(1));
    assert.deepEqual(await fs.readFile("/db/logs.db-wal"), Uint8Array.of(2));
  }
});

test("device source routes cannot change into virtual devices before commit", async () => {
  const { fs, staged, options } = await fixture();
  await fs.symlink("/db", "/alias");
  const backend = new Proxy(fs, { get(target, key) {
    if (key === "publishStagedFileSet") return async (...args: Parameters<typeof fs.publishStagedFileSet>) => {
      await target.rm("/alias");
      await target.symlink("/dev", "/alias");
      return target.publishStagedFileSet(...args);
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const view = createDeviceFileSystem(backend);
  await assert.rejects(view.publishStagedFileSet!(staged, "/alias/logs.db", {
    ...options, companions: options.companions.map(entry => ({ ...entry, path: entry.path.replace("/db/", "/alias/") })),
  }), { code: "EAGAIN" });
  assert.deepEqual(await fs.readFile("/db/logs.db"), Uint8Array.of(1));
  assert.deepEqual(await fs.readFile("/db/logs.db-wal"), Uint8Array.of(2));
});
