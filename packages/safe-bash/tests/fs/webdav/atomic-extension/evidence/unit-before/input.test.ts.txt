import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { FsError } from "../../../../src/contracts/errors.js";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";
import type { WebDavAtomicEmptyDirectoryBinding, WebDavAtomicEmptyDirectoryRequest, WebDavAtomicEmptyDirectoryResult } from "../../../../src/fs/webdav/index.js";
import { MockDav } from "../mock.js";

const namespaceUrl = "https://dav.test/dav/";
const receipt = (request: WebDavAtomicEmptyDirectoryRequest): WebDavAtomicEmptyDirectoryResult => ({
  operation: request.operation, namespaceUrl: request.namespaceUrl, path: request.path, outcome: "removed",
});
const rejected = (code: string, path: string) => (error: unknown) => error instanceof FsError
  && error.code === code && error.syscall === "rmdir" && error.path === path;
function fixture(removeEmptyDirectory: WebDavAtomicEmptyDirectoryBinding["removeEmptyDirectory"]) {
  const mock = new MockDav();
  mock.files.set("/empty", null);
  const fs = new WebDavFileSystem({ baseUrl: namespaceUrl, fetch: mock.fetch,
    atomicEmptyDirectory: { namespaceUrl, removeEmptyDirectory } });
  return { fs, mock };
}

for (const binding of [null, false, {}, { namespaceUrl }, { namespaceUrl, removeEmptyDirectory: 3 },
  { namespaceUrl: "https://dav.test/other/", removeEmptyDirectory: async () => ({}) },
  { namespaceUrl: "https://other.test/root/", removeEmptyDirectory: async () => ({}) },
  { namespaceUrl: "https://dav.test/root", removeEmptyDirectory: async () => ({}) }]) {
  test(`construction rejects invalid namespace binding ${JSON.stringify(binding)}`, () => {
    const mock = new MockDav();
    assert.throws(() => new WebDavFileSystem({ baseUrl: namespaceUrl, fetch: mock.fetch,
      atomicEmptyDirectory: binding as unknown as WebDavAtomicEmptyDirectoryBinding }), (error: unknown) => error instanceof FsError && error.code === "EINVAL");
    assert.equal(mock.requests.length, 0);
  });
}

test("configured callback receives frozen canonical facts, no listing or DELETE", async () => {
  let calls = 0;
  const { fs, mock } = fixture(async (request) => {
    calls++;
    assert.equal(request.operation, "atomic-empty-rmdir/v1");
    assert.equal(request.path, "/empty");
    assert.equal(request.namespaceUrl, namespaceUrl);
    assert.equal(request.signal?.aborted, false);
    assert.equal(Object.isFrozen(request), true);
    mock.files.delete("/empty");
    return receipt(request);
  });
  await fs.rmdir("/unused/../empty/");
  assert.equal(calls, 1);
  assert.equal(mock.files.has("/empty"), false);
  assert.equal(fs.capabilities.atomicRename, false);
  assert.ok(!("snapshotRmdir" in fs.capabilities) || !fs.capabilities.snapshotRmdir);
  assert.ok(mock.requests.every((request) => request.init.method === "PROPFIND" && new Headers(request.init.headers).get("Depth") === "0"));
});

test("binding namespace and function are captured at construction", async () => {
  let calls = 0;
  const binding = { namespaceUrl, removeEmptyDirectory: async (request: WebDavAtomicEmptyDirectoryRequest) => { calls++; return receipt(request); } };
  const mock = new MockDav();
  mock.files.set("/empty", null);
  const fs = new WebDavFileSystem({ baseUrl: namespaceUrl, fetch: mock.fetch, atomicEmptyDirectory: binding });
  binding.namespaceUrl = "https://other.test/";
  binding.removeEmptyDirectory = async () => { throw new Error("replacement must not be called"); };
  await fs.rmdir("/empty");
  assert.equal(calls, 1);
});

for (const [path, code] of [["/", "EBUSY"], ["/missing", "ENOENT"], ["/file", "ENOTDIR"], ["/../escape", "EACCES"]]) {
  test(`preflight ${code} does not invoke callback`, async () => {
    let calls = 0;
    const { fs, mock } = fixture(async (request) => { calls++; return receipt(request); });
    mock.files.set("/file", new Uint8Array([5]));
    await assert.rejects(fs.rmdir(path!), rejected(code!, path!));
    assert.equal(calls, 0);
    assert.deepEqual(mock.files.get("/file"), new Uint8Array([5]));
  });
}

test("preabort and abort after stat cannot invoke host", async () => {
  let calls = 0;
  const { fs, mock } = fixture(async (request) => { calls++; return receipt(request); });
  await assert.rejects(fs.rmdir("/empty", { signal: AbortSignal.abort(new Error("stop")) }), rejected("ECANCELED", "/empty"));
  assert.equal(mock.requests.length, 0);
  const controller = new AbortController();
  const original = fs.stat.bind(fs);
  fs.stat = async (...args) => { const stat = await original(...args); controller.abort(); return stat; };
  await assert.rejects(fs.rmdir("/empty", { signal: controller.signal }), rejected("ECANCELED", "/empty"));
  assert.equal(calls, 0);
});

for (const change of [{ operation: "DELETE" }, { namespaceUrl: "https://dav.test/other/" }, { path: "/elsewhere" }, { outcome: "queued" }, null, undefined]) {
  test(`mismatched receipt is EIO with no retry ${JSON.stringify(change)}`, async () => {
    let calls = 0;
    const { fs, mock } = fixture(async (request) => {
      calls++;
      mock.files.delete("/empty");
      return (change == null ? change : { ...receipt(request), ...change }) as WebDavAtomicEmptyDirectoryResult;
    });
    await assert.rejects(fs.rmdir("/empty/"), rejected("EIO", "/empty/"));
    assert.equal(calls, 1);
    assert.equal(mock.files.has("/empty"), false);
  });
}

for (const code of ["ENOTEMPTY", "ENOTDIR", "ENOENT", "EACCES", "EBUSY", "ENOTSUP", "EROFS"] as const) {
  test(`host ${code} preserves requested path and cause`, async () => {
    const failure = new FsError(code, { syscall: "native-rmdir", path: "host-relative" });
    const { fs } = fixture(async () => { throw failure; });
    await assert.rejects(fs.rmdir("/empty/"), (error: unknown) => rejected(code, "/empty/")(error) && (error as Error).cause === failure);
  });
}

test("native errno-shaped rejection is typed; arbitrary failure is EIO", async () => {
  for (const [failure, code] of [[Object.assign(new Error("native"), { code: "ENOTEMPTY" }), "ENOTEMPTY"], [new Error("host error"), "EIO"]] as const) {
    const { fs } = fixture(async () => { throw failure; });
    await assert.rejects(fs.rmdir("/empty"), rejected(code, "/empty"));
  }
});

test("native late-child failure is preserved without recursive fallback", async () => {
  const { fs, mock } = fixture(async () => {
    mock.files.set("/empty/late", new Uint8Array([0, 255, 128]));
    throw new FsError("ENOTEMPTY");
  });
  await assert.rejects(fs.rmdir("/empty"), rejected("ENOTEMPTY", "/empty"));
  assert.deepEqual(mock.files.get("/empty/late"), new Uint8Array([0, 255, 128]));
  assert.ok(mock.requests.every((request) => request.init.method === "PROPFIND"));
});

test("abort races an uncooperative callback and observes late rejection", async () => {
  const controller = new AbortController();
  let rejectHost!: (reason: unknown) => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const { fs } = fixture((request) => {
    assert.equal(request.signal?.aborted, false);
    started();
    return new Promise((_, reject) => { rejectHost = reject; });
  });
  const pending = fs.rmdir("/empty", { signal: controller.signal });
  await entered;
  controller.abort(Object.assign(new Error("caller"), { code: "ENOENT" }));
  await assert.rejects(pending, rejected("ECANCELED", "/empty"));
  rejectHost(new Error("late host failure"));
  await delay(1);
});

test("abort after a host effect is not success or rollback", async () => {
  const controller = new AbortController();
  const { fs, mock } = fixture(async (request) => {
    mock.files.delete("/empty");
    controller.abort();
    return receipt(request);
  });
  await assert.rejects(fs.rmdir("/empty", { signal: controller.signal }), rejected("ECANCELED", "/empty"));
  assert.equal(mock.files.has("/empty"), false);
});

test("callback wait has bounded adapter timeout", async () => {
  const mock = new MockDav();
  mock.files.set("/empty", null);
  const fs = new WebDavFileSystem({ baseUrl: namespaceUrl, fetch: mock.fetch, timeoutMs: 10,
    atomicEmptyDirectory: { namespaceUrl, removeEmptyDirectory: () => new Promise(() => {}) } });
  const keepAlive = setTimeout(() => {}, 100);
  try { await assert.rejects(fs.rmdir("/empty"), rejected("ETIMEDOUT", "/empty")); }
  finally { clearTimeout(keepAlive); }
});
