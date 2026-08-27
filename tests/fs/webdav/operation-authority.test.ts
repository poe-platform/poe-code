import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem } from "../../../src/contracts/filesystem.js";
import { FsError } from "../../../src/contracts/errors.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { compareEntries, resolveEntryView } from "../../../src/fs/mount/comparison.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { getOwnedWebDavEntry } from "../../../src/fs/webdav/resource-id.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
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

function unsupported(error: unknown): boolean {
  assert.ok(error instanceof FsError);
  assert.equal(error.code, "ENOTSUP");
  return true;
}

for (const timing of ["subclass-before", "base-before", "instance-after", "base-after"] as const) {
  for (const [name, descriptor] of originals) {
    test(`resource authority declines ${timing} override of ${name}`, async () => {
      const mock = provider();
      const before = structuredClone(mock.files);
      class ForwardingView extends WebDavFileSystem {}
      const forward = function(this: WebDavFileSystem, ...args: unknown[]) {
        return Reflect.apply(descriptor.value, this, args);
      };
      const replacement = { ...descriptor, value: forward };
      const normal = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
      let view: WebDavFileSystem;
      try {
        if (timing === "subclass-before") Object.defineProperty(ForwardingView.prototype, name, replacement);
        if (timing === "base-before") Object.defineProperty(WebDavFileSystem.prototype, name, replacement);
        view = new ForwardingView({ baseUrl, fetch: mock.fetch });
        const earlier = timing === "instance-after" || timing === "base-after"
          ? await resolveEntryView(view, "/source") : undefined;
        if (earlier) assert.ok(getOwnedWebDavEntry(earlier));
        if (timing === "instance-after") Object.defineProperty(view, name, replacement);
        if (timing === "base-after") Object.defineProperty(WebDavFileSystem.prototype, name, replacement);
        if (earlier) assert.equal(getOwnedWebDavEntry(earlier), undefined);
        assert.equal(getOwnedWebDavEntry(await resolveEntryView(view, "/source")), undefined);
        assert.equal(await view.compareEntry("/source", normal, "/target"), "unknown");
        assert.equal(await normal.compareEntry("/target", view, "/source"), "unknown");
        const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/view": view, "/normal": normal } });
        await assert.rejects(mounted.copyFile("/view/source", "/normal/target"), unsupported);
        await assert.rejects(mounted.copyFile("/normal/source", "/view/target"), unsupported);
        assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
        assert.deepEqual(mock.files, before);
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

test("replacing the enrolled transport invalidates private and protocol authority", async () => {
  const mock = provider();
  const view = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
  const observed = await resolveEntryView(view, "/source");
  assert.ok(getOwnedWebDavEntry(observed));
  Object.defineProperty(view, "transport", { value: mock.createFetch() });
  assert.equal(getOwnedWebDavEntry(observed), undefined);
  assert.equal(await view.compareEntry("/source", view, "/target"), "unknown");
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
});

test("method replacement during peer metadata invalidates earlier protocol authority", async () => {
  const mock = provider();
  const view = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
  let replacements = 0;
  const peer = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
    const response = await mock.fetch(url, init);
    const body = init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init.body);
    if (body.includes("resource-id")) {
      replacements++;
      Object.defineProperty(view, "writeStream", { value: async () => { throw new Error("must not acquire destination"); } });
    }
    return response;
  } });
  assert.equal(await view.compareEntry("/source", peer, "/target"), "unknown");
  assert.equal(replacements, 1);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  assert.deepEqual(mock.files.get("/source"), sourceBytes);
  assert.deepEqual(mock.files.get("/target"), targetBytes);
});

test("declining inherited authority does not suppress an explicit external peer authority", async () => {
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
