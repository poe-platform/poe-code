import assert from "node:assert/strict";
import test from "node:test";
import * as canonical from "poe-code/safe-fs";
import {
  FsError, MemoryFileSystem, WebDavFileSystem, Shell, createMemoryFileSystem,
  createMountFileSystem, createReadOnlyFileSystem, type FileSystem,
} from "../../src/index.js";
import { MockDav } from "./webdav/mock.js";

const payload = new Uint8Array([0, 255, 13, 10, 128, 17]);

function fixture() {
  const service = new MockDav();
  service.files.set("/dir", null);
  service.files.set("/dir/source", payload.slice());
  const remote = new WebDavFileSystem({ baseUrl: "https://authority.invalid/dav/", fetch: service.fetch });
  return { service, remote };
}

function rejectingOpaque(backend: FileSystem, calls: { path: string; mode: number | undefined }[]): FileSystem {
  const { permissions: ignoredPermissions, ...capabilities } = backend.capabilities;
  return new Proxy(backend, { get(target, key) {
    if (key === "capabilities") return capabilities;
    if (key === "access") return async (path: string, mode?: number, options?: Parameters<FileSystem["access"]>[2]) => {
      calls.push({ path, mode });
      if (mode !== undefined && (mode & 1) !== 0) throw new FsError("ENOTSUP", { path, syscall: "access" });
      await target.access(path, mode, options);
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

test("shell facades and the installed canonical adapter share error and constructor identity", () => {
  assert.equal(FsError, canonical.FsError);
  assert.equal(MemoryFileSystem, canonical.MemoryFileSystem);
  assert.equal(WebDavFileSystem, canonical.WebDavFileSystem);
});

test("opaque unknown permission backend actually rejects X_OK before any copy effects", async () => {
  const { service, remote } = fixture();
  const before = structuredClone(service.files);
  const calls: { path: string; mode: number | undefined }[] = [];
  const local = createMemoryFileSystem();
  const filesystem = createMountFileSystem({ root: local, mounts: { "/unknown": rejectingOpaque(remote, calls), "/known": remote } });
  assert.equal(filesystem.capabilities.permissions, undefined);
  assert.equal((await filesystem.stat("/known/dir/source")).type, "file");
  service.requests.length = 0;
  await assert.rejects(filesystem.copyFile("/unknown/dir/source", "/new"), error => {
    assert.ok(error instanceof FsError);
    assert.deepEqual([error.code, error.path, error.syscall, error.dest], ["ENOTSUP", "/unknown/dir/source", "copyFile", "/new"]);
    return true;
  });
  assert.ok(calls.length > 0);
  assert.ok(calls.every(call => call.mode === 1));
  assert.ok(service.requests.every(request => request.init.method === "PROPFIND"));
  assert.deepEqual(service.files, before);
  assert.deepEqual(await local.readdir("/"), []);
});

test("nested readonly opaque rejection remains unsupported without data effects", async () => {
  const { service, remote } = fixture();
  const before = structuredClone(service.files);
  const calls: { path: string; mode: number | undefined }[] = [];
  const inner = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dav": rejectingOpaque(remote, calls) } });
  const outer = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/view": createReadOnlyFileSystem(inner) } });
  await assert.rejects(outer.access("/view/dav/dir", 1), error => error instanceof FsError && error.code === "ENOTSUP");
  assert.ok(calls.some(call => call.mode === 1));
  assert.ok(calls.every(call => call.mode === 0 || call.mode === 1));
  assert.ok(service.requests.every(request => request.init.method === "PROPFIND"));
  assert.deepEqual(service.files, before);
});

test("WebDAV permits virtual directory traversal, not file execution or write permission claims", async () => {
  const { service, remote } = fixture();
  const before = structuredClone(service.files);
  assert.equal(remote.capabilities.permissions, false);
  for (const filesystem of [remote, createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dav": remote } })]) {
    const prefix = filesystem === remote ? "" : "/dav";
    await filesystem.access(`${prefix}/dir`, 1);
    await assert.rejects(filesystem.access(`${prefix}/dir/source`, 1), error => error instanceof FsError && error.code === "ENOTSUP");
    for (const mode of [2, 3, 6, 7]) await assert.rejects(filesystem.access(`${prefix}/dir`, mode), error => error instanceof FsError && error.code === "ENOTSUP");
  }
  assert.ok(service.requests.every(request => request.init.method === "PROPFIND"));
  assert.deepEqual(service.files, before);
});

test("explicit access then plain or readonly cd uses three metadata requests without GET or mutations", async () => {
  for (const readOnly of [false, true]) {
    const { service, remote } = fixture();
    const before = structuredClone(service.files);
    const filesystem = readOnly ? createReadOnlyFileSystem(remote) : remote;
    await filesystem.access("/dir", 1);
    const shell = new Shell({ fs: filesystem, cwd: "/", env: { HOME: "/", PATH: "" } });
    try {
      const result = await shell.exec("cd /dir; pwd");
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "/dir\n", ""]);
      assert.deepEqual(service.requests.map(request => [request.init.method, request.headers.get("Depth")]), [["PROPFIND", "0"], ["PROPFIND", "0"], ["PROPFIND", "0"]]);
      assert.deepEqual(service.files, before);
    } finally { await shell.dispose(); }
  }
});
