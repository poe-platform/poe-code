import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { withFileSystemQuota, FileSystemQuotaError } from "../src/fs/quota/index.js";
import { PythonFileSystem } from "../src/python/filesystem.js";

const bytes = (text: string) => new TextEncoder().encode(text);

test("Python can retain read-only files through a quota view", async () => {
  const source = new MemoryFileSystem();
  await source.writeFile("/input", bytes("hello"));
  const quota = withFileSystemQuota(source, { maxBytes: 5 });
  assert.equal(quota.capabilities.open, true);
  assert.equal((await quota.capabilitiesFor!("/input")).open, true);
  const bridge = new PythonFileSystem(quota, { cwd: "/" });
  try {
    const descriptor = await bridge.dispatch({ op: "open", args: ["/input", { access: "read" }] });
    assert.equal(typeof descriptor, "number");
    const retained = await quota.open!("/input", { access: "read" });
    await source.rename("/input", "/moved");
    const output = new Uint8Array(5);
    assert.equal(await retained.read(output, null), 5);
    assert.deepEqual(output, bytes("hello"));
    await assert.rejects(retained.write(bytes("!"), null), { code: "EBADF" });
    await retained.close();
  } finally { await bridge.close(); }
});

test("quota descriptors account positioned and cursor writes without mutating on refusal", async () => {
  const source = new MemoryFileSystem();
  const quota = withFileSystemQuota(source, { maxBytes: 6 });
  const descriptor = await quota.open!("/file", { access: "readwrite", creation: "exclusive" });
  try {
    assert.equal(await descriptor.write(bytes("abc"), null), 3);
    assert.equal(await descriptor.write(bytes("z"), 5), 1);
    assert.equal(await descriptor.getPosition!(), 3);
    await assert.rejects(descriptor.write(bytes("xx"), 5), FileSystemQuotaError);
    await assert.rejects(descriptor.truncate(7), FileSystemQuotaError);
    assert.deepEqual(await source.readFile("/file"), Uint8Array.of(97, 98, 99, 0, 0, 122));
    await descriptor.truncate(2);
    await descriptor.write(bytes("d"), null);
    assert.deepEqual(await source.readFile("/file"), Uint8Array.of(97, 98, 0, 100));
    assert.equal(await descriptor.write(new Uint8Array(), 99), 0);
    assert.equal((await descriptor.stat()).size, 4);
  } finally { await descriptor.close(); }
});

test("concurrent quota descriptors and pathname writes share admission", async () => {
  const source = new MemoryFileSystem();
  const quota = withFileSystemQuota(source, { maxBytes: 4 });
  const left = await quota.open!("/left", { access: "write", creation: "exclusive" });
  const right = await quota.open!("/right", { access: "write", creation: "exclusive" });
  try {
    const results = await Promise.allSettled([left.write(bytes("abc"), null), right.write(bytes("def"), null), quota.writeFile("/other", bytes("ghi"))]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    for (const result of results) if (result.status === "rejected") assert.ok(result.reason instanceof FileSystemQuotaError);
    const entries = await source.readdir("/");
    const sizes = await Promise.all(entries.map(async entry => (await source.stat("/" + entry.name)).size));
    assert.equal(sizes.reduce((total, size) => total + size, 0), 3);
  } finally { await Promise.all([left.close(), right.close()]); }
});

test("append handles use the current end and preserve positioned-append semantics", async () => {
  const source = new MemoryFileSystem();
  await source.writeFile("/file", bytes("ab"));
  const quota = withFileSystemQuota(source, { maxBytes: 5 });
  const left = await quota.open!("/file", { access: "readwrite", append: true });
  const right = await quota.open!("/file", { access: "write", append: true });
  try {
    await left.write(bytes("c"), null);
    await right.write(bytes("d"), null);
    await left.write(bytes("e"), null);
    await assert.rejects(right.write(bytes("f"), null), FileSystemQuotaError);
    assert.equal(await left.getPosition!(), 5);
    assert.deepEqual(await source.readFile("/file"), bytes("abcde"));
  } finally { await Promise.all([left.close(), right.close()]); }
});

test("quota descriptor growth follows retained identities and charges every alias", async () => {
  const source = new MemoryFileSystem();
  await source.writeFile("/file", bytes("abc"));
  const quota = withFileSystemQuota(source, { maxBytes: 9 });
  const descriptor = await quota.open!("/file", { access: "readwrite" });
  try {
    await quota.rename("/file", "/moved");
    await quota.link!("/moved", "/alias");
    await quota.writeFile("/file", bytes("x"));
    await descriptor.write(bytes("d"), 3);
    await assert.rejects(descriptor.write(bytes("e"), 4), FileSystemQuotaError);
    assert.deepEqual(await source.readFile("/file"), bytes("x"));
    assert.deepEqual(await source.readFile("/moved"), bytes("abcd"));
  } finally { await descriptor.close(); }
});

test("quota open preserves mounted readonly policy", async () => {
  const source = new MemoryFileSystem();
  await source.writeFile("/file", bytes("abc"));
  const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/locked": new ReadOnlyFileSystem(source) } });
  const quota = withFileSystemQuota(mounted, { maxBytes: 4 });
  const descriptor = await quota.open!("/locked/file", { access: "read" });
  await descriptor.close();
  await assert.rejects(quota.open!("/locked/file", { access: "write", truncate: true }), { code: "EROFS" });
  assert.deepEqual(await source.readFile("/file"), bytes("abc"));
});

test("late quota acquisition closes once and preserves falsey cancellation", async () => {
  const source = new MemoryFileSystem();
  await source.writeFile("/file", bytes("abc"));
  const retained = await source.open("/file", { access: "read" });
  const close = vi.spyOn(retained, "close");
  const controller = new AbortController();
  vi.spyOn(source, "open").mockImplementation(async () => { controller.abort(false); return retained; });
  await assert.rejects(withFileSystemQuota(source, { maxBytes: 3 }).open!("/file", { access: "read", signal: controller.signal }), error => error === false);
  assert.equal(close.mock.calls.length, 1);
});

test("quota descriptor failures preserve identity and release admission for recovery", async () => {
  const source = new MemoryFileSystem();
  await source.writeFile("/file", bytes("a"));
  const retained = await source.open("/file", { access: "readwrite" });
  const failure = new Error("backend unavailable");
  vi.spyOn(retained, "write").mockRejectedValueOnce(failure);
  vi.spyOn(source, "open").mockResolvedValueOnce(retained);
  const quota = withFileSystemQuota(source, { maxBytes: 2 });
  const descriptor = await quota.open!("/file", { access: "readwrite" });
  try {
    await assert.rejects(descriptor.write(bytes("b"), 1), error => error === failure);
    await descriptor.write(bytes("c"), 1);
    assert.deepEqual(await source.readFile("/file"), bytes("ac"));
  } finally { await descriptor.close(); }
});

test("quota close does not wait for an unrelated later acquisition", async () => {
  const source = new MemoryFileSystem();
  await source.writeFile("/file", bytes("a"));
  let release!: () => void;
  let entered!: () => void;
  const acquired = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const open = source.open.bind(source);
  vi.spyOn(source, "open").mockImplementation(async (path, options) => {
    if (path === "/later") { entered(); await waiting; }
    return open(path, options);
  });
  const quota = withFileSystemQuota(source, { maxBytes: 3 });
  const descriptor = await quota.open!("/file", { access: "read" });
  const later = quota.open!("/later", { access: "write", creation: "exclusive" });
  await acquired;
  let closed = false;
  const closing = descriptor.close().then(() => { closed = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  try { assert.equal(closed, true); }
  finally { release(); await closing; await (await later).close(); }
});

test("quota preserves strong unlink for Python temporary-file cleanup", async () => {
  const source = new MemoryFileSystem();
  await source.writeFile("/file", bytes("abc"));
  await source.mkdir("/directory");
  const quota = withFileSystemQuota(source, { maxBytes: 3 });
  const bridge = new PythonFileSystem(quota, { cwd: "/" });
  try {
    const descriptor = await quota.open!("/file", { access: "read" });
    await bridge.dispatch({ op: "rm", args: ["/file"] });
    assert.equal(await descriptor.read(new Uint8Array(3), null), 3);
    await descriptor.close();
    await assert.rejects(bridge.dispatch({ op: "rm", args: ["/directory"] }), { code: "EISDIR" });
    assert.equal((await source.stat("/directory")).type, "directory");
  } finally { await bridge.close(); }
});

test("quota exclusive creation does not follow a final mounted symlink", async () => {
  const source = new MemoryFileSystem();
  await source.symlink("/self", "/self");
  const quota = withFileSystemQuota(new MountFileSystem({ root: source }), { maxBytes: 8 });
  await assert.rejects(quota.open!("/self", { access: "write", creation: "exclusive" }), { code: "EEXIST" });
  assert.equal(await source.readlink("/self"), "/self");
});
