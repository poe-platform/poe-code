import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate as turn } from "node:timers/promises";
import test from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "./mock.js";

function rejected(code: ErrnoCode, path: string): (error: unknown) => boolean {
  return error => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, code);
    assert.equal(error.syscall, "rmdir");
    assert.equal(error.path, path);
    return true;
  };
}

function fixture() {
  const mock = new MockDav();
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
  return { mock, fs };
}

for (const path of ["/file", "/file/", "/file/child"]) {
  test(`rmdir rejects file path ${path} without effects`, async () => {
    const { mock, fs } = fixture();
    mock.files.set("/file", new Uint8Array([0, 255, 1]));
    const before = structuredClone(mock.files);
    await assert.rejects(fs.rmdir(path), rejected("ENOTDIR", path));
    assert.deepEqual(mock.files, before);
    assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  });
}

for (const path of ["/missing", "/missing/child"]) {
  test(`rmdir preserves requested missing path ${path}`, async () => {
    const { mock, fs } = fixture();
    const before = structuredClone(mock.files);
    await assert.rejects(fs.rmdir(path), rejected("ENOENT", path));
    assert.deepEqual(mock.files, before);
    assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  });
}

for (const child of [new Uint8Array([2]), null]) {
  test(`rmdir rejects a collection containing a ${child === null ? "collection" : "file"}`, async () => {
    const { mock, fs } = fixture();
    mock.files.set("/dir", null);
    mock.files.set("/dir/child", child);
    const before = structuredClone(mock.files);
    await assert.rejects(fs.rmdir("/dir/"), rejected("ENOTEMPTY", "/dir/"));
    assert.deepEqual(mock.files, before);
    assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  });
}

for (const overwritePolicy of ["lock", "etag"] as const) {
  test(`empty rmdir is unsupported with ${overwritePolicy} policy and never locks or deletes`, async () => {
    const mock = new MockDav();
    mock.files.set("/empty", null);
    mock.files.set("/empty-neighbor", new Uint8Array([3]));
    const before = structuredClone(mock.files);
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch, overwritePolicy });
    const path = "/other/../empty/";
    await assert.rejects(fs.rmdir(path), rejected("ENOTSUP", path));
    assert.deepEqual(mock.files, before);
    assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
    assert.equal(mock.locks.size, 0);
    assert.equal(fs.capabilities.atomicRename, false);
  });
}

test("a child created after the empty PROPFIND survives without DELETE", async () => {
  const mock = new MockDav();
  mock.files.set("/empty", null);
  let created = false;
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    const snapshot = await mock.fetch(url, init);
    if (init.method === "PROPFIND" && new Headers(init.headers).get("Depth") === "1") {
      assert.equal(created, false);
      mock.files.set("/empty/new-child", new Uint8Array([9]));
      created = true;
    }
    return snapshot;
  } });
  await assert.rejects(fs.rmdir("/empty"), rejected("ENOTSUP", "/empty"));
  assert.equal(created, true);
  assert.deepEqual(mock.files.get("/empty/new-child"), new Uint8Array([9]));
  assert.equal(mock.files.get("/empty"), null);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
});

test("pre-abort and root protection make no requests", async () => {
  const { mock, fs } = fixture();
  const signal = AbortSignal.abort(new Error("stop"));
  await assert.rejects(fs.rmdir("/empty", { signal }), rejected("ECANCELED", "/empty"));
  await assert.rejects(fs.rmdir("/", { signal }), rejected("ECANCELED", "/"));
  await assert.rejects(fs.rmdir("/"), rejected("EBUSY", "/"));
  assert.equal(mock.requests.length, 0);
});

for (const depth of ["0", "1"]) {
  test(`rmdir cancels uncooperative depth-${depth} PROPFIND and observes late rejection`, { timeout: 2000 }, async () => {
    const mock = new MockDav();
    mock.files.set("/empty", null);
    const before = structuredClone(mock.files);
    const controller = new AbortController();
    let enter!: (signal: AbortSignal) => void;
    const entered = new Promise<AbortSignal>(resolve => { enter = resolve; });
    let rejectPending!: (error: Error) => void;
    const pending = new Promise<never>((_resolve, reject) => { rejectPending = reject; });
    const methods: string[] = [];
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: (url, init) => {
      methods.push(init.method!);
      if (init.method === "PROPFIND" && new Headers(init.headers).get("Depth") === depth) {
        enter(init.signal!); return pending;
      }
      return mock.fetch(url, init);
    } });
    const checking = assert.rejects(fs.rmdir("/empty", { signal: controller.signal }), rejected("ECANCELED", "/empty"));
    const signal = await entered;
    controller.abort(new Error("stop pending inspection"));
    try { await checking; }
    finally { rejectPending(new Error("late host failure")); }
    await turn();
    assert.equal(signal.aborted, true);
    assert.equal(getEventListeners(signal, "abort").length, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.ok(methods.every(method => method === "PROPFIND"));
    assert.deepEqual(mock.files, before);
  });
}

for (const status of [403, 500]) {
  test(`rmdir propagates listing HTTP ${status} rather than treating failure as empty`, async () => {
    const mock = new MockDav();
    mock.files.set("/empty", null);
    const before = structuredClone(mock.files);
    const methods: string[] = [];
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: (url, init) => {
      methods.push(init.method!);
      return new Headers(init.headers).get("Depth") === "1"
        ? Promise.resolve(new Response(null, { status })) : mock.fetch(url, init);
    } });
    await assert.rejects(fs.rmdir("/empty/"), error => {
      rejected(status === 403 ? "EACCES" : "EIO", "/empty/")(error);
      assert.ok(error instanceof FsError && error.cause instanceof FsError);
      assert.equal(error.cause.syscall, "PROPFIND");
      return true;
    });
    assert.ok(methods.every(method => method === "PROPFIND"));
    assert.deepEqual(mock.files, before);
  });
}

test("legacy nonrecursive rm still removes files and rejects collections", async () => {
  const { mock, fs } = fixture();
  mock.files.set("/file", new Uint8Array([1]));
  mock.files.set("/empty", null);
  await fs.rm("/file", { recursive: false });
  assert.equal(mock.files.has("/file"), false);
  const start = mock.requests.length;
  await assert.rejects(fs.rm("/empty", { recursive: false }), { code: "ENOTSUP" });
  assert.equal(mock.files.get("/empty"), null);
  assert.ok(mock.requests.slice(start).every(request => request.init.method === "PROPFIND"));
});
