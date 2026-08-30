import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { standardCommands } from "../../../src/commands/index.js";
import { FsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import type { FileSystem } from "../../../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { Shell } from "../../../src/shell/index.js";
import { MockDav } from "../webdav/mock.js";
import { withLoopbackDav } from "../webdav/property-fixture.js";

const bytes = new Uint8Array([0, 255, 128, 13, 10, 65, 0]);
const prior = new Uint8Array([79, 76, 68]);

function rejected(code: ErrnoCode, path: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, code);
    assert.equal(error.path, path);
    return true;
  };
}

function seeded() {
  const mock = new MockDav();
  mock.files.set("/dir", null);
  mock.files.set("/dir/source", bytes.slice());
  mock.files.set("/dir/existing", prior.slice());
  mock.files.set("/sentinel", prior.slice());
  return mock;
}

function mounted(remote: FileSystem) {
  return createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dav": remote } });
}

function wrapped(base: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

test("WebDAV loopback mounted tools copy missing target and rename existing target without execute fiction", async () => {
  const mock = seeded();
  await withLoopbackDav(mock.fetch, async baseUrl => {
    const remote = new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch });
    const fs = mounted(remote);
    const shell = new Shell({ fs }).use(standardCommands());
    assert.equal((await fs.stat("/dav/dir/source")).size, bytes.length);
    assert.deepEqual(await fs.readFile("/dav/dir/source"), bytes);
    const copy = await shell.exec("cp /dav/dir/source /dav/dir/new");
    assert.equal(copy.exitCode, 0, copy.stderr);
    assert.equal(copy.stdout, "");
    assert.equal(copy.stderr, "");
    assert.deepEqual(mock.files.get("/dir/new"), bytes);
    const move = await shell.exec("mv /dav/dir/new /dav/dir/existing");
    assert.equal(move.exitCode, 0, move.stderr);
    assert.equal(move.stdout, "");
    assert.equal(move.stderr, "");
    assert.deepEqual(mock.files, new Map([
      ["/", null], ["/dir", null], ["/dir/source", bytes], ["/dir/existing", bytes], ["/sentinel", prior],
    ]));
    assert.ok(mock.requests.some(request => request.init.method === "COPY"));
    assert.ok(mock.requests.some(request => request.init.method === "MOVE"));
    assert.equal(remote.capabilities.permissions, false);
    assert.equal((await remote.stat("/dir/source")).identityScope, undefined);
  });
});

for (const existing of [false, true]) {
  test(`WebDAV mounted writes ${existing ? "existing" : "missing"} file after server authorization`, async () => {
    const mock = seeded();
    const remote = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
    const fs = mounted(remote);
    const path = existing ? "/dav/dir/existing" : "/dav/dir/new";
    await fs.writeFile(path, bytes, { flag: existing ? "w" : "wx" });
    assert.deepEqual(await fs.readFile(path), bytes);
    assert.deepEqual(mock.files.get("/dir/source"), bytes);
    assert.deepEqual(mock.files.get("/sentinel"), prior);
    const write = mock.requests.find(request => request.init.method === "PUT");
    assert.ok(write);
    assert.equal(write.headers.get("If-None-Match"), existing ? null : "*");
    assert.equal(write.headers.get("If-Match"), null);
    assert.deepEqual(new Uint8Array(await new Response(write.init.body).arrayBuffer()), bytes);
  });
}

for (const [method, path, existing] of [
  ["PROPFIND", "/dav/dir/source", true], ["GET", "/dav/dir/source", true],
  ["PUT", "/dav/dir/new", false], ["PUT", "/dav/dir/existing", true],
] as const) {
  test(`WebDAV mounted ${method} denial, target ${existing ? "existing" : "missing"}, preserves exact backing state`, async () => {
    const mock = seeded();
    const before = structuredClone(mock.files);
    const requests: string[] = [];
    await withLoopbackDav(async (url, init) => {
      requests.push(init.method!);
      if (init.method === method && (method !== "PROPFIND" || new URL(url).pathname.replace(/\/$/, "") === "/dav/dir")) {
        return new Response(null, { status: 403 });
      }
      return mock.fetch(url, init);
    }, async baseUrl => {
      const fs = mounted(new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch }));
      await assert.rejects(method === "PUT" ? fs.writeFile(path, bytes) : fs.readFile(path), rejected("EACCES", path));
      assert.ok(requests.includes(method));
      assert.deepEqual(mock.files, before);
      if (method !== "PUT") assert.ok(requests.every(value => ["PROPFIND", "GET"].includes(value)));
    });
  });
}

test("WebDAV mounted missing ancestors and file ancestors preserve typed errors without writes", async () => {
  const mock = seeded();
  const fs = mounted(new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch }));
  const before = structuredClone(mock.files);
  await assert.rejects(fs.writeFile("/dav/missing/child", bytes), rejected("ENOENT", "/dav/missing/child"));
  await assert.rejects(fs.writeFile("/dav/dir/source/child", bytes), rejected("ENOTDIR", "/dav/dir/source/child"));
  assert.deepEqual(mock.files, before);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
});

test("WebDAV mounted cp propagates server COPY denial with nonzero status and no effects", async () => {
  const mock = seeded();
  const before = structuredClone(mock.files);
  let denied = 0;
  await withLoopbackDav(async (url, init) => {
    if (init.method === "COPY") { denied++; return new Response(null, { status: 403 }); }
    return mock.fetch(url, init);
  }, async baseUrl => {
    const fs = mounted(new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch }));
    const result = await new Shell({ fs }).use(standardCommands()).exec("cp /dav/dir/source /dav/dir/new");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /permission denied/i);
    assert.match(result.stderr, /source/);
    assert.equal(denied, 1);
    assert.deepEqual(mock.files, before);
  });
});

test("WebDAV directory execute access permits traversal without claiming write permission support", async () => {
  const mock = seeded();
  const fs = mounted(new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch }));
  await fs.access("/dav/dir", 0);
  await fs.access("/dav/dir", 1);
  assert.equal(fs.capabilities.permissions, false);
  for (const mode of [2, 3, 6, 7]) await assert.rejects(fs.access("/dav/dir", mode), rejected("ENOTSUP", "/dav/dir"));
  assert.deepEqual(mock.files.get("/dir/source"), bytes);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
});

for (const code of ["EACCES", "ENOTSUP"] as const) {
  test(`explicit non-permission traversal propagates ${code}, not an error-based fallback`, async () => {
    const mock = seeded();
    const remote = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
    const failure = new FsError(code, { path: "/", syscall: "access" });
    const modes: number[] = [];
    const fs = mounted(wrapped(remote, { async access(_path, mode = 0) { modes.push(mode); throw failure; } }));
    await assert.rejects(fs.readFile("/dav/dir/source"), error => {
      rejected(code, "/dav/dir/source")(error);
      assert.ok(error instanceof FsError);
      assert.equal(error.cause, failure);
      return true;
    });
    assert.deepEqual(modes, [0]);
    assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  });
}

for (const permissions of [true, undefined]) {
  test(`mixed mount retains execute probe for permissions=${permissions}`, async () => {
    const local = createMemoryFileSystem();
    await local.writeFile("/file", bytes);
    const modes: number[] = [];
    const backend = wrapped(local, {
      capabilities: permissions === undefined ? {} : { permissions },
      async access(_path, mode = 0) { modes.push(mode); throw new FsError("EACCES"); },
    });
    const remote = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: seeded().fetch });
    const fs = createMountFileSystem({ root: backend, mounts: { "/dav": remote } });
    assert.equal(fs.capabilities.permissions, false);
    await assert.rejects(fs.readFile("/file"), rejected("EACCES", "/file"));
    assert.deepEqual(modes, [1]);
    assert.deepEqual(await local.readFile("/file"), bytes);
  });
}

for (const kind of ["memory", "real"] as const) {
  test(`${kind} actual directory execute denial survives a mixed WebDAV mount`, async context => {
    const root = kind === "real" ? await mkdtemp(join(tmpdir(), "mount-execute-")) : undefined;
    const local = root ? await createRealFileSystem({ root }) : createMemoryFileSystem();
    await local.mkdir("/blocked");
    await local.writeFile("/blocked/file", bytes);
    await local.chmod("/blocked", 0o600);
    context.after(async () => {
      await local.chmod("/blocked", 0o700);
      if (root) await rm(root, { recursive: true, force: true });
    });
    const fs = createMountFileSystem({ root: local, mounts: { "/dav": new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: seeded().fetch }) } });
    await assert.rejects(local.access("/blocked", 1), error => error instanceof FsError && error.code === "EACCES");
    await assert.rejects(fs.readFile("/blocked/file"), rejected("EACCES", "/blocked/file"));
    await local.chmod("/blocked", 0o700);
    assert.deepEqual(await local.readFile("/blocked/file"), bytes);
  });
}

test("WebDAV traversal pre-abort retains caller reason and issues no request", async () => {
  const mock = seeded();
  const fs = mounted(new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch }));
  const reason = new FsError("ENOENT", { message: "caller abort, not missing target" });
  await assert.rejects(fs.readFile("/dav/dir/source", { signal: AbortSignal.abort(reason) }), error => error === reason);
  assert.equal(mock.requests.length, 0);
});

test("WebDAV traversal in-flight cancellation propagates into the authorization request", { timeout: 3000 }, async () => {
  const mock = seeded();
  const before = structuredClone(mock.files);
  const controller = new AbortController();
  let calls = 0;
  let captured: AbortSignal | null | undefined;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const remote = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    if (++calls !== 2) return mock.fetch(url, init);
    captured = init.signal;
    entered();
    return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
  } });
  const fs = mounted(remote);
  const operation = assert.rejects(fs.readFile("/dav/dir/source", { signal: controller.signal }), rejected("ECANCELED", "/dav/dir/source"));
  await waiting;
  controller.abort(new Error("stop authorization"));
  await operation;
  assert.equal(captured?.aborted, true);
  assert.equal(calls, 2);
  assert.deepEqual(mock.files, before);
});
