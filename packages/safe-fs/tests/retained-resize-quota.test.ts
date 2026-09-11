import assert from "node:assert/strict";
import { test } from "vitest";
import type { FileResizeHandle, FileStat, FileSystem, FsOptions } from "../src/contracts/filesystem.js";
import { FsError } from "../src/contracts/errors.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { withFileSystemQuota, FileSystemQuotaError } from "../src/fs/quota/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

function controlled() {
  const memory = new MemoryFileSystem();
  const scope = {};
  const entries = new Map<string, FileStat>();
  const calls = { open: 0, truncate: 0, close: 0, compare: 0 };
  let inode = 0;
  const node = (size: number, overrides: Partial<FileStat> = {}): FileStat => ({ type: "file", size, mode: 0o600, mtimeMs: 0, ctimeMs: 0, atimeMs: 0, identityScope: scope, dev: 1, ino: ++inode, ...overrides });
  const lookup = (path: string): FileStat => {
    const entry = entries.get(path);
    if (!entry) throw new FsError("ENOENT", { path });
    return entry;
  };
  const handles: FileResizeHandle[] = [];
  const overrides: { -readonly [Key in keyof FileSystem]?: FileSystem[Key] } = {
    capabilities: { ...memory.capabilities, retainedResize: true },
    async stat(path) { return { ...lookup(path) }; },
    async lstat(path) { return { ...lookup(path) }; },
    async readdir(path) {
      const prefix = path === "/" ? "/" : path + "/";
      const children = new Map<string, "directory" | "file" | "symlink" | "character">();
      for (const [name, entry] of entries) if (name.startsWith(prefix)) {
        const suffix = name.slice(prefix.length);
        const separator = suffix.indexOf("/");
        children.set(separator < 0 ? suffix : suffix.slice(0, separator), separator < 0 ? entry.type : "directory");
      }
      return Array.from(children, ([name, type]) => ({ name, type }));
    },
    async writeFile(path, data) {
      const current = entries.get(path);
      if (current) Object.assign(current, { size: data.length });
      else entries.set(path, node(data.length));
    },
    async compareEntry() { calls.compare++; throw new Error("retained census must not compare the opening pathname"); },
    async openResizeFile(path, options) {
      calls.open++;
      if (!entries.has(path) && options?.create) entries.set(path, node(0));
      const pinned = lookup(path);
      let closed = false;
      const handle: FileResizeHandle = {
        async stat() { if (closed) throw new FsError("EBADF"); return { ...pinned }; },
        async truncate(length) { if (closed) throw new FsError("EBADF"); calls.truncate++; Object.assign(pinned, { size: length }); },
        async close() { calls.close++; closed = true; },
      };
      handles.push(handle);
      return handle;
    },
  };
  const fs = new Proxy(memory as FileSystem, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { fs, entries, node, calls, handles, overrides };
}

test("quota returns a guarded retained resize handle and meters all visible aliases", async () => {
  const host = controlled();
  const file = host.node(6);
  host.entries.set("/file", file);
  host.entries.set("/alias", file);
  const quota = withFileSystemQuota(host.fs, { maxBytes: 20 });
  const handle = await quota.openResizeFile!("/file");
  assert.notEqual(handle, host.handles[0]);
  assert.equal(quota.capabilities.retainedResize, true);
  await assert.rejects(handle.truncate(11), FileSystemQuotaError);
  assert.equal(file.size, 6);
  await handle.truncate(10);
  assert.equal(file.size, 10);
  assert.equal(host.calls.compare, 0);
  await handle.close();
});

test("retained quota charges repeated mount views rather than physical nlink", async () => {
  const host = controlled();
  const file = host.node(3, { nlink: 1 });
  host.entries.set("/left/file", file);
  host.entries.set("/right/file", file);
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 9 }).openResizeFile!("/left/file");
  await assert.rejects(handle.truncate(5), FileSystemQuotaError);
  assert.equal(file.size, 3);
  await handle.truncate(4);
  await handle.close();
});

test("retained quota follows the pinned identity after opening-path replacement", async () => {
  const host = controlled();
  const file = host.node(4);
  host.entries.set("/file", file);
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 12 }).openResizeFile!("/file");
  host.entries.set("/moved", file);
  host.entries.set("/alias", file);
  const replacement = host.node(2);
  host.entries.set("/file", replacement);
  await assert.rejects(handle.truncate(6), FileSystemQuotaError);
  await handle.truncate(5);
  assert.equal(replacement.size, 2);
  assert.equal(file.size, 5);
  assert.equal(host.calls.compare, 0);
  await handle.close();
});

test("retained quota never credits shrink against a replacement or unlinked opening path", async () => {
  const host = controlled();
  const original = host.node(10);
  host.entries.set("/file", original);
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 10 }).openResizeFile!("/file");
  host.entries.set("/file", host.node(12));
  await assert.rejects(handle.truncate(0), FileSystemQuotaError);
  assert.equal(original.size, 10);
  host.entries.clear();
  await assert.rejects(handle.truncate(21), FileSystemQuotaError);
  await handle.truncate(0);
  assert.equal(original.size, 0);
  await handle.close();
});

test("retained shrink credits at most one freshly confirmed visible alias", async () => {
  const host = controlled();
  const file = host.node(6);
  host.entries.set("/file", file);
  host.entries.set("/alias", file);
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 10 }).openResizeFile!("/file");
  await handle.truncate(4);
  assert.equal(file.size, 4);
  await handle.close();
});

test("retained quota treats incomplete census identities as possible aliases", async () => {
  const host = controlled();
  const file = host.node(4);
  host.entries.set("/file", file);
  const { identityScope: omitted, ...unknown } = host.node(4);
  assert.ok(omitted);
  host.entries.set("/unknown", unknown);
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 10 }).openResizeFile!("/file");
  await assert.rejects(handle.truncate(6), FileSystemQuotaError);
  assert.equal(host.calls.compare, 0);
  assert.equal(file.size, 4);
  await handle.close();
});

test("retained quota distinguishes complete disjoint identity scopes", async () => {
  const host = controlled();
  host.entries.set("/file", host.node(1));
  host.entries.set("/other", host.node(1, { identityScope: {}, ino: 1 }));
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 5 }).openResizeFile!("/file");
  await handle.truncate(4);
  assert.equal(host.entries.get("/other")!.size, 1);
  await handle.close();
});

for (const key of ["identityScope", "dev", "ino"] as const) test(`retained quota fails closed without pinned ${key}`, async () => {
  const host = controlled();
  const file = { ...host.node(1) };
  delete file[key];
  host.entries.set("/file", file);
  const quota = withFileSystemQuota(host.fs, { maxBytes: 10 });
  await assert.rejects(quota.openResizeFile!("/file"), { code: "ENOTSUP" });
  assert.equal(host.calls.close, 1);
  assert.equal(host.calls.truncate, 0);
});

test("retained quota rejects handle identity drift instead of rebinding", async () => {
  const host = controlled();
  const file = host.node(1);
  host.entries.set("/file", file);
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 10 }).openResizeFile!("/file");
  Object.assign(file, { ino: 99 });
  await assert.rejects(handle.truncate(2), { code: "EIO" });
  assert.equal(file.size, 1);
  await handle.close();
});

test("retained creation is admitted at zero before effect and later growth is separately charged", async () => {
  const host = controlled();
  const open = host.overrides.openResizeFile!;
  host.overrides.openResizeFile = async (path, options) => {
    const handle = await open(path, options);
    host.entries.set("/other/new", host.entries.get(path)!);
    return handle;
  };
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 3 }).openResizeFile!("/first/new", { create: true });
  await assert.rejects(handle.truncate(2), FileSystemQuotaError);
  assert.equal(host.entries.get("/first/new")!.size, 0);
  assert.equal(host.entries.get("/other/new")!.size, 0);
  await handle.truncate(1);
  await handle.close();
});

test("retained creation cannot mutate an already over-quota namespace", async () => {
  const host = controlled();
  host.entries.set("/existing", host.node(4));
  await assert.rejects(withFileSystemQuota(host.fs, { maxBytes: 3 }).openResizeFile!("/new", { create: true }), FileSystemQuotaError);
  assert.equal(host.calls.open, 0);
  assert.equal(host.entries.has("/new"), false);
});

test("retained creation census fails before open when aliases exceed scan admission", async () => {
  const host = controlled();
  host.entries.set("/existing", host.node(0));
  await assert.rejects(withFileSystemQuota(host.fs, { maxBytes: 3, maxScanEntries: 0 }).openResizeFile!("/new", { create: true }), { code: "EFBIG" });
  assert.equal(host.calls.open, 0);
});

test("retained resizes share the ordinary mutation queue", async () => {
  const host = controlled();
  host.entries.set("/left", host.node(4));
  host.entries.set("/right", host.node(4));
  const quota = withFileSystemQuota(host.fs, { maxBytes: 10 });
  const left = await quota.openResizeFile!("/left");
  const right = await quota.openResizeFile!("/right");
  const outcomes = await Promise.allSettled([left.truncate(6), right.truncate(6), quota.writeFile("/extra", new Uint8Array(1))]);
  assert.equal(outcomes[0]!.status, "fulfilled");
  for (const result of outcomes.slice(1)) { assert.equal(result.status, "rejected"); if (result.status === "rejected") assert.ok(result.reason instanceof FileSystemQuotaError); }
  await Promise.all([left.close(), right.close()]);
});

test("retained close synchronously rejects admission and drains queued work once", async () => {
  const host = controlled();
  host.entries.set("/file", host.node(1));
  const open = host.overrides.openResizeFile!;
  const entered = deferred();
  const release = deferred();
  host.overrides.openResizeFile = async (path, options) => {
    const raw = await open(path, options);
    return { ...raw, async truncate(length, operationOptions) { entered.resolve(); await release.promise; await raw.truncate(length, operationOptions); } };
  };
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 4 }).openResizeFile!("/file");
  const first = handle.truncate(2);
  const second = handle.truncate(3);
  await entered.promise;
  let settled = false;
  const closing = handle.close();
  assert.equal(handle.close(), closing);
  const observed = closing.then(() => { settled = true; });
  try {
    await assert.rejects(handle.stat(), { code: "EBADF" });
    await assert.rejects(handle.truncate(4), { code: "EBADF" });
    await turn();
    assert.equal(settled, false);
    assert.equal(host.calls.close, 0);
  } finally { release.resolve(); }
  await Promise.all([first, second, observed]);
  assert.equal(host.entries.get("/file")!.size, 3);
  assert.equal(host.calls.close, 1);
});

for (const reason of [false, 0, "", null, undefined, NaN]) test(`retained acquisition failure preserves ${String(reason)} over close failure`, async () => {
  const host = controlled();
  host.overrides.openResizeFile = async () => ({ async stat() { throw reason; }, async truncate() { assert.fail("mutation forbidden"); }, async close() { host.calls.close++; throw new Error("secondary close"); } });
  let caught = false;
  try { await withFileSystemQuota(host.fs, { maxBytes: 1 }).openResizeFile!("/file"); }
  catch (error) { caught = true; assert.equal(error, reason); }
  assert.equal(caught, true);
  assert.equal(host.calls.close, 1);
});

test("retained acquisition cancellation interrupts opaque capabilities without late opens", async () => {
  const host = controlled();
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  host.overrides.capabilitiesFor = async () => { entered.resolve(); await release.promise; return host.fs.capabilities; };
  const quota = withFileSystemQuota(host.fs, { maxBytes: 3 });
  let settled = false;
  const pending = quota.openResizeFile!("/new", { signal: controller.signal }).then(
    () => { settled = true; return "unexpected success"; }, error => { settled = true; return error; },
  );
  await entered.promise;
  controller.abort(false);
  let beforeRelease;
  try { await turn(); beforeRelease = settled; } finally { release.resolve(); }
  assert.equal(await pending, false);
  assert.equal(beforeRelease, true);
  await quota.writeFile("/other", new Uint8Array(1));
  assert.equal(host.calls.open, 0);
});

test("retained late acquisition cancellation drains the returned owned handle", async () => {
  const host = controlled();
  const entered = deferred();
  const release = deferred();
  const retiring = deferred();
  const retired = deferred();
  const controller = new AbortController();
  let settled = false;
  host.overrides.openResizeFile = async () => {
    entered.resolve(); await release.promise;
    return { async stat() { assert.fail("stat after cancellation"); }, async truncate() { assert.fail("mutation after cancellation"); }, async close() { host.calls.close++; retiring.resolve(); await retired.promise; throw 0; } };
  };
  const pending = withFileSystemQuota(host.fs, { maxBytes: 1 }).openResizeFile!("/file", { signal: controller.signal }).then(
    () => { settled = true; return "unexpected success"; }, error => { settled = true; return error; },
  );
  await entered.promise;
  controller.abort(false);
  release.resolve();
  await retiring.promise;
  try { await turn(); assert.equal(settled, false); } finally { retired.resolve(); }
  assert.equal(await pending, false);
  assert.equal(host.calls.close, 1);
});

for (const retainedResize of [false, undefined]) test(`quota denies unsupported retained resize ${String(retainedResize)}`, async () => {
  const host = controlled();
  host.overrides.capabilities = { ...host.fs.capabilities, ...(retainedResize === undefined ? {} : { retainedResize }) };
  if (retainedResize === undefined) { const { retainedResize: omitted, ...rest } = host.overrides.capabilities; assert.equal(omitted, true); host.overrides.capabilities = rest; }
  await assert.rejects(withFileSystemQuota(host.fs, { maxBytes: 1 }).openResizeFile!("/file"), { code: "ENOTSUP" });
  assert.equal(host.calls.open, 0);
});

test("quota denies readonly handles and never advertises a missing opener", async () => {
  const host = controlled();
  host.overrides.capabilities = { ...host.fs.capabilities, readOnly: true };
  const quota = withFileSystemQuota(host.fs, { maxBytes: 1 });
  assert.equal(quota.capabilities.retainedResize, false);
  await assert.rejects(quota.openResizeFile!("/file"), { code: "EROFS" });
  assert.equal(host.calls.open, 0);
  const missing = new Proxy(host.fs, { get(target, key) { return key === "openResizeFile" ? undefined : Reflect.get(target, key); } });
  assert.equal(withFileSystemQuota(missing, { maxBytes: 1 }).capabilities.retainedResize, false);
});

for (const length of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) test(`retained quota rejects invalid length ${String(length)} before mutation`, async () => {
  const host = controlled();
  host.entries.set("/file", host.node(1));
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 1 }).openResizeFile!("/file");
  await assert.rejects(handle.truncate(length), { code: "EINVAL" });
  assert.equal(host.calls.truncate, 0);
  await handle.close();
});

for (const size of [NaN, -1, Number.MAX_SAFE_INTEGER + 1]) test(`retained creation rejects unaccountable census size ${String(size)} before effect`, async () => {
  const host = controlled();
  host.entries.set("/bad", host.node(size));
  await assert.rejects(withFileSystemQuota(host.fs, { maxBytes: 3 }).openResizeFile!("/new", { create: true }), { code: "EIO" });
  assert.equal(host.calls.open, 0);
  assert.equal(host.entries.has("/new"), false);
});

test("retained quota snapshots handle metadata before the namespace census", async () => {
  const host = controlled();
  const file = host.node(1);
  host.entries.set("/file", file);
  const open = host.overrides.openResizeFile!;
  host.overrides.openResizeFile = async (path, options) => ({ ...await open(path, options), async stat() { return file; } });
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 1 }).openResizeFile!("/file");
  host.overrides.lstat = async () => { Object.assign(file, { size: 0 }); return { ...file }; };
  await assert.rejects(handle.truncate(2), FileSystemQuotaError);
  assert.equal(host.calls.truncate, 0);
  await handle.close();
});

test("retained census sums large logical entries exactly before a shrink credit", async () => {
  const host = controlled();
  host.entries.set("/file", host.node(Number.MAX_SAFE_INTEGER));
  host.entries.set("/other", host.node(2));
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 1 }).openResizeFile!("/file");
  await assert.rejects(handle.truncate(0), FileSystemQuotaError);
  await handle.close();
});

test("Memory quota preserves bytes, inode and acquired write authority through retained resizing", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/file", Uint8Array.of(97, 98));
  await memory.link("/file", "/alias");
  const quota = withFileSystemQuota(memory, { maxBytes: 10 });
  const handle = await quota.openResizeFile!("/file");
  const pinned = await handle.stat();
  await memory.chmod("/file", 0);
  await handle.truncate(4);
  await assert.rejects(handle.truncate(6), FileSystemQuotaError);
  await memory.chmod("/file", 0o600);
  assert.deepEqual(await memory.readFile("/alias"), Uint8Array.of(97, 98, 0, 0));
  assert.equal((await handle.stat()).ino, pinned.ino);
  assert.equal((await handle.stat()).preferredIoBlockSize, 4096);
  await memory.rename("/file", "/moved");
  await memory.writeFile("/file", Uint8Array.of(120));
  await handle.truncate(3);
  assert.deepEqual(await memory.readFile("/file"), Uint8Array.of(120));
  assert.deepEqual(await memory.readFile("/moved"), Uint8Array.of(97, 98, 0));
  await handle.close();
});

test("Memory repeated mounts retain zero creation when later alias growth is denied", async () => {
  const backing = new MemoryFileSystem();
  const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/left": backing, "/right": backing } });
  const quota = withFileSystemQuota(mounted, { maxBytes: 5 });
  const handle = await quota.openResizeFile!("/left/new", { create: true, mode: 0o600 });
  await assert.rejects(handle.truncate(3), FileSystemQuotaError);
  assert.equal((await mounted.stat("/left/new")).size, 0);
  assert.equal((await mounted.stat("/right/new")).size, 0);
  assert.equal((await handle.stat()).mode & 0o777, 0o600);
  await handle.truncate(2);
  assert.equal((await mounted.stat("/right/new")).size, 2);
  await handle.close();
});

test("retained close does not wait for another acquisition's opaque capabilities", async () => {
  const host = controlled();
  host.entries.set("/file", host.node(1));
  const quota = withFileSystemQuota(host.fs, { maxBytes: 3 });
  const handle = await quota.openResizeFile!("/file");
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  host.overrides.capabilitiesFor = async () => { entered.resolve(); await release.promise; return host.fs.capabilities; };
  const pending = quota.openResizeFile!("/other", { signal: controller.signal }).then(() => "unexpected success", error => error);
  await entered.promise;
  let closed = false;
  const closing = handle.close().then(() => { closed = true; });
  let beforeRelease;
  try { await turn(); beforeRelease = closed; } finally { controller.abort(false); release.resolve(); }
  await closing;
  assert.equal(await pending, false);
  assert.equal(beforeRelease, true);
  assert.equal(host.calls.close, 1);
});

for (const reason of [false, 0, "", null, undefined, NaN]) test(`retained mutation preserves ${String(reason)} and close retains its own failure`, async () => {
  const host = controlled();
  host.entries.set("/file", host.node(1));
  const open = host.overrides.openResizeFile!;
  const secondary = new Error("close failed");
  host.overrides.openResizeFile = async (path, options) => {
    const raw = await open(path, options);
    return { ...raw, async truncate() { throw reason; }, async close() { await raw.close(); throw secondary; } };
  };
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 3 }).openResizeFile!("/file");
  let caught = false;
  try { await handle.truncate(2); } catch (error) { caught = true; assert.equal(error, reason); }
  assert.equal(caught, true);
  const closing = handle.close();
  assert.equal(handle.close(), closing);
  await assert.rejects(closing, error => error === secondary);
  assert.equal(host.calls.close, 1);
});

test("retained stat and resize forward per-operation signals without reopening", async () => {
  const host = controlled();
  host.entries.set("/file", host.node(1));
  const open = host.overrides.openResizeFile!;
  let received: FsOptions | undefined;
  host.overrides.openResizeFile = async (path, options) => {
    const raw = await open(path, options);
    return { ...raw, async truncate(length, operationOptions) { received = operationOptions; await raw.truncate(length, operationOptions); } };
  };
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 3 }).openResizeFile!("/file");
  const operationOptions = { signal: new AbortController().signal };
  await handle.truncate(2, operationOptions);
  assert.equal(received, operationOptions);
  assert.equal(host.calls.open, 1);
  await handle.close();
});

test("retained acquisition itself shares the quota queue with ordinary writes", async () => {
  const host = controlled();
  host.entries.set("/file", host.node(2));
  const entered = deferred();
  const release = deferred();
  const open = host.overrides.openResizeFile!;
  const readdir = host.overrides.readdir!;
  let scans = 0;
  host.overrides.openResizeFile = async (path, options) => { entered.resolve(); await release.promise; return open(path, options); };
  host.overrides.readdir = async (path, options) => { scans++; return readdir(path, options); };
  const quota = withFileSystemQuota(host.fs, { maxBytes: 5 });
  const opening = quota.openResizeFile!("/file");
  await entered.promise;
  const writing = quota.writeFile("/other", new Uint8Array(3));
  let beforeRelease;
  try { await turn(); beforeRelease = scans; } finally { release.resolve(); }
  const handle = await opening;
  await writing;
  assert.equal(beforeRelease, 0);
  assert.equal(scans, 1);
  await handle.close();
});

test("Memory retained creation follows symlinks without borrowing their storage", async () => {
  const memory = new MemoryFileSystem();
  await memory.symlink("/target", "/link");
  const handle = await withFileSystemQuota(memory, { maxBytes: 8 }).openResizeFile!("/link", { create: true });
  await assert.rejects(handle.truncate(2), FileSystemQuotaError);
  assert.equal((await memory.stat("/target")).size, 0);
  assert.equal((await memory.lstat("/link")).size, 7);
  await handle.truncate(1);
  assert.equal((await memory.stat("/target")).size, 1);
  await handle.close();
});

test("retained shrink must still admit its bounded census", async () => {
  const host = controlled();
  host.entries.set("/file", host.node(2));
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 2, maxScanEntries: 0 }).openResizeFile!("/file");
  await assert.rejects(handle.truncate(0), { code: "EFBIG" });
  assert.equal(host.calls.truncate, 0);
  await handle.close();
});

test("selected readonly resize denial precedes the creation census", async () => {
  const host = controlled();
  host.entries.set("/file", host.node(4));
  host.overrides.capabilitiesFor = async () => ({ ...host.fs.capabilities, readOnly: true });
  const quota = withFileSystemQuota(host.fs, { maxBytes: 0, maxScanEntries: 0 });
  assert.equal((await quota.capabilitiesFor!("/new")).retainedResize, false);
  await assert.rejects(quota.openResizeFile!("/new", { create: true }), { code: "EROFS" });
  assert.equal(host.calls.open, 0);
});

test("queued retained cancellation drains earlier work without a late resize", async () => {
  const host = controlled();
  host.entries.set("/file", host.node(1));
  const entered = deferred();
  const release = deferred();
  const open = host.overrides.openResizeFile!;
  host.overrides.openResizeFile = async (path, options) => {
    const raw = await open(path, options);
    return { ...raw, async truncate(length, operationOptions) { entered.resolve(); await release.promise; await raw.truncate(length, operationOptions); } };
  };
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 3 }).openResizeFile!("/file");
  const first = handle.truncate(2);
  await entered.promise;
  const controller = new AbortController();
  const queued = handle.truncate(3, { signal: controller.signal }).then(() => "unexpected success", error => error);
  controller.abort(false);
  const closing = handle.close();
  assert.equal(handle.close(), closing);
  release.resolve();
  await first;
  assert.equal(await queued, false);
  await closing;
  assert.equal(host.calls.truncate, 1);
  assert.equal(host.calls.close, 1);
  assert.equal(host.entries.get("/file")!.size, 2);
});

for (const reason of [false, 0, "", null, undefined, NaN]) test(`retained close preserves its falsey failure ${String(reason)} once`, async () => {
  const host = controlled();
  host.entries.set("/file", host.node(1));
  const open = host.overrides.openResizeFile!;
  host.overrides.openResizeFile = async (path, options) => {
    const raw = await open(path, options);
    return { ...raw, async close() { await raw.close(); throw reason; } };
  };
  const handle = await withFileSystemQuota(host.fs, { maxBytes: 2 }).openResizeFile!("/file");
  const closing = handle.close();
  assert.equal(handle.close(), closing);
  let caught = false;
  try { await closing; } catch (error) { caught = true; assert.equal(error, reason); }
  assert.equal(caught, true);
  assert.equal(host.calls.close, 1);
  await assert.rejects(handle.truncate(0), { code: "EBADF" });
});

for (const method of ["readdir", "lstat"] as const) for (const create of [false, true]) for (const reason of [false, 0, "", null, NaN]) {
  test(`retained ${create ? "creation" : "resize"} interrupts opaque ${method} with ${String(reason)} cancellation`, async () => {
    const host = controlled();
    host.entries.set("/file", host.node(2));
    const entered = deferred();
    const release = deferred();
    let observations = 0;
    const hold = <Args extends unknown[], Result>(metadata: (...args: Args) => Promise<Result>) => async (...args: Args): Promise<Result> => {
      observations++;
      if (observations === 1) {
        entered.resolve();
        await release.promise;
        if (reason === false || reason === "" || Number.isNaN(reason)) throw new Error("late opaque metadata failure");
      }
      return metadata(...args);
    };
    if (method === "readdir") host.overrides.readdir = hold(host.overrides.readdir!);
    else host.overrides.lstat = hold(host.overrides.lstat!);
    const quota = withFileSystemQuota(host.fs, { maxBytes: 8 });
    const handle = create ? undefined : await quota.openResizeFile!("/file");
    const controller = new AbortController();
    let settled = false;
    const outcome = (handle ? handle.truncate(4, { signal: controller.signal })
      : quota.openResizeFile!("/new", { create: true, signal: controller.signal })).then(
      () => { settled = true; return { success: true }; },
      error => { settled = true; return { error }; },
    );
    await entered.promise;
    controller.abort(reason);
    let closed = false;
    const closing = handle?.close().then(() => { closed = true; });
    let written = false;
    const writing = quota.writeFile("/other", new Uint8Array(1)).then(() => { written = true; });
    let beforeRelease;
    try {
      await turn();
      beforeRelease = { settled, closed, written, closes: host.calls.close, observations };
    } finally { release.resolve(); }
    assert.deepEqual(await outcome, { error: reason });
    await Promise.all([closing, writing]);
    await turn();
    assert.equal(beforeRelease.settled, true);
    assert.equal(beforeRelease.closed, !create);
    assert.equal(beforeRelease.written, true);
    assert.equal(beforeRelease.closes, create ? 0 : 1);
    assert.equal(observations, beforeRelease.observations);
    assert.equal(host.calls.open, create ? 0 : 1);
    assert.equal(host.calls.truncate, 0);
    assert.equal(host.entries.has("/new"), false);
    assert.equal(host.entries.get("/file")!.size, 2);
    if (handle) await assert.rejects(handle.stat(), { code: "EBADF" });
  });
}

for (const phase of ["acquisition stat", "operation stat", "truncate"] as const) {
  test(`retained cancellation still drains owned ${phase} and close`, async () => {
    const host = controlled();
    host.entries.set("/file", host.node(2));
    const entered = deferred();
    const release = deferred();
    const retiring = deferred();
    const retired = deferred();
    const open = host.overrides.openResizeFile!;
    let stats = 0;
    host.overrides.openResizeFile = async (path, options) => {
      const raw = await open(path, options);
      return {
        async stat(settings) {
          stats++;
          if (phase === "acquisition stat" || phase === "operation stat" && stats === 2) {
            entered.resolve(); await release.promise;
          }
          return raw.stat(settings);
        },
        async truncate(length, settings) {
          entered.resolve(); await release.promise;
          return raw.truncate(length, settings);
        },
        async close() { retiring.resolve(); await retired.promise; await raw.close(); throw 0; },
      };
    };
    const quota = withFileSystemQuota(host.fs, { maxBytes: 8 });
    const controller = new AbortController();
    const handle = phase === "acquisition stat" ? undefined : await quota.openResizeFile!("/file");
    let settled = false;
    const outcome = (handle ? handle.truncate(4, { signal: controller.signal })
      : quota.openResizeFile!("/file", { signal: controller.signal })).then(
      () => { settled = true; return { success: true }; },
      error => { settled = true; return { error }; },
    );
    await entered.promise;
    controller.abort(false);
    let closed = false;
    const closing = handle?.close().then(() => { closed = true; return "unexpected success"; }, error => { closed = true; return error; });
    let beforeWorkRelease;
    try { await turn(); beforeWorkRelease = { settled, closed, closes: host.calls.close }; }
    finally { release.resolve(); }
    await retiring.promise;
    let beforeCloseRelease;
    try { await turn(); beforeCloseRelease = { settled, closed, closes: host.calls.close }; }
    finally { retired.resolve(); }
    assert.deepEqual(await outcome, { error: false });
    if (closing) assert.equal(await closing, 0);
    assert.deepEqual(beforeWorkRelease, { settled: false, closed: false, closes: 0 });
    assert.deepEqual(beforeCloseRelease, { settled: phase !== "acquisition stat", closed: false, closes: 0 });
    assert.equal(host.calls.close, 1);
    assert.equal(host.calls.truncate, phase === "truncate" ? 1 : 0);
    assert.equal(host.entries.get("/file")!.size, phase === "truncate" ? 4 : 2);
  });
}

test("retained creation uses its captured opener and receiver without a post-census getter", async () => {
  const host = controlled();
  const controller = new AbortController();
  const open = host.overrides.openResizeFile!;
  let censusFinished = false;
  let postCensusLookups = 0;
  let calledWithReceiver = false;
  host.overrides.readdir = async () => { censusFinished = true; return []; };
  const backend: FileSystem = new Proxy(host.fs, {
    get(target, property) {
      if (property === "openResizeFile") {
        if (censusFinished) { postCensusLookups++; controller.abort(false); }
        return async function (this: FileSystem, path: string, options?: FsOptions) {
          calledWithReceiver = this === backend;
          return open(path, options);
        };
      }
      return Reflect.get(target, property);
    },
  });
  const result = await withFileSystemQuota(backend, { maxBytes: 8 }).openResizeFile!("/new", { create: true, signal: controller.signal })
    .then(handle => ({ handle }), error => ({ error }));
  if ("handle" in result) await result.handle.close();
  assert.equal(postCensusLookups, 0);
  assert.equal(controller.signal.aborted, false);
  assert.equal("handle" in result, true);
  assert.equal(calledWithReceiver, true);
  assert.equal(host.calls.open, 1);
  assert.equal(host.calls.close, 1);
  assert.equal(host.entries.get("/new")!.size, 0);
});

for (const create of [false, true]) for (const reason of [false, 0, "", null, NaN]) {
  test(`retained ${create ? "creation" : "open"} denies acquisition when opener lookup aborts with ${String(reason)}`, async () => {
    const host = controlled();
    host.entries.set("/file", host.node(2));
    const controller = new AbortController();
    const open = host.overrides.openResizeFile!;
    let lookups = 0;
    let scans = 0;
    host.overrides.readdir = async () => { scans++; return []; };
    const backend = new Proxy(host.fs, {
      get(target, property) {
        if (property === "openResizeFile") {
          if (++lookups === 2) controller.abort(reason);
          return open;
        }
        return Reflect.get(target, property);
      },
    });
    const result = await withFileSystemQuota(backend, { maxBytes: 8 }).openResizeFile!(create ? "/new" : "/file", { create, signal: controller.signal })
      .then(handle => ({ handle }), error => ({ error }));
    if ("handle" in result) await result.handle.close();
    assert.deepEqual(result, { error: reason });
    assert.equal(lookups, 2);
    assert.equal(scans, 0);
    assert.equal(host.calls.open, 0);
    assert.equal(host.calls.close, 0);
    assert.equal(host.entries.has("/new"), false);
    assert.equal(host.entries.get("/file")!.size, 2);
  });
}
