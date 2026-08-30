import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem, FsOptions } from "../../../src/contracts/filesystem.js";
import { FsError } from "../../../src/contracts/errors.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { compareEntries } from "../../../src/fs/mount/comparison.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "./mock.js";

const baseUrl = "https://constructor.example/dav/";
const payload = new Uint8Array([0, 255, 128, 65]);
const previous = new Uint8Array([79, 76, 68]);
const rejectCode = (code: string) => (error: unknown) => { assert.ok(error instanceof FsError); assert.equal(error.code, code); return true; };
function provider() {
  const mock = new MockDav();
  mock.files.set("/source", payload.slice());
  mock.files.set("/target", previous.slice());
  return { mock, fetch: async (url: string, init: RequestInit) => (await mock.fetch(url, init)).clone() };
}

test("constructor callback receives backend receiver, followed paths, actual peer and signal once", async () => {
  const { mock, fetch } = provider();
  const memory = createMemoryFileSystem();
  await memory.writeFile("/target", previous);
  await memory.symlink("/target", "/link");
  const controller = new AbortController();
  let calls = 0;
  const remote = new WebDavFileSystem({ baseUrl, fetch, compareEntry: async function(path, peer, peerPath, options) {
    calls++;
    assert.equal(this, remote);
    assert.equal(path, "/source");
    assert.equal(peer, memory);
    assert.equal(peerPath, "/target");
    assert.equal(options?.signal, controller.signal);
    return "unknown";
  } });
  const mounted = createMountFileSystem({ root: memory, mounts: { "/remote": createReadOnlyFileSystem(remote) } });
  assert.equal(await mounted.compareEntry("/remote/source", memory, "/link", { signal: controller.signal }), "unknown");
  assert.equal(calls, 1);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
});

test("constructor same remains authoritative over built-in protocol distinctness", async () => {
  const { mock, fetch } = provider();
  let calls = 0;
  const remote = new WebDavFileSystem({ baseUrl, fetch, compareEntry: async () => { calls++; return "same"; } });
  assert.equal(await remote.compareEntry("/source", remote, "/target"), "same");
  assert.equal(calls, 1);
  assert.deepEqual(mock.files.get("/source"), payload);
  assert.deepEqual(mock.files.get("/target"), previous);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
});

test("constructor unknown does not fall back to built-in protocol distinctness", async () => {
  const { mock, fetch } = provider();
  const remote = new WebDavFileSystem({ baseUrl, fetch, compareEntry: async () => "unknown" });
  assert.equal(await remote.compareEntry("/source", remote, "/target"), "unknown");
  const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/remote": remote } });
  await assert.rejects(mounted.copyFile("/remote/source", "/remote/target"), rejectCode("ENOTSUP"));
  assert.deepEqual(mock.files.get("/source"), payload);
  assert.deepEqual(mock.files.get("/target"), previous);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
});

for (const result of ["same", "unknown", "distinct"] as const) {
  test(`built-in protocol alias with constructor ${result} cannot authorize effects`, async () => {
    const { mock, fetch } = provider();
    let calls = 0;
    const remote = new WebDavFileSystem({ baseUrl, fetch, compareEntry: async () => { calls++; return result; } });
    if (result === "distinct") await assert.rejects(remote.compareEntry("/source", remote, "/source"), rejectCode("EIO"));
    else assert.equal(await remote.compareEntry("/source", remote, "/source"), "same");
    assert.equal(calls, 1);
    assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
    assert.deepEqual(mock.files.get("/source"), payload);
  });
}

for (const outcome of ["EACCES", "abort", "invalid"] as const) {
  test(`constructor ${outcome} remains observable even for a built-in alias`, async () => {
    const { mock, fetch } = provider();
    const controller = new AbortController();
    const reason = new FsError("ENOENT");
    const callback = async () => {
      if (outcome === "EACCES") throw new FsError("EACCES");
      if (outcome === "abort") { controller.abort(reason); return "same"; }
      return "invalid";
    };
    const remote: WebDavFileSystem = Reflect.construct(WebDavFileSystem, [{ baseUrl, fetch, compareEntry: callback }]);
    await assert.rejects(remote.compareEntry("/source", remote, "/source", { signal: controller.signal }),
      outcome === "abort" ? error => error === reason : rejectCode(outcome === "invalid" ? "EIO" : "EACCES"));
    assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
    assert.deepEqual(mock.files.get("/source"), payload);
  });
}

test("a late public override replaces rather than double-invokes the constructor callback", async () => {
  const { fetch } = provider();
  const memory = createMemoryFileSystem();
  await memory.writeFile("/source", payload);
  let constructorCalls = 0, lateCalls = 0;
  const remote = new WebDavFileSystem({ baseUrl, fetch, compareEntry: async () => { constructorCalls++; return "distinct"; } });
  remote.compareEntry = async () => { lateCalls++; throw new FsError("EACCES"); };
  await assert.rejects(compareEntries(remote, "/source", memory, "/source"), rejectCode("EACCES"));
  assert.equal(constructorCalls, 0);
  assert.equal(lateCalls, 1);
});

test("two constructor authorities are each queried once and conflicts fail EIO", async () => {
  const { fetch } = provider();
  const calls: string[] = [];
  const first = new WebDavFileSystem({ baseUrl, fetch, compareEntry: async () => { calls.push("first"); return "same"; } });
  const second = new WebDavFileSystem({ baseUrl, fetch, compareEntry: async () => { calls.push("second"); return "distinct"; } });
  await assert.rejects(first.compareEntry("/source", second, "/target"), rejectCode("EIO"));
  assert.deepEqual(calls, ["first", "second"]);
});

test("a truthful late same override retains alias protection and replaces its constructor", async () => {
  const { mock, fetch } = provider();
  let constructorCalls = 0, lateCalls = 0;
  const remote = new WebDavFileSystem({ baseUrl, fetch, compareEntry: async () => { constructorCalls++; return "distinct"; } });
  remote.compareEntry = async () => { lateCalls++; return "same"; };
  assert.equal(await compareEntries(remote, "/source", remote, "/source"), "same");
  assert.equal(constructorCalls, 0);
  assert.equal(lateCalls, 1);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  assert.deepEqual(mock.files.get("/source"), payload);
});

test("missing or denied metadata and pre-abort precede callback invocation", async () => {
  const { fetch } = provider();
  let calls = 0;
  const remote = new WebDavFileSystem({ baseUrl, fetch, compareEntry: async () => { calls++; return "distinct"; } });
  await assert.rejects(remote.compareEntry("/missing", remote, "/target"), rejectCode("ENOENT"));
  const denied = new WebDavFileSystem({ baseUrl, fetch: async () => new Response(null, { status: 403 }), compareEntry: async () => { calls++; return "distinct"; } });
  await assert.rejects(denied.compareEntry("/source", remote, "/target"), rejectCode("EACCES"));
  const reason = new FsError("ENOENT");
  await assert.rejects(remote.compareEntry("/source", remote, "/target", { signal: AbortSignal.abort(reason) }), error => error === reason);
  assert.equal(calls, 0);
});

test("callback type remains compatible with FileSystem.compareEntry and invalid option fails EINVAL", () => {
  const callback: NonNullable<FileSystem["compareEntry"]> = async (_path: string, _peer: FileSystem, _peerPath: string, _options?: FsOptions) => "unknown";
  new WebDavFileSystem({ baseUrl, fetch: provider().fetch, compareEntry: callback });
  assert.throws(() => Reflect.construct(WebDavFileSystem, [{ baseUrl, fetch: provider().fetch, compareEntry: true }]), rejectCode("EINVAL"));
});
