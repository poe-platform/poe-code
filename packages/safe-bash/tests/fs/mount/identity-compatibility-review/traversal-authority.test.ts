import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FsError } from "../../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../../src/contracts/errors.js";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createMountFileSystem, MountFileSystem } from "../../../../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../../../../src/fs/readonly/index.js";
import { createRealFileSystem } from "../../../../src/fs/real/index.js";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";
import { MockDav } from "../../webdav/mock.js";
import { withLoopbackDav } from "../../webdav/property-fixture.js";

const bytes = new Uint8Array([0, 255, 13, 10, 128, 17]);
const prior = new Uint8Array([71, 85, 65, 82, 68]);

function wrapped(backend: FileSystem, overrides: Partial<FileSystem> = {}): FileSystem {
  return new Proxy({} as FileSystem, { get(_target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(backend, key);
    return typeof value === "function" ? value.bind(backend) : value;
  } });
}

function seed() {
  const service = new MockDav();
  service.files.set("/dir", null);
  service.files.set("/dir/source", bytes.slice());
  service.files.set("/dir/existing", prior.slice());
  return service;
}

function remote(service: MockDav) {
  return new WebDavFileSystem({ baseUrl: "https://authority.invalid/dav/", fetch: service.fetch, timeoutMs: 2000 });
}

function rejection(code: ErrnoCode, path: string, syscall: string, destination?: string) {
  return (error: unknown) => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, code);
    assert.equal(error.path, path);
    assert.equal(error.syscall, syscall);
    assert.equal(error.dest, destination);
    return true;
  };
}

function dataCalls(backend: FileSystem) {
  const calls: string[] = [];
  const filesystem = new Proxy(backend, { get(target, key) {
    const value: unknown = Reflect.get(target, key);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => {
      if (["readFile", "readStream", "writeFile", "writeStream", "copyFile", "rename", "rm"].includes(String(key))) calls.push(String(key));
      return Reflect.apply(value, target, args);
    };
  } });
  return { filesystem, calls };
}

function methods(service: MockDav) {
  return service.requests.map(request => request.init.method);
}

test("missing permission capability preserves traversal support and actual denial beside a known-false sibling", async context => {
  const service = seed();
  const before = structuredClone(service.files);
  const backend = remote(service);
  const { permissions: ignoredPermissions, ...unknownCapabilities } = backend.capabilities;
  let deny = false;
  const cause = new FsError("EACCES", { path: "/", syscall: "access" });
  const unknown = wrapped(backend, { capabilities: unknownCapabilities, async access(path, mode, options) {
    if (deny) throw cause;
    await backend.access(path, mode, options);
  } });
  const local = createMemoryFileSystem();
  const filesystem = createMountFileSystem({ root: local, mounts: { "/unknown": unknown, "/known": backend } });
  assert.equal(filesystem.capabilities.permissions, undefined);
  assert.equal((await filesystem.stat("/known/dir/source")).type, "file");
  await filesystem.access("/unknown/dir", 1);
  assert.ok(methods(service).every(method => method === "PROPFIND"));
  service.requests.length = 0;
  deny = true;
  await assert.rejects(filesystem.copyFile("/unknown/dir/source", "/new"), error => {
    rejection("EACCES", "/unknown/dir/source", "copyFile", "/new")(error);
    assert.ok(error instanceof FsError);
    assert.equal(error.cause, cause);
    return true;
  });
  assert.deepEqual(methods(service), ["PROPFIND"]);
  assert.deepEqual(service.files, before);
  assert.deepEqual(await local.readdir("/"), []);
  context.diagnostic(JSON.stringify({ case: context.name, expectedCode: "EACCES", methods: methods(service), unchanged: true }));
});

for (const kind of ["memory", "real"] as const) {
  test(`${kind} destination execute denial is checked before acquiring an authorized WebDAV source`, async context => {
    const root = kind === "real" ? await mkdtemp(fileURLToPath(new URL("./.real-compatibility-traversal-", import.meta.url))) : undefined;
    const local = root ? await createRealFileSystem({ root }) : createMemoryFileSystem();
    await local.mkdir("/locked");
    await local.writeFile("/locked/existing", prior);
    await local.chmod("/locked", 0o600);
    context.after(async () => {
      await local.chmod("/locked", 0o700);
      if (root) await rm(root, { recursive: true, force: true });
    });
    const service = seed();
    const before = structuredClone(service.files);
    const observed = dataCalls(local);
    const filesystem = createMountFileSystem({ root: createMemoryFileSystem(), mounts: {
      "/dav": remote(service), "/local": observed.filesystem,
    } });
    assert.equal(filesystem.capabilities.permissions, undefined);
    await assert.rejects(local.access("/locked", 1), (error: unknown) => error instanceof FsError && error.code === "EACCES");
    await assert.rejects(filesystem.copyFile("/dav/dir/source", "/local/locked/new"),
      rejection("EACCES", "/dav/dir/source", "copyFile", "/local/locked/new"));
    assert.deepEqual(observed.calls, []);
    assert.ok(methods(service).length > 0);
    assert.ok(methods(service).every(method => method === "PROPFIND"));
    assert.deepEqual(service.files, before);
    await local.chmod("/locked", 0o700);
    assert.deepEqual(await local.readdir("/locked"), [{ name: "existing", type: "file" }]);
    assert.deepEqual(await local.readFile("/locked/existing"), prior);
    context.diagnostic(JSON.stringify({ case: context.name, expectedCode: "EACCES", methods: methods(service), dataCalls: observed.calls, unchanged: true }));
  });
}

test("directory execute access survives an opaque readonly nested remote view without enabling writes", async context => {
  const service = seed();
  const before = structuredClone(service.files);
  const inner = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dav": remote(service) } });
  const filesystem = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/view": wrapped(createReadOnlyFileSystem(inner)) } });
  await filesystem.access("/view/dav/dir", 0);
  await filesystem.access("/view/dav/dir", 1);
  for (const mode of [2, 3, 6, 7]) await assert.rejects(filesystem.access("/view/dav/dir", mode), rejection("EROFS", "/view/dav/dir", "access"));
  assert.deepEqual(service.files, before);
  assert.ok(methods(service).every(method => method === "PROPFIND"));
  context.diagnostic(JSON.stringify({ case: context.name, expectedCode: "EROFS", methods: methods(service), unchanged: true }));
});

for (const status of [401, 403]) {
  test(`real HTTP ${status} on the second directory authorization probe prevents source acquisition and publication`, { timeout: 5000 }, async context => {
    const service = seed();
    const before = structuredClone(service.files);
    const local = createMemoryFileSystem();
    await local.writeFile("/source", bytes);
    const observed = dataCalls(local);
    const requests: { method: string; path: string; status: number }[] = [];
    let directoryVisits = 0;
    await withLoopbackDav(async (url, init) => {
      const path = new URL(url).pathname.replace(/\/$/, "");
      const deny = init.method === "PROPFIND" && path === "/dav/dir" && ++directoryVisits === 2;
      const response = deny ? new Response(null, { status }) : await service.fetch(url, init);
      requests.push({ method: init.method!, path, status: response.status });
      return response;
    }, async baseUrl => {
      const backend = new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch, timeoutMs: 2000 });
      const filesystem = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dav": backend, "/local": observed.filesystem } });
      const source = status === 401 ? "/dav/dir/source" : "/local/source";
      const destination = status === 401 ? "/local/new" : "/dav/dir/new";
      await assert.rejects(filesystem.copyFile(source, destination), rejection("EACCES", source, "copyFile", destination));
    });
    assert.equal(directoryVisits, 2);
    assert.deepEqual(requests.filter(request => request.path === "/dav/dir").map(request => request.status), [207, status]);
    assert.ok(requests.every(request => request.method === "PROPFIND"));
    assert.deepEqual(observed.calls, []);
    assert.deepEqual(service.files, before);
    assert.deepEqual(await local.readdir("/"), [{ name: "source", type: "file" }]);
    assert.deepEqual(await local.readFile("/source"), bytes);
    context.diagnostic(JSON.stringify({ case: context.name, expectedCode: "EACCES", requests, dataCalls: observed.calls, unchanged: true }));
  });
}

test("cancellation during repeated remote authorization retains the exact errno-bearing cause", { timeout: 4000 }, async context => {
  const service = seed();
  const before = structuredClone(service.files);
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "abort sentinel is not a missing directory" });
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  let captured: AbortSignal | null | undefined;
  let directoryVisits = 0;
  const requests: string[] = [];
  const backend = new WebDavFileSystem({ baseUrl: "https://authority.invalid/dav/", timeoutMs: 2000, fetch: async (url, init) => {
    requests.push(init.method!);
    if (new URL(url).pathname.replace(/\/$/, "") === "/dav/dir" && ++directoryVisits === 2) {
      captured = init.signal;
      entered();
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
    }
    return service.fetch(url, init);
  } });
  const local = createMemoryFileSystem();
  const filesystem = createMountFileSystem({ root: local, mounts: { "/dav": backend } });
  const result = filesystem.copyFile("/dav/dir/source", "/new", { signal: controller.signal }).then(
    () => assert.fail("cancelled authorization must not publish a copy"), (error: unknown) => error,
  );
  await waiting;
  controller.abort(reason);
  const error = await result;
  assert.ok(error instanceof FsError);
  assert.equal(error.code, "ECANCELED");
  assert.equal(error.path, "/dav/dir/source");
  assert.equal(error.dest, "/new");
  assert.ok(error.cause instanceof FsError);
  assert.equal(error.cause.code, "ECANCELED");
  assert.equal(error.cause.cause, reason);
  assert.equal(captured?.reason, reason);
  const count = requests.length;
  await assert.rejects(filesystem.copyFile("/dav/dir/source", "/new", { signal: controller.signal }), caught => caught === reason);
  assert.equal(requests.length, count);
  assert.ok(requests.every(method => method === "PROPFIND"));
  assert.deepEqual(service.files, before);
  assert.deepEqual(await local.readdir("/"), []);
  context.diagnostic(JSON.stringify({ case: context.name, expectedCode: "ECANCELED", exactCause: true, exactPreabortReason: true, methods: requests, unchanged: true }));
});

for (const operation of ["symlink-copy", "hidden-mount-removal"] as const) {
  test(`opaque permissions-false composite keeps its ${operation} boundary`, async context => {
    const service = seed();
    const before = structuredClone(service.files);
    const backing = createMemoryFileSystem();
    await backing.symlink("dav/dir/source", "/jump");
    const inner = createMountFileSystem({ root: backing, mounts: { "/dav": remote(service) } });
    assert.equal(inner.capabilities.permissions, undefined);
    const outerRoot = createMemoryFileSystem();
    const view = operation === "symlink-copy" ? createReadOnlyFileSystem(inner) : inner;
    const { symlinks: ignoredSymlinks, ...unknownLinkCapabilities } = view.capabilities;
    let linkReads = 0;
    const opaqueView = wrapped(view, operation === "symlink-copy" ? {
      capabilities: { ...unknownLinkCapabilities, permissions: false },
      async readlink(path, options) {
        linkReads++;
        return view.readlink!(path, options);
      },
    } : { capabilities: { ...view.capabilities, permissions: false } });
    assert.equal(opaqueView instanceof MountFileSystem, false);
    assert.equal(opaqueView.capabilities.permissions, false);
    const filesystem = createMountFileSystem({ root: outerRoot, mounts: { "/view": opaqueView } });
    assert.deepEqual(await filesystem.readFile("/view/dav/dir/source"), bytes);
    service.requests.length = 0;
    if (operation === "symlink-copy") {
      assert.equal(Object.hasOwn(opaqueView.capabilities, "symlinks"), false);
      await assert.rejects(filesystem.copyFile("/view/jump", "/leaked"), rejection("EACCES", "/view/jump", "copyFile", "/leaked"));
      assert.equal(linkReads, 1);
    } else {
      await assert.rejects(filesystem.rm("/view/dav", { recursive: true }), rejection("EBUSY", "/view/dav", "rm"));
    }
    assert.ok(methods(service).every(method => method === "PROPFIND"));
    assert.deepEqual(service.files, before);
    assert.deepEqual(await outerRoot.readdir("/"), []);
    assert.equal(await backing.readlink("/jump"), "dav/dir/source");
    context.diagnostic(JSON.stringify({ case: context.name, expectedCode: operation === "symlink-copy" ? "EACCES" : "EBUSY", methods: methods(service), linkReads, opaque: true, unchanged: true }));
  });
}
