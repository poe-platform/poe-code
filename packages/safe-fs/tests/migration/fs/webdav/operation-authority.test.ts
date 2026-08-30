import assert from "node:assert/strict";
import { test } from "vitest";
import { FsError } from "../../../../src/contracts/errors.js";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { compareEntries,resolveEntryView } from "../../../../src/fs/mount/comparison.js";
import { createMountFileSystem } from "../../../../src/fs/mount/index.js";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";
import { getOwnedWebDavEntry } from "../../../../src/fs/webdav/resource-id.js";
import { MockDav } from "./mock.js";

const baseUrl = "https://operations.example/dav/";
const sourceBytes = new Uint8Array([0, 255, 13, 10, 71]);
const targetBytes = new Uint8Array([79, 76, 68]);
const originals = Object.entries(Object.getOwnPropertyDescriptors(WebDavFileSystem.prototype))
  .filter(([name]) => name !== "constructor" && name !== "compareEntry");

function provider() {
  const mock = new MockDav();
  mock.files.set("/source", sourceBytes.slice());
  mock.files.set("/target", targetBytes.slice());
  return mock;
}

function alias(error: unknown): boolean {
  assert.ok(error instanceof FsError);
  assert.equal(error.code, "EINVAL");
  return true;
}

for (const timing of ["subclass-before", "base-before", "instance-after", "base-after"] as const) {
  for (const [name, descriptor] of originals) {
    test(`resource authority preserves faithful ${timing} decorator of ${name}`, async () => {
      const mock = provider();
      const before = structuredClone(mock.files);
      class ForwardingView extends WebDavFileSystem {}
      const forward = function(this: WebDavFileSystem, ...args: unknown[]) {
        return Reflect.apply(descriptor.value, this, args);
      };
      const replacement = { ...descriptor, value: forward };
      const normal = new WebDavFileSystem({ baseUrl, fetch: mock.fetch, requestStreamSupport: true });
      let view: WebDavFileSystem;
      try {
        if (timing === "subclass-before") Object.defineProperty(ForwardingView.prototype, name, replacement);
        if (timing === "base-before") Object.defineProperty(WebDavFileSystem.prototype, name, replacement);
        view = new ForwardingView({ baseUrl, fetch: mock.fetch, requestStreamSupport: true });
        const earlier = timing === "instance-after" || timing === "base-after"
          ? await resolveEntryView(view, "/source") : undefined;
        if (earlier) assert.ok(getOwnedWebDavEntry(earlier));
        if (timing === "instance-after") Object.defineProperty(view, name, replacement);
        if (timing === "base-after") Object.defineProperty(WebDavFileSystem.prototype, name, replacement);
        if (earlier) assert.equal(getOwnedWebDavEntry(earlier)?.storage, mock.files);
        assert.equal(getOwnedWebDavEntry(await resolveEntryView(view, "/source"))?.storage, mock.files);
        assert.equal(await view.compareEntry("/source", normal, "/target"), "distinct");
        assert.equal(await normal.compareEntry("/target", view, "/source"), "distinct");
        assert.equal(await normal.compareEntry("/source", view, "/source"), "same");
        const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/view": view, "/normal": normal } });
        await assert.rejects(mounted.copyFile("/view/source", "/normal/source"), alias);
        assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
        assert.deepEqual(mock.files, before);
        await mounted.copyFile("/view/source", "/normal/target");
        assert.deepEqual(mock.files.get("/target"), sourceBytes);
        await mounted.copyFile("/normal/source", "/view/target");
        before.set("/target", sourceBytes);
        assert.deepEqual(mock.files, before);
        const uploads = mock.requests.filter(request => request.init.method === "PUT");
        assert.equal(uploads.length, 2);
        assert.ok(uploads.every(request => request.init.body instanceof ReadableStream && request.init.body.locked));
      } finally {
        if (timing === "base-before" || timing === "base-after") Object.defineProperty(WebDavFileSystem.prototype, name, descriptor);
      }
    });
  }
}

test("subclass with unchanged original behavior retains protocol and private provider authority", async () => {
  class UnmodifiedView extends WebDavFileSystem {}
  const mock = provider();
  const view = new UnmodifiedView({ baseUrl, fetch: mock.createFetch() });
  assert.ok(getOwnedWebDavEntry(await resolveEntryView(view, "/source")));
  assert.equal(await view.compareEntry("/source", view, "/target"), "distinct");
  assert.equal(await view.compareEntry("/source", view, "/source"), "same");
});

test("faithful transport replacement retains fresh private and protocol authority", async () => {
  const mock = provider();
  const view = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
  const observed = await resolveEntryView(view, "/source");
  assert.ok(getOwnedWebDavEntry(observed));
  Object.defineProperty(view, "transport", { value: mock.createFetch() });
  assert.equal(getOwnedWebDavEntry(observed)?.storage, mock.files);
  assert.equal(getOwnedWebDavEntry(await resolveEntryView(view, "/source"))?.storage, mock.files);
  assert.equal(await view.compareEntry("/source", view, "/target"), "distinct");
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
});

test("faithful method decoration during peer metadata preserves protocol authority", async () => {
  const mock = provider();
  const view = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
  let replacements = 0;
  const peer = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
    const response = await mock.fetch(url, init);
    const body = init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init.body);
    if (body.includes("resource-id")) {
      replacements++;
      Object.defineProperty(view, "writeStream", { value: view.writeStream.bind(view) });
    }
    return response;
  } });
  assert.equal(await view.compareEntry("/source", peer, "/target"), "distinct");
  assert.equal(replacements, 1);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  assert.deepEqual(mock.files.get("/source"), sourceBytes);
  assert.deepEqual(mock.files.get("/target"), targetBytes);
});

test("faithful inherited authority does not suppress an explicit external peer authority", async () => {
  const mock = provider();
  class ChangedView extends WebDavFileSystem {
    override async readFile(path: string) { return super.readFile(path); }
  }
  const view = new ChangedView({ baseUrl, fetch: mock.fetch });
  const peer = createMemoryFileSystem();
  await peer.writeFile("/target", targetBytes);
  let calls = 0;
  const external: FileSystem = new Proxy(peer, {
    get(target, key) {
      if (key === "compareEntry") return async () => { calls++; return "same"; };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  assert.equal(await compareEntries(view, "/source", external, "/target"), "same");
  assert.equal(calls, 1);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
});

for (const timing of ["subclass-before", "instance-after"] as const) {
  test(`explicit WebDAV comparison override remains authoritative ${timing}`, async () => {
    const mock = provider();
    const calls: string[] = [];
    class ExplicitView extends WebDavFileSystem {}
    const compare = async (path: string, peer: FileSystem, peerPath: string) => {
      calls.push(`${path}:${peerPath}`);
      assert.equal(peer, normal);
      return "same";
    };
    if (timing === "subclass-before") Object.defineProperty(ExplicitView.prototype, "compareEntry", { value: compare });
    const view = new ExplicitView({ baseUrl, fetch: mock.fetch });
    if (timing === "instance-after") Object.defineProperty(view, "compareEntry", { value: compare });
    const normal = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
    assert.equal(await compareEntries(normal, "/target", view, "/source"), "same");
    assert.deepEqual(calls, ["/source:/target"]);
    assert.equal(getOwnedWebDavEntry(await resolveEntryView(view, "/source"))?.storage, mock.files);
    assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  });
}

test("explicit WebDAV overrides are queried once each and conflicts fail before effects", async () => {
  const mock = provider();
  const first = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
  const second = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
  const calls: string[] = [];
  Object.defineProperty(first, "compareEntry", { value: async () => { calls.push("first"); return "same"; } });
  Object.defineProperty(second, "compareEntry", { value: async () => { calls.push("second"); return "distinct"; } });
  await assert.rejects(compareEntries(first, "/source", second, "/target"), error => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "EIO");
    return true;
  });
  assert.deepEqual(calls, ["first", "second"]);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  assert.deepEqual(mock.files.get("/source"), sourceBytes);
  assert.deepEqual(mock.files.get("/target"), targetBytes);
});

test("explicit WebDAV authority invalid answers and cancellation preserve typed errors", async () => {
  const mock = provider();
  const first = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
  const second = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
  Object.defineProperty(first, "compareEntry", { configurable: true, value: async () => "invalid" });
  await assert.rejects(compareEntries(first, "/source", second, "/target"), error => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "EIO");
    return true;
  });
  const controller = new AbortController();
  const reason = new FsError("ENOENT");
  Object.defineProperty(first, "compareEntry", { value: async () => { controller.abort(reason); return "same"; } });
  let peerCalls = 0;
  Object.defineProperty(second, "compareEntry", { value: async () => { peerCalls++; return "same"; } });
  await assert.rejects(compareEntries(first, "/source", second, "/target", { signal: controller.signal }), error => error === reason);
  assert.equal(peerCalls, 0);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
});

test("explicit forwarding to the base method stays unknown without recursive metadata negotiation", async () => {
  const mock = provider();
  class ForwardingAuthority extends WebDavFileSystem {
    override compareEntry(...args: Parameters<WebDavFileSystem["compareEntry"]>) { return super.compareEntry(...args); }
  }
  const view = new ForwardingAuthority({ baseUrl, fetch: mock.fetch });
  assert.equal(await compareEntries(view, "/source", view, "/target"), "unknown");
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  assert.equal(mock.requests.length, 6);
  assert.equal(mock.requests.filter(request => {
    const body = request.init.body instanceof Uint8Array ? new TextDecoder().decode(request.init.body) : String(request.init.body);
    return body.includes("resource-id");
  }).length, 2);
});
