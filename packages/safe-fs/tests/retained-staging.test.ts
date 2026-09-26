import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { createReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { RealFileSystem } from "../src/fs/real/index.js";
import { FsError, type FileSystem, type StagedFileContent } from "../src/contracts/index.js";

const data = new Uint8Array([1, 2, 3]);
const foreign = new Uint8Array([9]);
function view(base: FileSystem, methods: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    const owner = key in methods ? methods : target;
    const value: unknown = Reflect.get(owner, key);
    return typeof value === "function" ? value.bind(owner) : value;
  } });
}
async function stage(fs: FileSystem, path = "/work/.stage", content: StagedFileContent = { type: "file", data }) {
  const staged = await fs.createStagedFile!(path, "file", content, {
    parent: await fs.lstat(path.slice(0, path.lastIndexOf("/"))), retainCleanup: true,
  });
  assert.ok(staged.cleanup, "retained staging must return its cleanup handle");
  return { staged, cleanup: staged.cleanup };
}

for (const kind of ["memory", "mount", "device", "scope", "scope-mount"] as const) {
  for (const mutation of ["none", "parent", "replace", "ancestor"] as const) for (const published of [false, true]) {
    test(`retained staging ${kind}: ${mutation}, published=${published}`, async () => {
      const backing = createMemoryFileSystem();
      await backing.mkdir("/outer/work", { recursive: true });
      let fs: FileSystem = backing;
      const mounted = kind.includes("mount");
      if (mounted) fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/mnt": fs } });
      if (kind === "device") fs = createDeviceFileSystem(fs);
      const controller = new AbortController();
      let charges = 0, cleanupCharges = 0;
      if (kind.includes("scope")) fs = scopeFileSystem(fs, () => { charges++; }, controller.signal, () => { cleanupCharges++; });
      const prefix = mounted ? "/mnt" : "";
      const { staged, cleanup } = await stage(fs, `${prefix}/outer/work/.stage`);
      if (published) await fs.publishStagedFile!(staged, `${prefix}/outer/work/output`, {
        parent: await fs.lstat(`${prefix}/outer/work`), destination: null,
      });
      let relocated = "/outer/work";
      if (mutation === "ancestor") { await backing.rename("/outer", "/held"); relocated = "/held/work"; }
      if (mutation === "parent" || mutation === "replace") { await backing.rename("/outer/work", "/held"); relocated = "/held"; }
      if (mutation === "replace") { await backing.mkdir("/outer/work"); await backing.writeFile("/outer/work/foreign", foreign); }
      if (kind.includes("scope")) controller.abort(false);
      const charged = charges;
      await Promise.all([cleanup.remove(), cleanup.remove(), cleanup.close()]);
      await cleanup.close();
      assert.equal(charges, charged);
      assert.equal(cleanupCharges, kind.includes("scope") ? 1 : 0);
      assert.deepEqual((await backing.readdir(relocated)).map(entry => entry.name), published ? ["output"] : []);
      if (published) assert.deepEqual(await backing.readFile(`${relocated}/output`), data);
      if (mutation === "replace") assert.deepEqual(await backing.readFile("/outer/work/foreign"), foreign);
    });
  }
}

for (const type of ["file", "symlink"] as const) for (const route of ["remove", "publish", "abandon"] as const) {
  test(`retained staging refunds exact node accounting: ${type}, ${route}`, async () => {
    const fs = createMemoryFileSystem({ maxMetadataUnits: 10, maxRetainedBytes: 256, maxBytes: 3 });
    await fs.mkdir("/work");
    for (let round = 0; round < 5; round++) {
      const { staged, cleanup } = await stage(fs, "/work/.stage", type === "file" ? { type, data } : { type, target: "target" });
      if (route === "publish") await fs.publishStagedFile(staged, "/work/output", { parent: await fs.lstat("/work"), destination: null });
      if (route === "abandon") {
        await cleanup.close(); await cleanup.close();
        await assert.rejects(cleanup.remove(), { code: "EBADF" });
        await fs.removeStagedFile(staged);
      } else {
        await cleanup.remove(); await cleanup.close();
      }
      if (route === "publish") {
        if (type === "file") assert.deepEqual(await fs.readFile("/work/output"), data);
        else assert.equal(await fs.readlink("/work/output"), "target");
        await fs.rm("/work/output");
      }
    }
    assert.deepEqual(await fs.readdir("/work"), []);
  });
}

test("retained staging reserves before creation and rolls back failed allocation", async () => {
  const fs = createMemoryFileSystem({ maxMetadataUnits: 9 });
  await fs.mkdir("/work");
  for (let round = 0; round < 2; round++) {
    await assert.rejects(stage(fs), { code: "ENOSPC" });
    assert.deepEqual(await fs.readdir("/work"), []);
    const staged = await fs.createStagedFile("/work/.stage", "file", { type: "file", data }, { parent: await fs.lstat("/work") });
    assert.equal(staged.cleanup, undefined);
    await fs.removeStagedFile(staged);
  }
});

for (const mutation of ["write", "replace-file", "replace-directory", "foreign-child", "private-mode", "parent-mode", "delete-parent"] as const) {
  test(`retained cleanup refuses ${mutation} and releases retained nodes`, async () => {
    const fs = createMemoryFileSystem({ maxMetadataUnits: 30, maxBytes: 3 });
    await fs.mkdir("/work");
    const { cleanup } = await stage(fs);
    await fs.rename("/work", "/held");
    if (mutation === "write") await fs.writeFile("/held/.stage/file", new Uint8Array([3, 2, 1]));
    if (mutation === "replace-file") { await fs.rm("/held/.stage/file"); await fs.writeFile("/held/.stage/file", new Uint8Array()); }
    if (mutation === "replace-directory") { await fs.rename("/held/.stage", "/held/old"); await fs.mkdir("/held/.stage"); }
    if (mutation === "foreign-child") await fs.writeFile("/held/.stage/foreign", new Uint8Array());
    if (mutation === "private-mode") await fs.chmod("/held/.stage", 0o755);
    if (mutation === "parent-mode") await fs.chmod("/held", 0o555);
    if (mutation === "delete-parent") await fs.rm("/held", { recursive: true });
    const failure = mutation === "foreign-child" ? "ENOTEMPTY" : mutation === "parent-mode" ? "EACCES" : "EAGAIN";
    const removal = cleanup.remove();
    await assert.rejects(removal, { code: failure });
    assert.equal(cleanup.remove(), removal, "repeated removal shares failure and does not retry mutation");
    await cleanup.close();
    if (mutation !== "delete-parent") {
      if (mutation === "parent-mode") await fs.chmod("/held", 0o755);
      const path = mutation === "replace-directory" ? "/held/old/file" : "/held/.stage/file";
      assert.deepEqual(await fs.readFile(path), mutation === "write" ? new Uint8Array([3, 2, 1]) : mutation === "replace-file" ? new Uint8Array() : data);
      if (mutation === "foreign-child") assert.equal((await fs.lstat("/held/.stage/foreign")).type, "file");
      await fs.rm("/held", { recursive: true });
    }
    await fs.writeFile("/new", data);
  });
}

for (const reason of [false, null, new FsError("EFBIG")] as const) test(`scope cleanup admission failure releases references: ${String(reason)}`, async () => {
  const memory = createMemoryFileSystem({ maxBytes: 3 });
  await memory.mkdir("/work");
  let cleanupCharges = 0;
  const fs = scopeFileSystem(memory, () => {}, new AbortController().signal, () => { cleanupCharges++; throw reason; });
  const { cleanup } = await stage(fs);
  await memory.rm("/work", { recursive: true });
  await assert.rejects(cleanup.remove(), error => error === reason);
  await cleanup.close();
  assert.equal(cleanupCharges, 1);
  await memory.writeFile("/new", data);
});

test("Mount cancellation before cleanup dispatch still releases backend references", async () => {
  const memory = createMemoryFileSystem({ maxBytes: 3 });
  await memory.mkdir("/work");
  const fs = createMountFileSystem({ root: memory });
  const { cleanup } = await stage(fs);
  await memory.rm("/work", { recursive: true });
  const controller = new AbortController(); controller.abort(false);
  await assert.rejects(cleanup.remove({ signal: controller.signal }), error => error === false);
  await cleanup.close();
  await memory.writeFile("/new", data);
});

test("scope returns cleanup authority when cancellation follows backend staging creation", async () => {
  const memory = createMemoryFileSystem(); await memory.mkdir("/work");
  const controller = new AbortController();
  const backend = view(memory, { createStagedFile: async (...args) => {
    const staged = await memory.createStagedFile(...args); controller.abort(false); return staged;
  } });
  const fs = scopeFileSystem(backend, () => {}, controller.signal, () => {});
  const { cleanup } = await stage(fs);
  await cleanup.remove();
  assert.deepEqual(await memory.readdir("/work"), []);
});

for (const kind of ["mount", "scope", "device"] as const) test(`${kind} rejects unsupported retained creation before backend mutation`, async () => {
  const memory = createMemoryFileSystem(); await memory.mkdir("/work");
  let creations = 0;
  const backend = view(memory, {
    capabilities: { ...memory.capabilities, retainedStagingCleanup: false },
    createStagedFile: async (...args) => { creations++; return memory.createStagedFile(...args); },
  });
  const fs = kind === "mount" ? createMountFileSystem({ root: backend }) : kind === "scope" ? scopeFileSystem(backend, () => {}, new AbortController().signal) : createDeviceFileSystem(backend);
  await assert.rejects(stage(fs), { code: "ENOTSUP" });
  assert.equal(creations, 0);
  assert.deepEqual(await memory.readdir("/work"), []);
});

test("quota and readonly views withhold retained cleanup capability", async () => {
  for (const fs of [withFileSystemQuota(createMemoryFileSystem(), { maxBytes: 3 }), createReadOnlyFileSystem(createMemoryFileSystem())]) {
    assert.equal(fs.capabilities.retainedStagingCleanup, false);
    assert.notEqual((await fs.capabilitiesFor?.("/") ?? fs.capabilities).retainedStagingCleanup, true);
  }
});

test("Real refuses retained cleanup before resolving or creating host paths", async () => {
  const fs = new RealFileSystem({ root: "/nonexistent-retained-staging-test-root" });
  const parent = await createMemoryFileSystem().lstat("/");
  await assert.rejects(fs.createStagedFile("/.stage", "file", { type: "file", data }, { parent, retainCleanup: true }), { code: "ENOTSUP" });
});

for (const type of ["file", "symlink"] as const) for (const route of ["failure", "close"] as const) {
  test(`deleted staging releases every reference: ${type}, ${route}`, async () => {
    const fs = createMemoryFileSystem({ maxMetadataUnits: 10, maxRetainedBytes: 128, maxBytes: 3 });
    for (let round = 0; round < 4; round++) {
      await fs.mkdir("/work");
      const { cleanup } = await stage(fs, "/work/.stage", type === "file" ? { type, data } : { type, target: "target" });
      await fs.rm("/work", { recursive: true });
      if (route === "failure") await assert.rejects(cleanup.remove(), { code: "EAGAIN" });
      await cleanup.close();
    }
    assert.deepEqual(await fs.readdir("/"), []);
  });
}

for (const kind of ["mount", "scope"] as const) test(`${kind} close drains admitted cleanup before releasing its backend`, async () => {
  const memory = createMemoryFileSystem(); await memory.mkdir("/work");
  let enter!: () => void, resume!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const blocked = new Promise<void>(resolve => { resume = resolve; });
  let backendClosed = false;
  const backend = view(memory, { createStagedFile: async (...args) => {
    const staged = await memory.createStagedFile(...args);
    const cleanup = staged.cleanup!;
    return { ...staged, cleanup: {
      async remove(options) { enter(); await blocked; assert.equal(backendClosed, false); await cleanup.remove(options); },
      async close() { backendClosed = true; await cleanup.close(); },
    } };
  } });
  const fs = kind === "mount" ? createMountFileSystem({ root: backend }) : scopeFileSystem(backend, () => {}, new AbortController().signal);
  const { cleanup } = await stage(fs);
  const removal = cleanup.remove();
  await entered;
  const closing = cleanup.close();
  assert.equal(cleanup.remove(), removal);
  assert.equal(backendClosed, false);
  resume();
  await Promise.all([removal, closing]);
  assert.equal(backendClosed, true);
  assert.deepEqual(await memory.readdir("/work"), []);
});

for (const failRemoval of [false, true]) test(`scope preserves cleanup release errors only without an earlier failure: ${failRemoval}`, async () => {
  const memory = createMemoryFileSystem(); await memory.mkdir("/work");
  const closeError = new Error("release failed");
  let releases = 0;
  const backend = view(memory, { createStagedFile: async (...args) => {
    const staged = await memory.createStagedFile(...args);
    return { ...staged, cleanup: {
      async remove(options) { if (failRemoval) throw null; await staged.cleanup!.remove(options); },
      async close() { releases++; await staged.cleanup!.close(); throw closeError; },
    } };
  } });
  const { cleanup } = await stage(scopeFileSystem(backend, () => {}, new AbortController().signal));
  await assert.rejects(cleanup.remove(), error => error === (failRemoval ? null : closeError));
  await assert.rejects(cleanup.close(), error => error === closeError);
  assert.equal(releases, 1);
});

test("nested mount cleanup uses retained authority without querying vanished paths", async () => {
  const memory = createMemoryFileSystem(); await memory.mkdir("/work");
  let relocated = false, queries = 0;
  const backend = view(memory, { capabilitiesFor: async path => {
    queries++;
    if (relocated) throw new FsError("ENOENT", { path });
    return memory.capabilities;
  } });
  const inner = createMountFileSystem({ root: backend });
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/nested": inner } });
  const { cleanup } = await stage(fs, "/nested/work/.stage");
  await memory.rename("/work", "/held"); relocated = true;
  const before = queries;
  await cleanup.remove();
  assert.equal(queries, before);
  assert.deepEqual(await memory.readdir("/held"), []);
});

test("mounted retained-cleanup capability requires complete staging support", async () => {
  const memory = createMemoryFileSystem();
  const backend = view(memory, { capabilities: { ...memory.capabilities, atomicFileStaging: false } });
  const fs = createMountFileSystem({ root: backend });
  assert.equal(fs.capabilities.retainedStagingCleanup, false);
  assert.equal((await fs.capabilitiesFor("/")).retainedStagingCleanup, false);
});

test("retained cleanup preserves a successfully removed receipt after caller cancellation", async () => {
  const memory = createMemoryFileSystem(); await memory.mkdir("/work");
  const controller = new AbortController();
  const backend = view(memory, { createStagedFile: async (...args) => {
    const staged = await memory.createStagedFile(...args);
    return { ...staged, cleanup: {
      async remove(options) { await staged.cleanup!.remove(options); controller.abort(false); },
      close: () => staged.cleanup!.close(),
    } };
  } });
  const { cleanup } = await stage(createMountFileSystem({ root: backend }));
  await cleanup.remove({ signal: controller.signal });
  assert.deepEqual(await memory.readdir("/work"), []);
});

test("restricted extraction view supports retained staging within its roots", async () => {
  const memory = createMemoryFileSystem(); await memory.mkdir("/work");
  await memory.mkdir("/outside");
  const fs = await memory.confineExtraction(["/work"]);
  assert.equal(fs.capabilities.retainedStagingCleanup, true);
  await assert.rejects(stage(fs, "/outside/.stage"), { code: "EPERM" });
  const { staged, cleanup } = await stage(fs);
  try {
    const parent = await memory.lstat("/outside");
    await assert.rejects(async () => fs.publishStagedFile!(staged, "/outside/output", {
      parent, destination: null,
    }), { code: "EPERM" });
    await cleanup.remove();
  } finally { await cleanup.close(); }
  assert.deepEqual(await memory.readdir("/work"), []);
  assert.deepEqual(await memory.readdir("/outside"), []);
});

test("retained cleanup includes path and data bytes in pre-creation capacity", async () => {
  // /work name (8), staging names (20), data (3), retained paths (68).
  for (const maxRetainedBytes of [98, 99]) {
    const fs = createMemoryFileSystem({ maxRetainedBytes, maxMetadataUnits: 10 });
    await fs.mkdir("/work");
    for (let round = 0; round < 3; round++) {
      if (maxRetainedBytes === 98) {
        await assert.rejects(stage(fs), { code: "ENOSPC" });
        assert.deepEqual(await fs.readdir("/work"), []);
      } else {
        const { cleanup } = await stage(fs);
        await cleanup.remove();
      }
    }
  }
});

for (const kind of ["memory", "mount", "scope", "device"] as const) test(`${kind} captures the retained cleanup request once before acquisition`, async () => {
  const memory = createMemoryFileSystem({ maxMetadataUnits: 10 });
  await memory.mkdir("/work");
  let fs: FileSystem = memory;
  if (kind === "mount") fs = createMountFileSystem({ root: memory });
  if (kind === "scope") fs = scopeFileSystem(memory, () => {}, new AbortController().signal);
  if (kind === "device") fs = createDeviceFileSystem(memory);
  const parent = await fs.lstat("/work");
  for (let round = 0; round < 3; round++) {
    let reads = 0;
    const staged = await fs.createStagedFile!("/work/.stage", "file", { type: "file", data }, {
      parent, get retainCleanup() { return ++reads <= 5; },
    });
    assert.equal(reads, 1);
    assert.ok(staged.cleanup);
    await staged.cleanup.remove();
  }
});

test("Real validates a captured cleanup request before host resolution", async () => {
  const fs = new RealFileSystem({ root: "/nonexistent-retained-staging-test-root" });
  const parent = await createMemoryFileSystem().lstat("/");
  let reads = 0;
  await assert.rejects(fs.createStagedFile("/.stage", "file", { type: "file", data }, {
    parent, get retainCleanup() { return ++reads === 1; },
  }), { code: "ENOTSUP" });
  assert.equal(reads, 1);
});

for (const kind of ["memory", "mount", "scope", "device", "real"] as const) test(`${kind} rejects invalid retained options through its promise`, async () => {
  const memory = createMemoryFileSystem(); await memory.mkdir("/work");
  let fs: FileSystem = memory;
  if (kind === "mount") fs = createMountFileSystem({ root: memory });
  if (kind === "scope") fs = scopeFileSystem(memory, () => {}, new AbortController().signal);
  if (kind === "device") fs = createDeviceFileSystem(memory);
  if (kind === "real") fs = new RealFileSystem({ root: "/nonexistent-retained-staging-test-root" });
  const operation = fs.createStagedFile!("/work/.stage", "file", { type: "file", data }, {
    parent: await memory.lstat("/work"), retainCleanup: "true" as unknown as boolean,
  });
  assert.ok(operation instanceof Promise);
  await assert.rejects(operation, { code: "EINVAL" });
  assert.deepEqual(await memory.readdir("/work"), []);
});

test("captured creation controls preserve inherited option properties", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/work");
  const parent = await fs.lstat("/work");
  class Options {
    get parent() { return parent; }
    get retainCleanup() { return true; }
    get mode() { return 0o640; }
  }
  const staged = await fs.createStagedFile("/work/.stage", "file", { type: "file", data }, new Options());
  assert.ok(staged.cleanup);
  assert.equal((await fs.lstat(staged.file.path)).mode & 0o777, 0o640);
  await staged.cleanup.remove();
});
