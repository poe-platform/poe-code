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

test("quota wrappers withhold atomic staging instead of bypassing byte accounting", async () => {
  const fs = withFileSystemQuota(createMemoryFileSystem(), { maxBytes: 1 });
  assert.equal(fs.capabilities.atomicFileStaging, false);
  assert.equal(fs.capabilities.atomicStagingAncestry, false);
  assert.equal((await fs.capabilitiesFor!("/new")).atomicStagingAncestry, false);
  assert.equal(fs.prepareDirectoryAncestry, undefined);
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

test("staging ancestry requires the complete root-to-parent list", async () => {
  const { fs, parent, staged } = await fixture();
  const ancestors = [{ path: "/", stat: await fs.lstat("/") }, { path: "/work", stat: parent }];
  await assert.rejects(fs.publishStagedFile(staged, "/work/output", { parent, destination: null, ancestors: ancestors.slice(1) }), { code: "EINVAL" });
  await assert.rejects(fs.lstat("/work/output"));
  await fs.publishStagedFile(staged, "/work/output", { parent, destination: null, ancestors });
  await fs.removeStagedFile(staged);
  assert.deepEqual(await fs.readFile("/work/output"), new Uint8Array([1, 2, 3]));
});

test("mount views withhold ancestry when the backend lacks commit guards", async () => {
  const memory = createMemoryFileSystem();
  const backend = new Proxy(memory, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, guardedStagingPublication: false };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const fs = createMountFileSystem({ root: backend });
  assert.equal(fs.capabilities.atomicStagingAncestry, false);
  assert.equal((await fs.capabilitiesFor("/output", { create: true, stagingAncestry: true })).atomicStagingAncestry, false);
});

test("Memory checks a synchronous publication guard before replacing bytes", async () => {
  const { fs, parent, staged } = await fixture();
  assert.equal(fs.capabilities.guardedStagingPublication, true);
  let calls = 0;
  const reason = new Error("outer identity changed");
  await assert.rejects(fs.publishStagedFile(staged, "/work/output", {
    parent, destination: null, commitGuard() { calls++; throw reason; },
  }), error => error === reason);
  assert.equal(calls, 1);
  await assert.rejects(fs.lstat("/work/output"), { code: "ENOENT" });
  await fs.publishStagedFile(staged, "/work/output", { parent, destination: null, commitGuard: () => true });
  await fs.removeStagedFile(staged);
});

test("an accidentally asynchronous publication guard cannot authorize replacement", async () => {
  const { fs, parent, staged } = await fixture();
  const asynchronous = (async () => { throw new Error("late refusal"); }) as unknown as () => true;
  await assert.rejects(fs.publishStagedFile(staged, "/work/output", {
    parent, destination: null, commitGuard: asynchronous,
  }), { code: "ENOTSUP" });
  await Promise.resolve();
  await assert.rejects(fs.lstat("/work/output"), { code: "ENOENT" });
  await fs.removeStagedFile(staged);
});

test("guard callbacks cannot rewrite the caller's expected destination receipt", async () => {
  const { fs, parent, staged } = await fixture();
  await fs.writeFile("/work/output", new Uint8Array([42]));
  await fs.writeFile("/work/replacement", new Uint8Array([77]));
  const destination = await fs.lstat("/work/output");
  const replacement = await fs.lstat("/work/replacement");
  await assert.rejects(fs.publishStagedFile(staged, "/work/output", { parent, destination, commitGuard() {
    void fs.rename("/work/replacement", "/work/output");
    Object.assign(destination, replacement);
    return true;
  } }), { code: "EAGAIN" });
  assert.deepEqual(await fs.readFile("/work/output"), new Uint8Array([77]));
  await fs.removeStagedFile(staged);
});

test("publication rejects an accidentally asynchronous prepared ancestry validator", async () => {
  const { fs, parent, staged } = await fixture();
  const ancestors = [{ path: "/", stat: await fs.lstat("/") }, { path: "/work", stat: parent }];
  const invalidGuard = (async () => {
    throw new Error("late ancestry refusal");
  }) as unknown as () => true;
  vi.spyOn(fs, "prepareDirectoryAncestry").mockResolvedValue(invalidGuard);
  const mounted = createMountFileSystem({ root: fs });
  await assert.rejects(mounted.publishStagedFile(staged, "/work/output", { parent, destination: null, ancestors }), { code: "ENOTSUP" });
  await assert.rejects(fs.lstat("/work/output"), { code: "ENOENT" });
  await fs.removeStagedFile(staged);
});

for (const malformed of [[], ["/work"], ["/", "/work", "/"], ["/", "/work/../work"]]) {
  test(`synchronous ancestry refuses malformed prefix ${JSON.stringify(malformed)}`, async () => {
    const { fs, parent } = await fixture();
    await assert.rejects(fs.prepareDirectoryAncestry(malformed.map(path => ({ path, stat: parent }))));
  });
}

for (const wrap of ["none", "scope", "device", "selected"] as const) {
  test(`guarded shared-backend mount publication supports ${wrap} view`, async () => {
    const memory = createMemoryFileSystem();
    await memory.mkdir("/work");
    await memory.writeFile("/work/target", new Uint8Array([42]));
    const backend = wrap === "scope" ? scopeFileSystem(memory, () => {}, new AbortController().signal)
      : wrap === "device" ? createDeviceFileSystem(memory)
      : wrap === "selected" ? new Proxy(memory, { get(target, key) {
        if (key === "capabilities") return { ...target.capabilities, synchronousDirectoryValidation: false };
        if (key === "capabilitiesFor") return async () => target.capabilities;
        const member: unknown = Reflect.get(target, key);
        return typeof member === "function" ? member.bind(target) : member;
      } }) : memory;
    const fs = createMountFileSystem({ root: backend, mounts: { "/alias": backend } });
    const path = "/alias/work/target";
    const ancestors = await Promise.all(["/", "/alias", "/alias/work"].map(async path => ({ path, stat: await fs.lstat(path) })));
    assert.notEqual(fs.capabilities.atomicStagingAncestry, false);
    assert.equal((await fs.capabilitiesFor(path, { stagingAncestry: true })).atomicStagingAncestry, true);
    const staged = await fs.createStagedFile("/alias/.stage", "entry", { type: "file", data: new Uint8Array([9]) }, { parent: ancestors[1]!.stat });
    await fs.publishStagedFile(staged, path, { parent: ancestors[2]!.stat, destination: await fs.lstat(path), ancestors });
    await fs.removeStagedFile(staged);
    assert.deepEqual(await memory.readFile("/work/target"), new Uint8Array([9]));
  });
}

test("virtual device and synthetic mount ancestors cannot advertise staging ancestry", async () => {
  const device = createDeviceFileSystem(createMemoryFileSystem());
  const deviceAncestors = await Promise.all(["/", "/dev"].map(async path => ({ path, stat: await device.lstat(path) })));
  await assert.rejects(device.prepareDirectoryAncestry!(deviceAncestors), { code: "ENOTSUP" });
  const root = createMemoryFileSystem(), leaf = createMemoryFileSystem();
  const fs = createMountFileSystem({ root, mounts: { "/synthetic/leaf": leaf } });
  assert.equal((await fs.capabilitiesFor("/synthetic/leaf/output", { create: true, stagingAncestry: true })).atomicStagingAncestry, false);
  assert.notEqual(fs.capabilities.synchronousDirectoryValidation, true);
  assert.equal((await fs.capabilitiesFor("/synthetic/leaf", { stagingAncestry: true })).synchronousDirectoryValidation, false);
});

test("synchronous directory validation rejects stale identities and revoked search permission", async () => {
  const { fs, parent, staged } = await fixture();
  const ancestors = [{ path: "/", stat: await fs.lstat("/") }, { path: "/work", stat: parent }];
  const verify = await fs.prepareDirectoryAncestry(ancestors);
  assert.equal(verify(), true);
  await fs.writeFile("/work/sibling", new Uint8Array([8]));
  assert.equal(verify(), true);
  await fs.chmod("/work", 0);
  assert.throws(verify, { code: "EACCES" });
  await fs.chmod("/work", 0o755);
  await fs.rename("/work", "/held");
  await fs.mkdir("/work");
  assert.throws(verify, { code: "EAGAIN" });
  assert.deepEqual(await fs.readFile("/held/.stage/file"), new Uint8Array([1, 2, 3]));
  await assert.rejects(fs.removeStagedFile(staged));
});

test("scoped directory validation stays synchronous and charges its own operation", async () => {
  const fs = createMemoryFileSystem();
  const ancestors = [{ path: "/", stat: await fs.lstat("/") }];
  const controller = new AbortController();
  let charged = 0;
  const scoped = scopeFileSystem(fs, () => { charged++; }, controller.signal);
  const verify = await scoped.prepareDirectoryAncestry!(ancestors);
  assert.equal(charged, 1);
  assert.equal(verify(), true);
  assert.equal(charged, 2);
  controller.abort(false);
  assert.throws(verify, error => error === false);
  assert.equal(charged, 2);
});

for (const change of ["none", "outer-directory", "outer-link", "outer-permission", "leaf-directory", "destination", "abort"] as const) {
  test(`mounted staging binds every authority at leaf publication: ${change}`, async () => {
    const root = createMemoryFileSystem(), leaf = createMemoryFileSystem();
    const controller = new AbortController();
    await root.mkdir("/outer");
    await leaf.mkdir("/work");
    await leaf.writeFile("/work/target", new Uint8Array([42]));
    let publications = 0;
    const delayed = new Proxy(leaf, { get(target, key) {
      if (key === "publishStagedFile") return async (...args: Parameters<typeof leaf.publishStagedFile>) => {
        publications++;
        if (change === "outer-directory" || change === "outer-link") {
          await root.rename("/outer", "/held");
          if (change === "outer-directory") await root.mkdir("/outer");
          else await root.symlink("/held", "/outer");
        } else if (change === "outer-permission") await root.chmod("/outer", 0);
        else if (change === "leaf-directory") {
          await leaf.rename("/work", "/held");
          await leaf.mkdir("/work");
          await leaf.writeFile("/work/target", new Uint8Array([77]));
        } else if (change === "destination") await leaf.writeFile("/work/target", new Uint8Array([77]));
        else if (change === "abort") controller.abort(false);
        return leaf.publishStagedFile(...args);
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const fs = createMountFileSystem({ root, mounts: { "/outer/leaf": delayed } });
    const path = "/outer/leaf/work/target";
    const ancestors = await Promise.all(["/", "/outer", "/outer/leaf", "/outer/leaf/work"].map(async path => ({ path, stat: await fs.lstat(path) })));
    assert.equal((await fs.capabilitiesFor(path, { stagingAncestry: true })).atomicStagingAncestry, true);
    const parent = ancestors.at(-1)!.stat;
    const destination = await fs.lstat(path);
    const staged = await fs.createStagedFile("/outer/leaf/.stage", "entry", { type: "file", data: new Uint8Array([9]) }, { parent: ancestors[2]!.stat });
    const publication = fs.publishStagedFile(staged, path, { parent, destination, ancestors, signal: controller.signal });
    if (change === "none") await publication;
    else await assert.rejects(publication, error => change === "abort" ? error === false
      : typeof error === "object" && error !== null && "code" in error && error.code === (change === "outer-permission" ? "EACCES" : "EAGAIN"));
    assert.equal(publications, 1);
    assert.deepEqual(await leaf.readFile("/work/target"), new Uint8Array([change === "none" ? 9 : change === "destination" || change === "leaf-directory" ? 77 : 42]));
    if (change === "leaf-directory") assert.deepEqual(await leaf.readFile("/held/target"), new Uint8Array([42]));
  });
}


test("device ancestry publication refuses virtual ancestors even with backing receipts", async () => {
  const memory = createMemoryFileSystem();
  await memory.mkdir("/dev/work", { recursive: true });
  const fs = createDeviceFileSystem(memory);
  const parent = await memory.lstat("/dev/work");
  const staged = await fs.createStagedFile!("/dev/work/.stage", "file", { type: "file", data: new Uint8Array([9]) }, { parent });
  const ancestors = await Promise.all(["/", "/dev", "/dev/work"].map(async path => ({ path, stat: await memory.lstat(path) })));
  assert.equal((await fs.capabilitiesFor!("/dev/work/output", { create: true, stagingAncestry: true })).atomicStagingAncestry, false);
  await assert.rejects(fs.publishStagedFile!(staged, "/dev/work/output", { parent, destination: null, ancestors }), { code: "ENOTSUP" });
  assert.deepEqual(await memory.readFile(staged.file.path), new Uint8Array([9]));
  await fs.publishStagedFile!(staged, "/dev/work/output", { parent, destination: null });
  assert.deepEqual(await memory.readFile("/dev/work/output"), new Uint8Array([9]));
});

test("scope admits guarded publication at the destination", async () => {
  const { fs, staged, parent } = await fixture();
  const selected = new Proxy(fs, { get(target, key) {
    if (key === "capabilitiesFor") return async (path: string) => ({ ...target.capabilities, guardedStagingPublication: path !== "/work/output" });
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scoped = scopeFileSystem(selected, () => {}, new AbortController().signal);
  await assert.rejects(scoped.publishStagedFile!(staged, "/work/output", { parent, destination: null, commitGuard: () => true }), { code: "ENOTSUP" });
  assert.deepEqual(await fs.readFile(staged.file.path), new Uint8Array([1, 2, 3]));
});

test("scope rejects unavailable directory validation before preparing a guard", async () => {
  const fs = createMemoryFileSystem();
  const prepare = vi.spyOn(fs, "prepareDirectoryAncestry");
  const selected = new Proxy(fs, { get(target, key) {
    if (key === "capabilitiesFor") return async () => ({ ...target.capabilities, synchronousDirectoryValidation: false });
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scoped = scopeFileSystem(selected, () => {}, new AbortController().signal);
  await assert.rejects(scoped.prepareDirectoryAncestry!([{ path: "/", stat: await fs.lstat("/") }]), { code: "ENOTSUP" });
  assert.equal(prepare.mock.calls.length, 0);
});

for (const phase of ["query", "factory"] as const) test(`scope forwards cancellation during ancestry ${phase}`, async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  let forwarded: AbortSignal | undefined;
  const selected = new Proxy(fs, { get(target, key) {
    if (phase === "query" && key === "capabilitiesFor") return async (_path: string, options: { signal?: AbortSignal }) => {
      forwarded = options.signal;
      controller.abort(false);
      return target.capabilities;
    };
    if (phase === "factory" && key === "prepareDirectoryAncestry") return async (_entries: unknown, options: { signal?: AbortSignal }) => {
      forwarded = options?.signal;
      controller.abort(false);
      return () => true;
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scoped = scopeFileSystem(selected, () => {}, controller.signal);
  await assert.rejects(scoped.prepareDirectoryAncestry!([{ path: "/", stat: await fs.lstat("/") }]), error => error === false);
  assert.equal(forwarded?.aborted, true);
});

test("scope rejects an invalid validator factory result during preparation", async () => {
  const fs = createMemoryFileSystem();
  vi.spyOn(fs, "prepareDirectoryAncestry").mockResolvedValue(true as unknown as () => true);
  const scoped = scopeFileSystem(fs, () => {}, new AbortController().signal);
  await assert.rejects(scoped.prepareDirectoryAncestry!([{ path: "/", stat: await fs.lstat("/") }]), { code: "ENOTSUP" });
});


for (const wrapper of ["mount", "scope", "device", "scope-device"] as const) for (const change of ["outer-missing", "outer-file", "outer-link", "leaf-missing", "leaf-link", "leaf-loop", "target-directory", "target-link"] as const) {
  test(`${wrapper} bound publication reports stale entries before dispatch: ${change}`, async () => {
    const root = createMemoryFileSystem(), leaf = createMemoryFileSystem();
    await root.mkdir("/outer");
    await leaf.mkdir("/work");
    await leaf.writeFile("/work/target", new Uint8Array([42]));
    const fs = createMountFileSystem({ root, mounts: { "/outer/leaf": leaf } });
    const ancestors = await Promise.all(["/", "/outer", "/outer/leaf", "/outer/leaf/work"].map(async path => ({ path, stat: await fs.lstat(path) })));
    const parent = ancestors.at(-1)!.stat;
    const destination = await fs.lstat("/outer/leaf/work/target");
    const staged = await fs.createStagedFile("/outer/leaf/.stage", "entry", { type: "file", data: new Uint8Array([9]) }, { parent: ancestors[2]!.stat });
    if (change.startsWith("outer-")) {
      await root.rename("/outer", "/held");
      if (change === "outer-file") await root.writeFile("/outer", new Uint8Array([77]));
      if (change === "outer-link") await root.symlink("/held", "/outer");
    } else if (change.startsWith("leaf-")) {
      await leaf.rename("/work", "/held");
      if (change === "leaf-link") await leaf.symlink("/held", "/work");
      if (change === "leaf-loop") await leaf.symlink("/work", "/work");
    } else {
      await leaf.rename("/work/target", "/original");
      if (change === "target-directory") await leaf.mkdir("/work/target");
      else await leaf.symlink("/original", "/work/target");
    }
    const view = wrapper === "scope" ? scopeFileSystem(fs, () => {}, new AbortController().signal)
      : wrapper === "device" ? createDeviceFileSystem(fs)
      : wrapper === "scope-device" ? scopeFileSystem(createDeviceFileSystem(fs), () => {}, new AbortController().signal) : fs;
    await assert.rejects(view.publishStagedFile!(staged, "/outer/leaf/work/target", { parent, destination, ancestors }), { code: "EAGAIN" });
    assert.deepEqual(await leaf.readFile("/.stage/entry"), new Uint8Array([9]));
    const original = change.startsWith("leaf-") ? "/held/target" : change.startsWith("target-") ? "/original" : "/work/target";
    assert.deepEqual(await leaf.readFile(original), new Uint8Array([42]));
  });
}

for (const wrapper of ["memory", "mount"] as const) test(`ancestry without authoritative identity is unsupported on ${wrapper}`, async () => {
  const memory = createMemoryFileSystem();
  await memory.mkdir("/work");
  const root = await memory.lstat("/");
  const { identityScope: ignored, ...unknown } = await memory.lstat("/work");
  await memory.rmdir("/work");
  const fs = wrapper === "memory" ? memory : createMountFileSystem({ root: memory });
  await assert.rejects(async () => {
    const guard = await fs.prepareDirectoryAncestry!([{ path: "/", stat: root }, { path: "/work", stat: unknown }]);
    guard();
  }, { code: "ENOTSUP" });
});

test("synthetic ancestor receipts are unsupported at validator preparation", async () => {
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/synthetic/leaf": createMemoryFileSystem() } });
  const entries = await Promise.all(["/", "/synthetic", "/synthetic/leaf"].map(async path => ({ path, stat: await fs.lstat(path) })));
  await assert.rejects(fs.prepareDirectoryAncestry(entries), { code: "ENOTSUP" });
});


for (const cancellation of ["scope", "operation"] as const) {
  for (const phase of ["query", "publisher"] as const) test(`staged publication observes ${cancellation} cancellation during ${phase}`, async () => {
    const { fs, parent, staged } = await fixture();
    const scope = new AbortController(), operation = new AbortController();
    const controller = cancellation === "scope" ? scope : operation;
    const delayed = new Proxy(fs, { get(target, key) {
      if (phase === "query" && key === "capabilitiesFor") return async () => {
        controller.abort(false);
        throw Object.assign(new Error("query failed after cancellation"), { code: "EACCES" });
      };
      if (phase === "publisher" && key === "publishStagedFile") return async (...args: Parameters<typeof fs.publishStagedFile>) => {
        controller.abort(false);
        return target.publishStagedFile(...args);
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const scoped = scopeFileSystem(delayed, () => {}, scope.signal);
    await assert.rejects(scoped.publishStagedFile!(staged, "/work/output", {
      parent, destination: null, commitGuard: () => true, signal: operation.signal,
    }), error => error === false);
    assert.deepEqual(await fs.readFile(staged.file.path), new Uint8Array([1, 2, 3]));
    await assert.rejects(fs.lstat("/work/output"), { code: "ENOENT" });
  });
}

test("scoped staged publication preserves success when cancellation follows commit", async () => {
  const { fs, parent, staged } = await fixture();
  const controller = new AbortController();
  const delayed = new Proxy(fs, { get(target, key) {
    if (key === "publishStagedFile") return async (...args: Parameters<typeof fs.publishStagedFile>) => {
      await target.publishStagedFile(...args);
      controller.abort(false);
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scoped = scopeFileSystem(delayed, () => {}, controller.signal);
  await scoped.publishStagedFile!(staged, "/work/output", { parent, destination: null, commitGuard: () => true });
  assert.deepEqual(await fs.readFile("/work/output"), new Uint8Array([1, 2, 3]));
});


for (const wrapper of ["mount", "device"] as const) test(`ancestry preparation preserves cancellation after ${wrapper} capability failure`, async () => {
  const memory = createMemoryFileSystem(), controller = new AbortController();
  const ancestors = [{ path: "/", stat: await memory.lstat("/") }];
  const backend = new Proxy(memory, { get(target, key) {
    if (key === "capabilitiesFor") return async () => {
      controller.abort(false);
      throw Object.assign(new Error("query failed"), { code: "EIO" });
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const fs = wrapper === "mount" ? createMountFileSystem({ root: backend }) : createDeviceFileSystem(backend);
  await assert.rejects(fs.prepareDirectoryAncestry!(ancestors, { signal: controller.signal }), error => error === false);
});

for (const outcome of ["throw", "unsupported"] as const) test(`mounted ancestry publication preserves cancellation after ${outcome} admission`, async () => {
  const { fs: memory, parent, staged } = await fixture();
  const controller = new AbortController();
  const ancestors = [{ path: "/", stat: await memory.lstat("/") }, { path: "/work", stat: parent }];
  const backend = new Proxy(memory, { get(target, key) {
    if (key === "capabilitiesFor") return async (_path: string, options: { stagingAncestry?: boolean }) => {
      if (options.stagingAncestry && _path === "/work/output") {
        controller.abort(false);
        if (outcome === "throw") throw Object.assign(new Error("query failed"), { code: "EIO" });
        return { ...target.capabilities, atomicStagingAncestry: false };
      }
      return target.capabilities;
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const fs = createMountFileSystem({ root: backend });
  await assert.rejects(fs.publishStagedFile(staged, "/work/output", { parent, destination: null, ancestors, signal: controller.signal }), error => error === false);
  assert.deepEqual(await memory.readFile(staged.file.path), new Uint8Array([1, 2, 3]));
});

for (const missing of ["/work", "/work/output"] as const) test(`ancestry capability refuses incomplete identity at ${missing}`, async () => {
  const memory = createMemoryFileSystem();
  await memory.mkdir("/work");
  await memory.writeFile("/work/output", new Uint8Array([42]));
  const backend = new Proxy(memory, { get(target, key) {
    if (key === "lstat") return async (...args: Parameters<typeof memory.lstat>) => {
      const stat = await target.lstat(...args);
      if (args[0] !== missing) return stat;
      const { ino: ignored, ...partial } = stat;
      return partial;
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const fs = createMountFileSystem({ root: backend });
  assert.equal((await fs.capabilitiesFor("/work/output", { stagingAncestry: true })).atomicStagingAncestry, false);
});


for (const change of ["ancestor", "destination"] as const) test(`mounted publication catches ${change} replacement during capability admission`, async () => {
  const { fs: memory, parent, staged } = await fixture();
  await memory.writeFile("/work/output", new Uint8Array([42]));
  const ancestors = [{ path: "/", stat: await memory.lstat("/") }, { path: "/work", stat: parent }];
  const destination = await memory.lstat("/work/output");
  const backend = new Proxy(memory, { get(target, key) {
    if (key === "capabilitiesFor") return async (_path: string, options: { stagingAncestry?: boolean }) => {
      if (options.stagingAncestry && _path === "/work/output") {
        if (change === "ancestor") {
          await memory.rename("/work", "/held");
          await memory.mkdir("/work");
        } else {
          await memory.rename("/work/output", "/saved");
          await memory.mkdir("/work/output");
        }
        return { ...target.capabilities, atomicStagingAncestry: false };
      }
      return target.capabilities;
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const fs = createMountFileSystem({ root: backend });
  await assert.rejects(fs.publishStagedFile(staged, "/work/output", { parent, destination, ancestors }), { code: "EAGAIN" });
  assert.deepEqual(await memory.readFile(change === "ancestor" ? "/held/output" : "/saved"), new Uint8Array([42]));
});


test("nested memory mounts expose and prepare complete directory validation", async () => {
  const inner = createMountFileSystem({ root: createMemoryFileSystem() });
  const fs = createMountFileSystem({ root: inner });
  await fs.mkdir("/work");
  const ancestors = await Promise.all(["/", "/work"].map(async path => ({ path, stat: await fs.lstat(path) })));
  assert.equal((await fs.capabilitiesFor("/work", { stagingAncestry: true })).synchronousDirectoryValidation, true);
  assert.equal((await fs.prepareDirectoryAncestry(ancestors))(), true);
});

test("quota views clear unsupported ancestry-staging capabilities", async () => {
  const fs = withFileSystemQuota(createMemoryFileSystem(), { maxBytes: 1024 });
  assert.equal(fs.capabilities.atomicFileStaging, false);
  assert.equal(fs.capabilities.atomicStagingAncestry, false);
  assert.equal((await fs.capabilitiesFor!("/new", { create: true })).atomicFileStaging, false);
  assert.equal((await fs.capabilitiesFor!("/new", { create: true })).atomicStagingAncestry, false);
});
