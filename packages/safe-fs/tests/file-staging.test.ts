import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { scopeFileSystem, retainFileSystemCleanup } from "../src/fs/scoped.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const parent = await fs.lstat("/work");
  const staged = await fs.createStagedFile("/work/.stage", "file", { type: "file", data: new Uint8Array([1, 2, 3]) }, { parent });
  return { fs, parent, staged };
}

test("owned staging publishes exact bytes and cleans only its private directory", async () => {
  const { fs, parent, staged } = await fixture();
  assert.ok(Object.isFrozen(staged) && Object.isFrozen(staged.file.stat));
  await fs.publishStagedFile(staged, "/work/output", { parent, destination: null });
  await fs.removeStagedFile(staged);
  assert.deepEqual(await fs.readFile("/work/output"), new Uint8Array([1, 2, 3]));
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["output"]);
});

for (const target of ["file", "directory", "parent"] as const) {
  test(`owned staging refuses a replaced ${target} during publication and cleanup`, async () => {
    const { fs, parent, staged } = await fixture();
    const path = staged[target].path;
    await fs.rename(path, `${path}-old`);
    if (target === "file") await fs.writeFile(path, new Uint8Array([9]));
    else await fs.mkdir(path);
    await assert.rejects(fs.publishStagedFile(staged, "/work/output", { parent, destination: null }));
    await assert.rejects(fs.removeStagedFile(staged));
    assert.equal((await fs.lstat(path)).type, target === "file" ? "file" : "directory");
  });
}

test("same-tick same-size writes invalidate the original staging revision", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1234);
  const { fs, parent, staged } = await fixture();
  await fs.writeFile(staged.file.path, new Uint8Array([4, 5, 6]));
  assert.equal((await fs.lstat(staged.file.path)).mtimeMs, staged.file.stat.mtimeMs);
  await assert.rejects(fs.publishStagedFile(staged, "/work/output", { parent, destination: null }), { code: "EAGAIN" });
  await assert.rejects(fs.removeStagedFile(staged), { code: "EAGAIN" });
  assert.deepEqual(await fs.readFile(staged.file.path), new Uint8Array([4, 5, 6]));
});

test("failed staging allocation leaves no directory and releases its metadata charge", async () => {
  const fs = createMemoryFileSystem({ maxFileBytes: 1, maxMetadataUnits: 7 });
  await fs.mkdir("/work");
  const parent = await fs.lstat("/work");
  await assert.rejects(fs.createStagedFile("/work/.stage", "file", { type: "file", data: new Uint8Array(2) }, { parent }), { code: "EFBIG" });
  assert.deepEqual(await fs.readdir("/work"), []);
  const staged = await fs.createStagedFile("/work/.stage", "file", { type: "file", data: new Uint8Array(1) }, { parent });
  await fs.removeStagedFile(staged);
});

test("retained atomic cleanup charges once after cancellation and refuses an exhausted budget", async () => {
  const { fs, staged } = await fixture();
  const controller = new AbortController();
  let cleanupCharges = 0;
  const scoped = scopeFileSystem(fs, () => {}, controller.signal, () => { cleanupCharges++; });
  let escapedCleanup: typeof fs.removeStagedFile | undefined;
  const close = retainFileSystemCleanup(scoped, view => {
    escapedCleanup = view.removeStagedFile!;
    return escapedCleanup(staged);
  }, { maxOperations: 1 });
  const denied = retainFileSystemCleanup(scoped, view => view.removeStagedFile!(staged), { maxOperations: 0 });
  controller.abort();
  await assert.rejects(denied(), { code: "EFBIG" });
  await close();
  await close();
  await assert.rejects(escapedCleanup!(staged), { code: "EBADF" });
  assert.equal(cleanupCharges, 1);
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("mount staging receipts preserve original identity while translating paths", async () => {
  const root = createMemoryFileSystem();
  const backend = createMemoryFileSystem();
  const fs = createMountFileSystem({ root, mounts: { "/mounted": backend } });
  const parent = await fs.lstat("/mounted");
  const staged = await fs.createStagedFile("/mounted/.stage", "file", { type: "file", data: new Uint8Array([7]) }, { parent });
  assert.equal(staged.file.path, "/mounted/.stage/file");
  await fs.publishStagedFile(staged, "/mounted/output", { parent, destination: null });
  await fs.removeStagedFile(staged);
  assert.deepEqual(await backend.readFile("/output"), new Uint8Array([7]));
});

test("quota wrappers withhold atomic staging instead of bypassing byte accounting", () => {
  const fs = withFileSystemQuota(createMemoryFileSystem(), { maxBytes: 1 });
  assert.equal(fs.capabilities.atomicFileStaging, false);
  assert.equal(fs.createStagedFile, undefined);
  assert.equal(fs.publishStagedFile, undefined);
  assert.equal(fs.removeStagedFile, undefined);
});

test("directory receipts reject a replacement but allow legitimate child mutations before metadata", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const parent = await fs.lstat("/work");
  const expected = await fs.prepareDirectory("/work/extracted", { parent, expected: null, mode: 0o755 });
  await fs.writeFile("/work/extracted/child", new Uint8Array([1]));
  const updated = await fs.prepareDirectory("/work/extracted", { parent, expected, mode: 0o700, mtimeMs: 1234 });
  assert.equal(updated.mtimeMs, 1234);
  await fs.rename("/work/extracted", "/work/original");
  await fs.mkdir("/work/extracted", { mode: 0o755 });
  await assert.rejects(fs.prepareDirectory("/work/extracted", { parent, expected: updated, mode: 0o000 }), { code: "EAGAIN" });
  assert.equal((await fs.lstat("/work/extracted")).mode & 0o777, 0o755);
});

test("directory creation rejects an exchanged parent before creating any child", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const parent = await fs.lstat("/work");
  await fs.rename("/work", "/old");
  await fs.mkdir("/work");
  await assert.rejects(fs.prepareDirectory("/work/child", { parent, expected: null }), { code: "EAGAIN" });
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("cleanup preserves every entry when an unexpected child occupies the owned directory", async () => {
  const { fs, staged } = await fixture();
  await fs.writeFile(`${staged.directory.path}/foreign`, new Uint8Array([9]));
  await assert.rejects(fs.removeStagedFile(staged), { code: "ENOTEMPTY" });
  assert.deepEqual(await fs.readFile(staged.file.path), new Uint8Array([1, 2, 3]));
  assert.deepEqual(await fs.readFile(`${staged.directory.path}/foreign`), new Uint8Array([9]));
});

test("same-tick destination changes cannot be replaced using an older receipt", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1234);
  const { fs, parent, staged } = await fixture();
  await fs.writeFile("/work/output", new Uint8Array([7, 8, 9]));
  const destination = await fs.lstat("/work/output");
  await fs.writeFile("/work/output", new Uint8Array([9, 8, 7]));
  await assert.rejects(fs.publishStagedFile(staged, "/work/output", { parent, destination }), { code: "EAGAIN" });
  await fs.removeStagedFile(staged);
  assert.deepEqual(await fs.readFile("/work/output"), new Uint8Array([9, 8, 7]));
});

test("mount publication refuses crossing into another backend without changing either side", async () => {
  const root = createMemoryFileSystem();
  const backend = createMemoryFileSystem();
  const fs = createMountFileSystem({ root, mounts: { "/mounted": backend } });
  const parent = await fs.lstat("/mounted");
  const staged = await fs.createStagedFile("/mounted/.stage", "file", { type: "file", data: new Uint8Array([7]) }, { parent });
  await assert.rejects(fs.publishStagedFile(staged, "/output", { parent: await fs.lstat("/"), destination: null }), { code: "EXDEV" });
  assert.deepEqual(await backend.readFile("/.stage/file"), new Uint8Array([7]));
  await assert.rejects(root.lstat("/output"), { code: "ENOENT" });
  await fs.removeStagedFile(staged);
});

test("mounted and scoped capability queries reject incomplete staging providers", async () => {
  const memory = createMemoryFileSystem();
  const incomplete = new Proxy(memory, { get(target, key) {
    if (key === "publishStagedFile") return undefined;
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const mounted = createMountFileSystem({ root: incomplete });
  assert.equal(mounted.capabilities.atomicFileStaging, false);
  assert.equal((await mounted.capabilitiesFor("/")).atomicFileStaging, false);
  const scoped = scopeFileSystem(incomplete, () => {}, new AbortController().signal);
  assert.equal(scoped.capabilities.atomicFileStaging, false);
  assert.equal((await scoped.capabilitiesFor?.("/") ?? scoped.capabilities).atomicFileStaging, false);
});

test("mount creation returns its original receipt when cancellation follows backend commit", async () => {
  const memory = createMemoryFileSystem();
  const controller = new AbortController();
  const backend = new Proxy(memory, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<typeof memory.createStagedFile>) => {
      const receipt = await memory.createStagedFile(...args);
      controller.abort(false);
      return receipt;
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const fs = createMountFileSystem({ root: backend });
  const staged = await fs.createStagedFile("/.stage", "file", { type: "file", data: new Uint8Array([7]) }, { parent: await fs.lstat("/"), signal: controller.signal });
  assert.equal(controller.signal.aborted, true);
  await fs.removeStagedFile(staged);
  assert.deepEqual(await memory.readdir("/"), []);
});

test("retained file metadata revisions advance when a directory entry is removed", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array([1]));
  const handle = await fs.openReadFile("/file");
  try {
    const before = await handle.stat();
    await fs.rm("/file");
    const after = await handle.stat();
    assert.equal(after.nlink, 0);
    assert.ok(after.revision! > before.revision!);
  } finally { await handle.close(); }
});

for (const kind of ["mount", "device", "scope"] as const) test(`${kind} refuses atomic methods when the backend withholds its guarantee`, async () => {
  const memory = createMemoryFileSystem();
  const backend = new Proxy(memory, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, atomicFileStaging: false, atomicDirectoryMetadata: false };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const fs = kind === "mount" ? createMountFileSystem({ root: backend }) : kind === "device" ? createDeviceFileSystem(backend) : scopeFileSystem(backend, () => {}, new AbortController().signal);
  const parent = await memory.lstat("/");
  await assert.rejects(fs.createStagedFile!("/.stage", "file", { type: "file", data: new Uint8Array([1]) }, { parent }), { code: "ENOTSUP" });
  await assert.rejects(fs.prepareDirectory!("/directory", { parent, expected: null }), { code: "ENOTSUP" });
  assert.deepEqual(await memory.readdir("/"), []);
});

test("scoped staging cannot start after cancellation during its capability query", async () => {
  const memory = createMemoryFileSystem();
  const controller = new AbortController();
  const backend = new Proxy(memory, { get(target, key) {
    if (key === "capabilitiesFor") return async () => {
      controller.abort(false);
      return target.capabilities;
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const fs = scopeFileSystem(backend, () => {}, controller.signal);
  await assert.rejects(fs.createStagedFile!("/.stage", "file", { type: "file", data: new Uint8Array([1]) }, { parent: await memory.lstat("/") }), reason => reason === false);
  assert.deepEqual(await memory.readdir("/"), []);
});

test("retained cleanup refuses a backend that withholds atomic staging", async () => {
  const { fs, staged } = await fixture();
  const backend = new Proxy(fs, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, atomicFileStaging: false };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const close = retainFileSystemCleanup(backend, view => view.removeStagedFile!(staged), { maxOperations: 1 });
  await assert.rejects(close(), { code: "ENOTSUP" });
  assert.deepEqual(await fs.readFile(staged.file.path), new Uint8Array([1, 2, 3]));
});
