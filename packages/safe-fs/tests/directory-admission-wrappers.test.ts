import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { DirectoryEntry, FsOptions } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";

const bounded = (maxEntries: number, signal?: AbortSignal): FsOptions & { maxEntries: number } => ({ maxEntries, ...(signal ? { signal } : {}) });
async function directory(names: readonly string[]) {
  const fs = new MemoryFileSystem();
  for (const name of names) await fs.writeFile(`/${name}`, new Uint8Array());
  return fs;
}

test("readonly admits the complete backend result before copying entries", async () => {
  const backend = await directory([]);
  let inspected = 0;
  const entries = ["a", "b"].map(name => ({ get name() { inspected++; return name; }, type: "file" as const }));
  const read = vi.spyOn(backend, "readdir").mockResolvedValue(entries);
  const fs = new ReadOnlyFileSystem(backend);
  const options = bounded(1);
  await assert.rejects(fs.readdir("/", options), { code: "EFBIG" });
  assert.equal(read.mock.calls[0]?.[1], options);
  assert.equal(inspected, 0);
});

test("readonly preserves omitted order and forwards zero, validation and cancellation", async () => {
  const backend = await directory([]);
  const read = vi.spyOn(backend, "readdir").mockResolvedValue([{ name: "z", type: "file" }, { name: "a", type: "file" }]);
  const fs = new ReadOnlyFileSystem(backend);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["z", "a"]);
  await assert.rejects(fs.readdir("/", bounded(0)), { code: "EFBIG" });
  read.mockClear();
  await assert.rejects(fs.readdir("/", bounded(-1)), { code: "EINVAL" });
  assert.equal(read.mock.calls.length, 0);
  const caller = new AbortController(); caller.abort(false);
  await assert.rejects(fs.readdir("/", bounded(-1, caller.signal)), reason => Object.is(reason, false));
  assert.equal(read.mock.calls.length, 0);
});

test("readonly omission delegates pre-aborted reads with their exact options and reason", async () => {
  const backend = await directory([]);
  const read = vi.spyOn(backend, "readdir");
  const fs = new ReadOnlyFileSystem(backend);
  for (const reason of [new Error("delegate cancellation"), false, null, 0, ""]) {
    const options = { signal: AbortSignal.abort(reason) };
    read.mockClear();
    await assert.rejects(fs.readdir("/", options), actual => Object.is(actual, reason));
    assert.equal(read.mock.calls.length, 1);
    assert.equal(read.mock.calls[0]?.[1], options);
  }
});

test("readonly omission retains the backend outcome instead of adding cancellation policy", async () => {
  const backend = await directory([]);
  const entry = { name: "a", type: "file" as const };
  const caller = new AbortController();
  const read = vi.spyOn(backend, "readdir").mockImplementation(async () => {
    caller.abort(false);
    return [entry];
  });
  const fs = new ReadOnlyFileSystem(backend);
  const options = { signal: caller.signal };
  const result = await fs.readdir("/", options);
  assert.deepEqual(result, [entry]);
  assert.notEqual(result[0], entry);
  const failure = new Error("delegate failure");
  read.mockRejectedValue(failure);
  await assert.rejects(fs.readdir("/", options), actual => actual === failure);
});

test("quota transparently forwards directory admission options", async () => {
  const backend = await directory([]);
  const read = vi.spyOn(backend, "readdir");
  const options = bounded(0);
  assert.deepEqual(await withFileSystemQuota(backend, { maxBytes: 64 }).readdir("/", options), []);
  assert.equal(read.mock.calls[0]?.[1], options);
});

test("mount passes the full limit and counts duplicate mount overrides only once", async () => {
  const root = await directory(["a", "b"]);
  const read = vi.spyOn(root, "readdir");
  const fs = new MountFileSystem({ root, mounts: { "/b": await directory([]) } });
  const options = bounded(2);
  assert.deepEqual(await fs.readdir("/", options), [{ name: "a", type: "file" }, { name: "b", type: "directory" }]);
  assert.equal(read.mock.calls[0]?.[1], options);
});

test("mount rejects the distinct synthetic union and noncompliant backend results", async () => {
  const root = await directory(["a"]);
  const fs = new MountFileSystem({ root, mounts: { "/b": await directory([]) } });
  await assert.rejects(fs.readdir("/", bounded(1)), { code: "EFBIG" });
  vi.spyOn(root, "readdir").mockResolvedValue([{ name: "a", type: "file" }, { name: "c", type: "file" }]);
  await assert.rejects(fs.readdir("/", bounded(1)), { code: "EFBIG" });
  const synthetic = new MountFileSystem({ root: await directory([]), mounts: { "/nested/child": await directory([]) } });
  await assert.rejects(synthetic.readdir("/nested", bounded(0)), { code: "EFBIG" });
});

test("overlay caps the distinct candidate union before child lookups", async () => {
  const upper = await directory(["a"]), lower = await directory(["b"]);
  const upperRead = vi.spyOn(upper, "readdir"), lowerRead = vi.spyOn(lower, "readdir");
  const upperStat = vi.spyOn(upper, "lstat"), lowerStat = vi.spyOn(lower, "lstat");
  const fs = new OverlayFileSystem({ upper, lower });
  const options = bounded(1);
  await assert.rejects(fs.readdir("/", options), { code: "EFBIG" });
  assert.equal(upperRead.mock.calls[0]?.[1], options);
  assert.equal(lowerRead.mock.calls[0]?.[1], options);
  assert.equal([...upperStat.mock.calls, ...lowerStat.mock.calls].filter(([path]) => path === "/a" || path === "/b").length, 0);
});

test("overlay duplicate names fit one slot but whiteouts still count as candidates", async () => {
  const upper = await directory(["a"]), lower = await directory(["a"]);
  const fs = new OverlayFileSystem({ upper, lower });
  assert.deepEqual(await fs.readdir("/", bounded(1)), [{ name: "a", type: "file" }]);
  await lower.writeFile("/hidden", new Uint8Array());
  await fs.rm("/hidden");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["a"]);
  await assert.rejects(fs.readdir("/", bounded(1)), { code: "EFBIG" });
});

test("overlay opaque directories do not enumerate the lower layer", async () => {
  const upper = await directory([]), lower = await directory([]);
  await lower.mkdir("/dir"); await lower.writeFile("/dir/a", new Uint8Array());
  const fs = new OverlayFileSystem({ upper, lower });
  await fs.rm("/dir", { recursive: true }); await fs.mkdir("/dir");
  const read = vi.spyOn(lower, "readdir");
  assert.deepEqual(await fs.readdir("/dir", bounded(0)), []);
  assert.equal(read.mock.calls.length, 0);
});

for (const wrapper of ["mount", "overlay"] as const) test(`${wrapper} rejects a noncompliant duplicate array before iterating it`, async () => {
  const backend = await directory(["a"]);
  let inspected = 0;
  backend.readdir = async () => Array.from({ length: 3 }, () => ({ get name() { inspected++; return "a"; }, type: "file" as const }));
  const fs = wrapper === "mount" ? new MountFileSystem({ root: backend }) : new OverlayFileSystem({ upper: backend, lower: await directory([]) });
  await assert.rejects(fs.readdir("/", bounded(1)), { code: "EFBIG" });
  assert.equal(inspected, 0);
});

for (const wrapper of ["mount", "overlay", "readonly"] as const) test(`${wrapper} preserves cancellation before over-limit backend publication`, async () => {
  const backend = await directory([]), caller = new AbortController();
  backend.readdir = async () => { caller.abort(null); return [{ name: "a", type: "file" }] as DirectoryEntry[]; };
  const fs = wrapper === "mount" ? new MountFileSystem({ root: backend }) : wrapper === "overlay" ? new OverlayFileSystem({ upper: backend, lower: await directory([]) }) : new ReadOnlyFileSystem(backend);
  await assert.rejects(fs.readdir("/", bounded(0, caller.signal)), reason => Object.is(reason, null));
});
