import assert from "node:assert/strict";
import test from "node:test";
import * as canonical from "poe-code/safe-fs";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../../src/fs/readonly/index.js";
import { MockS3Client, S3FileSystem, createS3Transport } from "../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../src/fs/webdav/index.js";
import { compareEntries } from "./public-comparison.js";

test("canonical public API does not expose authority writers or observation readers", () => {
  for (const name of ["registerEntryAuthority", "registerEntryView", "registerOwnedResourceResponse", "recordS3Stat", "getOwnedS3Entry", "getOwnedWebDavEntry"]) {
    assert.equal(Object.hasOwn(canonical, name), false, name);
  }
});

test("cloned S3 metadata cannot acquire proof or authorize an existing-target overwrite", async () => {
  const store = new MockS3Client({ buckets: ["bucket"] });
  const transport = createS3Transport(store, store.capabilities);
  transport.headObject = async (input, options) => ({ ...await store.headObject(input, options) });
  const remote = new S3FileSystem({ bucket: "bucket", transport });
  const memory = new MemoryFileSystem();
  await memory.writeFile("/source", new Uint8Array([1, 2]));
  await remote.writeFile("/target", new Uint8Array([3, 4]));
  const start = store.requests.length;
  const mounted = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/local": memory, "/remote": remote } });
  assert.equal(await compareEntries(memory, "/source", remote, "/target"), "unknown");
  await assert.rejects(mounted.copyFile("/local/source", "/remote/target"), { code: "ENOTSUP" });
  assert.ok(store.requests.slice(start).length > 0);
  assert.ok(store.requests.slice(start).every(request => request.operation === "headObject" || request.operation === "listObjectsV2"));
  assert.deepEqual(await memory.readFile("/source"), new Uint8Array([1, 2]));
  assert.deepEqual(await remote.readFile("/target"), new Uint8Array([3, 4]));
});

test("independent canonical and shell wrappers preserve nested aliases and readonly enforcement", async () => {
  const store = new MemoryFileSystem();
  await store.mkdir("/dir");
  await store.writeFile("/dir/file", new Uint8Array([65]));
  await store.link("/dir/file", "/dir/hardlink");
  const inner = canonical.createMountFileSystem({ root: store });
  const outer = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/left": inner, "/right": createReadOnlyFileSystem(store) } });
  assert.equal(await outer.compareEntry("/left/dir/file", outer, "/right/dir/hardlink"), "same");
  await assert.rejects(outer.writeFile("/right/dir/file", new Uint8Array()), { code: "EROFS" });
  await assert.rejects(outer.copyFile("/right/dir/file", "/left/dir/hardlink"), { code: "EINVAL" });
  assert.deepEqual(await store.readFile("/dir/file"), new Uint8Array([65]));
});

test("canonical overlay whiteouts do not delete lower data through shell readonly views", async () => {
  const lower = new MemoryFileSystem();
  await lower.writeFile("/file", new Uint8Array([65]));
  const upper = new canonical.MemoryFileSystem();
  const overlay = canonical.createOverlayFileSystem({ lower: createReadOnlyFileSystem(lower), upper });
  await overlay.rm("/file");
  await assert.rejects(overlay.stat("/file"), { code: "ENOENT" });
  assert.deepEqual(await lower.readFile("/file"), new Uint8Array([65]));
  await overlay.writeFile("/file", new Uint8Array([66]));
  assert.deepEqual(await overlay.readFile("/file"), new Uint8Array([66]));
  assert.deepEqual(await lower.readFile("/file"), new Uint8Array([65]));
});

function protocolFetch(identifier: string): canonical.WebDavFetch {
  return async (_url, init) => new Response(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/file</d:href><d:propstat><d:prop>${String(init.body).includes("resource-id") ? `<d:resource-id><d:href>${identifier}</d:href></d:resource-id>` : "<d:resourcetype/><d:getcontentlength>1</d:getcontentlength>"}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`, { status: 207 });
}

test("public WebDAV protocol alias proves same resource but never proves local-storage disjointness", async () => {
  const fetch = protocolFetch("urn:uuid:00000000-0000-0000-0000-000000000001");
  const first = new WebDavFileSystem({ baseUrl: "https://one.invalid/dav/", fetch });
  const second = new canonical.WebDavFileSystem({ baseUrl: "https://two.invalid/dav/", fetch: async (...args) => (await fetch(...args)).clone() });
  const memory = new MemoryFileSystem();
  await memory.writeFile("/file", new Uint8Array([65]));
  assert.equal(await compareEntries(first, "/file", second, "/file"), "same");
  assert.equal(await compareEntries(first, "/file", memory, "/file"), "unknown");
  const conflict = new WebDavFileSystem({ baseUrl: "https://one.invalid/dav/", fetch, compareEntry: async () => "distinct" });
  await assert.rejects(compareEntries(conflict, "/file", second, "/file"), error => error instanceof canonical.FsError && error.code === "EIO");
});

test("concurrent comparisons have operation-local recursion guards and preserve caller reasons", async () => {
  const store = new MockS3Client({ buckets: ["bucket"] });
  const memory = new MemoryFileSystem();
  await memory.writeFile("/file", new Uint8Array([1]));
  const nested: string[] = [];
  let entered = 0;
  let release!: () => void;
  const admitted = new Promise<void>(resolve => { release = resolve; });
  const remote = new S3FileSystem({ bucket: "bucket", transport: createS3Transport(store, store.capabilities),
    compareEntry: async (_path, _peer, _peerPath, options) => {
      entered++;
      if (entered === 2) release();
      await admitted;
      nested.push(await compareEntries(memory, "/file", remote, "/file", options));
      return "distinct";
    },
  });
  await remote.writeFile("/file", new Uint8Array([2]));
  assert.deepEqual(await Promise.all([compareEntries(remote, "/file", memory, "/file"), compareEntries(remote, "/file", memory, "/file")]), ["distinct", "distinct"]);
  assert.deepEqual(nested, ["unknown", "unknown"]);
  assert.equal(entered, 2);
  const reason = new canonical.FsError("ENOENT");
  await assert.rejects(compareEntries(remote, "/file", memory, "/file", { signal: AbortSignal.abort(reason) }), error => error === reason);
  assert.equal(entered, 2);
});
