import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { FileSystem, FsOptions } from "../../../src/contracts/filesystem.js";
import { FsError } from "../../../src/contracts/errors.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { compareEntries, resolveEntryView } from "../../../src/fs/mount/comparison.js";
import { compareIdentity } from "../../../src/fs/mount/identity.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { RealFileSystem } from "../../../src/fs/real/index.js";
import { getOwnedWebDavEntry, registerOwnedResourceResponse } from "../../../src/fs/webdav/resource-id.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import type { WebDavFetch } from "../../../src/fs/webdav/index.js";
import { escapeXml, MockDav, multistatus, resource, xmlResponse } from "./mock.js";

const baseUrl = "https://binding.example/dav/";
const bytes = new Uint8Array([0, 255, 13, 10, 9, 0]);
const old = new Uint8Array([79, 76, 68]);
const errno = (code: string) => (error: unknown) => {
  assert.ok(error instanceof FsError);
  assert.equal(error.code, code);
  return true;
};
const bodyText = (init: RequestInit) => init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init.body);

function seededMock() {
  const mock = new MockDav();
  mock.files.set("/source", bytes.slice());
  mock.files.set("/target", old.slice());
  return mock;
}

for (const transport of ["manual", "fetch-proxy", "decorated-filesystem"] as const) {
  for (const direction of ["to-remote", "from-remote"] as const) {
    test(`trusted ${transport} restores mixed existing-target copy ${direction}`, async () => {
      const mock = seededMock();
      const fetch = transport === "fetch-proxy" ? new Proxy(mock.fetch, { apply(target, receiver, args) {
        return Reflect.apply(target, receiver, args);
      } }) : (url: string, init: RequestInit) => mock.fetch(url, init);
      class Decorated extends WebDavFileSystem {
        override readStream(...args: Parameters<WebDavFileSystem["readStream"]>) { return super.readStream(...args); }
        override writeStream(...args: Parameters<WebDavFileSystem["writeStream"]>) { return super.writeStream(...args); }
      }
      const remote = transport === "decorated-filesystem" ? new Decorated({ baseUrl, fetch }) : new WebDavFileSystem({ baseUrl, fetch });
      const memory = createMemoryFileSystem();
      await memory.writeFile("/source", bytes);
      await memory.writeFile("/target", old);
      const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/local": memory, "/remote": remote } });
      assert.equal(await compareEntries(memory, "/source", remote, "/target"), "distinct");
      assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
      const paths = direction === "to-remote" ? ["/local/source", "/remote/target"] : ["/remote/source", "/local/target"];
      await mounted.copyFile(paths[0]!, paths[1]!);
      assert.deepEqual(await memory.readFile("/source"), bytes);
      assert.deepEqual(mock.files.get("/source"), bytes);
      assert.deepEqual(await memory.readFile("/target"), direction === "from-remote" ? bytes : old);
      assert.deepEqual(mock.files.get("/target"), direction === "to-remote" ? bytes : old);
      assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["source", "target"]);
      assert.deepEqual([...mock.files.keys()].sort(), ["/", "/source", "/target"]);
    });
  }
}

test("observations bind the exact stat, filesystem and path and are refreshed after recreation", async () => {
  const mock = seededMock();
  const first = new WebDavFileSystem({ baseUrl, fetch: (url, init) => mock.fetch(url, init) });
  const second = new WebDavFileSystem({ baseUrl, fetch: mock.createFetch() });
  const view = await resolveEntryView(first, "/source");
  const observed = getOwnedWebDavEntry(view)!;
  assert.equal(observed.storage, mock.files);
  assert.equal(getOwnedWebDavEntry({ ...view, filesystem: second }), undefined);
  assert.equal(getOwnedWebDavEntry({ ...view, path: "/target" }), undefined);
  assert.equal(getOwnedWebDavEntry({ ...view, stat: { ...view.stat } }), undefined);
  mock.files.delete("/source");
  mock.files.set("/source", old.slice());
  const fresh = getOwnedWebDavEntry(await resolveEntryView(first, "/source"))!;
  assert.notEqual(fresh.resource, observed.resource);
  assert.deepEqual(mock.files.get("/source"), old);
});

test("cloning Responses retains protocol identity but not private local-store comparison", async () => {
  const mock = seededMock();
  const fetch: WebDavFetch = async (url, init) => (await mock.fetch(url, init)).clone();
  const remote = new WebDavFileSystem({ baseUrl, fetch });
  const peer = new WebDavFileSystem({ baseUrl: "https://alias.example/dav/", fetch });
  const memory = createMemoryFileSystem();
  await memory.writeFile("/source", bytes);
  assert.equal(await remote.compareEntry("/source", peer, "/source"), "same");
  assert.equal(await remote.compareEntry("/source", peer, "/target"), "distinct");
  assert.equal(getOwnedWebDavEntry(await resolveEntryView(remote, "/source")), undefined);
  assert.equal(await compareEntries(memory, "/source", remote, "/target"), "unknown");
  const mounted = createMountFileSystem({ root: memory, mounts: { "/remote": remote } });
  await assert.rejects(mounted.copyFile("/source", "/remote/target"), errno("ENOTSUP"));
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  assert.deepEqual(await memory.readFile("/source"), bytes);
  assert.deepEqual(mock.files.get("/target"), old);
});

test("an already-consumed provider Response cannot replay fresh stat provenance", async () => {
  const mock = seededMock();
  const cached = await mock.fetch(`${baseUrl}source`, { method: "PROPFIND", headers: { Depth: "0" } });
  const remote = new WebDavFileSystem({ baseUrl, fetch: async () => cached });
  assert.ok(await remote.stat("/source"));
  await assert.rejects(remote.stat("/source"), errno("EIO"));
  assert.deepEqual(mock.files.get("/source"), bytes);
});

function gateway(backing: FileSystem) {
  const requests: string[] = [];
  const identifiers = new Map<object | symbol | undefined, Map<string, string>>();
  const fetch: WebDavFetch = async (url, init) => {
    requests.push(init.method!);
    const path = decodeURIComponent(new URL(url).pathname.slice(4));
    const stat = await backing.stat(path, { ...(init.signal ? { signal: init.signal } : {}) });
    if (init.method === "PROPFIND") {
      let scope = identifiers.get(stat.identityScope);
      if (!scope) { scope = new Map(); identifiers.set(stat.identityScope, scope); }
      const key = `${stat.dev}:${stat.ino}`;
      let identifier = scope.get(key);
      if (!identifier) { identifier = `urn:uuid:${randomUUID()}`; scope.set(key, identifier); }
      const property = bodyText(init).includes("resource-id")
        ? `<z:propstat><z:prop><z:resource-id><z:href>${identifier}</z:href></z:resource-id></z:prop><z:status>HTTP/1.1 200 OK</z:status></z:propstat>` : "";
      return xmlResponse(multistatus(resource(`/dav${path}`, stat.type === "directory", stat.size, property)));
    }
    if (init.method === "GET") return new Response(await backing.readFile(path));
    if (init.method === "PUT") {
      await backing.writeFile(path, new Uint8Array(await new Response(init.body).arrayBuffer()));
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 501 });
  };
  return { requests, fetch };
}

for (const kind of ["memory", "real"] as const) {
  for (const bound of [false, true]) {
    test(`actual ${kind}-backed gateway alias with ${bound ? "explicit" : "absent"} shared binding`, async () => {
      const directory = kind === "real" ? await mkdtemp(join(tmpdir(), "webdav-gateway-")) : undefined;
      try {
        const backing = directory ? new RealFileSystem(directory) : createMemoryFileSystem();
        await backing.writeFile("/source", bytes);
        await backing.writeFile("/target", old);
        const provider = gateway(backing);
        const remote = new WebDavFileSystem({ baseUrl, fetch: provider.fetch });
        if (bound) Object.defineProperty(remote, "compareEntry", { value: async (path: string, peer: FileSystem, peerPath: string, options: FsOptions = {}) => {
          options.signal?.throwIfAborted();
          if (peer !== backing) return "unknown";
          const source = await backing.stat(path, options);
          options.signal?.throwIfAborted();
          const target = await backing.stat(peerPath, options);
          options.signal?.throwIfAborted();
          return compareIdentity(source, target);
        } });
        assert.equal(getOwnedWebDavEntry(await resolveEntryView(remote, "/source")), undefined);
        assert.equal(await compareEntries(remote, "/source", backing, "/source"), bound ? "same" : "unknown");
        assert.equal(await compareEntries(remote, "/source", backing, "/target"), bound ? "distinct" : "unknown");
        const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/local": backing, "/remote": remote } });
        await assert.rejects(mounted.copyFile("/local/source", "/remote/source"), errno(bound ? "EINVAL" : "ENOTSUP"));
        await assert.rejects(mounted.copyFile("/remote/source", "/local/source"), errno(bound ? "EINVAL" : "ENOTSUP"));
        assert.ok(provider.requests.every(method => method === "PROPFIND"));
        assert.deepEqual(await backing.readFile("/source"), bytes);
        assert.deepEqual(await backing.readFile("/target"), old);
        assert.deepEqual((await backing.readdir("/")).map(entry => entry.name).sort(), ["source", "target"]);
      } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
    });
  }
}

for (const outcome of ["denied", "cancel", "conflict", "invalid"] as const) {
  test(`late explicit ${outcome} is not suppressed by recognized Memory/private-Map distinctness`, async () => {
    const mock = seededMock();
    const memory = createMemoryFileSystem();
    await memory.writeFile("/source", bytes);
    const remote = new WebDavFileSystem({ baseUrl, fetch: (url, init) => mock.fetch(url, init) });
    const controller = new AbortController();
    const reason = new FsError("ENOENT");
    let calls = 0;
    Object.defineProperty(remote, "compareEntry", { value: async () => {
      calls++;
      if (outcome === "denied") throw new FsError("EACCES");
      if (outcome === "cancel") { controller.abort(reason); return "distinct"; }
      return outcome === "conflict" ? "same" : "invalid";
    } });
    const mounted = createMountFileSystem({ root: memory, mounts: { "/remote": remote } });
    await assert.rejects(mounted.copyFile("/source", "/remote/target", { signal: controller.signal }),
      outcome === "cancel" ? error => error === reason : errno(outcome === "denied" ? "EACCES" : "EIO"));
    assert.equal(calls, 1);
    assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
    assert.deepEqual(await memory.readFile("/source"), bytes);
    assert.deepEqual(mock.files.get("/target"), old);
  });
}

test("trusted observations do not bypass read-only mount policy", async () => {
  const mock = seededMock();
  const memory = createMemoryFileSystem();
  await memory.writeFile("/source", bytes);
  const remote = new WebDavFileSystem({ baseUrl, fetch: (url, init) => mock.fetch(url, init) });
  const mounted = createMountFileSystem({ root: memory, mounts: { "/remote": createReadOnlyFileSystem(remote) } });
  await assert.rejects(mounted.copyFile("/source", "/remote/target"), errno("EROFS"));
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  assert.deepEqual(mock.files.get("/target"), old);
});

test("protocol identity contradicting a provider backing observation fails EIO", async () => {
  const mock = seededMock();
  const backing = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
  const observed = getOwnedWebDavEntry(await resolveEntryView(backing, "/source"))!;
  const actual = `urn:uuid:${randomUUID()}`;
  const falseIdentifier = `urn:uuid:${randomUUID()}`;
  const remote = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
    if (!bodyText(init).includes("resource-id")) return mock.fetch(url, init);
    const result = xmlResponse(multistatus(resource("/dav/source", false, bytes.length,
      `<z:propstat><z:prop><z:resource-id><z:href>${escapeXml(falseIdentifier)}</z:href></z:resource-id></z:prop><z:status>HTTP/1.1 200 OK</z:status></z:propstat>`)));
    registerOwnedResourceResponse(result, new Map([["/source", { ...observed, identifier: actual }]]));
    return result;
  } });
  await assert.rejects(remote.compareEntry("/source", backing, "/source"), errno("EIO"));
  assert.deepEqual(mock.files.get("/source"), bytes);
});
