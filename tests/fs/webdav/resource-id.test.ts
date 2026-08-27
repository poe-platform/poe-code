import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { resolveEntryView } from "../../../src/fs/mount/comparison.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import type { WebDavFetch } from "../../../src/fs/webdav/index.js";
import { getOwnedWebDavEntry, resourceIdentifier } from "../../../src/fs/webdav/resource-id.js";
import { escapeXml, MockDav, multistatus, xmlResponse } from "./mock.js";
import { withLoopbackDav } from "./property-fixture.js";

const bytes = new Uint8Array([0, 255, 128, 13, 10, 7]);
const old = new Uint8Array([79, 76, 68]);
const identifier = "urn:uuid:2f816de0-c84b-43c8-8650-d3e92bfe6d8d";
const baseUrl = "https://example.test/dav/";
const bodyText = (init: RequestInit) => init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init.body);
const identityRequest = (init: RequestInit) => init.method === "PROPFIND" && bodyText(init).includes("resource-id");
const propstat = (value: string, status = 200) => `<z:propstat><z:prop>${value}</z:prop><z:status>HTTP/1.1 ${status} Status</z:status></z:propstat>`;
const property = (value = identifier) => `<z:resource-id><z:href>${escapeXml(value)}</z:href></z:resource-id>`;
const response = (value: string, href = "/dav/source") => `<z:response><z:href>${href}</z:href>${value}</z:response>`;

function rejected(code: ErrnoCode) {
  return (error: unknown) => { assert.ok(error instanceof FsError); assert.equal(error.code, code); return true; };
}

function seed() {
  const mock = new MockDav();
  mock.files.set("/source", bytes.slice());
  mock.files.set("/target", bytes.slice());
  return mock;
}

test("resource-id comparison is metadata-only, full-ID based, and deduplicates one protocol authority", async () => {
  const mock = seed();
  const left = new WebDavFileSystem({ baseUrl, fetch: (url, init) => mock.fetch(url, init) });
  const right = new WebDavFileSystem({ baseUrl: "https://endpoint-alias.test/dav/", fetch: (url, init) => mock.fetch(url, init) });
  assert.equal(mock.etag("/source"), mock.etag("/target"));
  const before = structuredClone(mock.files);
  assert.equal(await left.compareEntry("/source", right, "/target"), "distinct");
  assert.equal(mock.requests.filter(request => identityRequest(request.init)).length, 2);
  assert.equal(await left.compareEntry("/source", right, "/source"), "same");
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND" && request.headers.get("Depth") === "0"));
  assert.deepEqual(mock.files, before);
  assert.equal((await left.stat("/source")).identityScope, undefined);
});

test("resource IDs survive overwrite and MOVE, change on COPY and delete/recreate", async () => {
  const mock = seed();
  const fs = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
  const original = getOwnedWebDavEntry(await resolveEntryView(fs, "/source"))!;
  await fs.writeFile("/source", old);
  assert.equal(getOwnedWebDavEntry(await resolveEntryView(fs, "/source"))!.resource, original.resource);
  await fs.rename("/source", "/moved");
  assert.equal(getOwnedWebDavEntry(await resolveEntryView(fs, "/moved"))!.resource, original.resource);
  await fs.copyFile("/moved", "/copy");
  assert.notEqual(getOwnedWebDavEntry(await resolveEntryView(fs, "/copy"))!.resource, original.resource);
  const destination = getOwnedWebDavEntry(await resolveEntryView(fs, "/target"))!;
  await fs.copyFile("/moved", "/target");
  assert.equal(getOwnedWebDavEntry(await resolveEntryView(fs, "/target"))!.resource, destination.resource);
  await fs.rm("/moved");
  await fs.writeFile("/moved", old);
  assert.notEqual(getOwnedWebDavEntry(await resolveEntryView(fs, "/moved"))!.resource, original.resource);
  assert.deepEqual(await fs.readFile("/copy"), old);
});

test("actual HTTP negotiates resource identity without receiving private-store provenance", async () => {
  const mock = seed();
  await withLoopbackDav(mock.fetch, async endpoint => {
    const left = new WebDavFileSystem({ baseUrl: endpoint, fetch: globalThis.fetch });
    const right = new WebDavFileSystem({ baseUrl: endpoint, fetch: globalThis.fetch });
    assert.equal(await left.compareEntry("/source", right, "/target"), "distinct");
    assert.equal(await left.compareEntry("/source", right, "/source"), "same");
    assert.equal(getOwnedWebDavEntry(await resolveEntryView(left, "/source")), undefined);
    assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  });
});

test("provider-owned factories retain the actual store; manual fetch wrappers do not", async () => {
  const mock = seed();
  const firstFetch = mock.createFetch(), secondFetch = mock.createFetch();
  assert.notEqual(firstFetch, secondFetch);
  const first = new WebDavFileSystem({ baseUrl, fetch: firstFetch });
  const second = new WebDavFileSystem({ baseUrl, fetch: secondFetch });
  const wrapped = new WebDavFileSystem({ baseUrl, fetch: (url, init) => mock.fetch(url, init) });
  const firstEntry = getOwnedWebDavEntry(await resolveEntryView(first, "/source"))!;
  const secondEntry = getOwnedWebDavEntry(await resolveEntryView(second, "/source"))!;
  assert.equal(firstEntry.storage, mock.files);
  assert.equal(firstEntry.resource, secondEntry.resource);
  assert.equal(getOwnedWebDavEntry(await resolveEntryView(wrapped, "/source")), undefined);
  const changed = mock.files.get.bind(mock.files);
  mock.files.get = path => changed(path);
  assert.equal(getOwnedWebDavEntry(await resolveEntryView(first, "/source")), undefined);
});

for (const direction of ["to-remote", "from-remote"] as const) {
  test(`mixed-routing genuine PROPFIND plus local-memory GET/PUT alias stays unknown ${direction}`, async () => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/source", bytes);
    const mock = seed();
    let dataCalls = 0;
    const fetch: WebDavFetch = async (url, init) => {
      if (init.method === "GET") { dataCalls++; return new Response(await memory.readFile("/source")); }
      if (init.method === "PUT") { dataCalls++; await memory.writeFile("/source", new Uint8Array(await new Response(init.body).arrayBuffer())); return new Response(null, { status: 204 }); }
      return mock.fetch(url, init);
    };
    const remote = new WebDavFileSystem({ baseUrl, fetch });
    assert.equal(getOwnedWebDavEntry(await resolveEntryView(remote, "/source")), undefined);
    assert.equal(await remote.compareEntry("/source", memory, "/source"), "unknown");
    const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/local": memory, "/remote": remote } });
    const paths = direction === "to-remote" ? ["/local/source", "/remote/source"] : ["/remote/source", "/local/source"];
    await assert.rejects(mount.copyFile(paths[0]!, paths[1]!), rejected("ENOTSUP"));
    assert.equal(dataCalls, 0);
    assert.deepEqual(await memory.readFile("/source"), bytes);
    assert.deepEqual(await memory.readdir("/"), [{ name: "source", type: "file" }]);
    assert.deepEqual(mock.files.get("/source"), bytes);
  });
}

const malformed: readonly [string, string, ErrnoCode | "unknown"][] = [
  ["absent property", response(propstat("<z:getetag/>")), "unknown"],
  ["property404", response(propstat("<z:resource-id/>", 404)), "unknown"],
  ["wrong property namespace", response(propstat('<v:resource-id xmlns:v="urn:other"><z:href>urn:uuid:other</z:href></v:resource-id>')), "unknown"],
  ["duplicate property", response(propstat(property() + property())), "EIO"],
  ["conflicting statuses", response(propstat(property()) + propstat("<z:resource-id/>", 404)), "EIO"],
  ["missing property href", response(propstat("<z:resource-id/>")), "EIO"],
  ["duplicate property href", response(propstat(`<z:resource-id><z:href>${identifier}</z:href><z:href>${identifier}</z:href></z:resource-id>`)), "EIO"],
  ["nested property href", response(propstat("<z:resource-id><z:href><z:href/></z:href></z:resource-id>")), "EIO"],
  ["mixed property text", response(propstat(`<z:resource-id>bad<z:href>${identifier}</z:href></z:resource-id>`)), "EIO"],
  ["relative identifier", response(propstat(property("relative/resource"))), "EIO"],
  ["bad percent escape", response(propstat(property("urn:example:bad%GG"))), "EIO"],
  ["invalid UUID", response(propstat(property("urn:uuid:bad"))), "EIO"],
  ["wrong requested href", response(propstat(property()), "/dav/target"), "EACCES"],
  ["escaped root", response(propstat(property()), "/other/source"), "EACCES"],
  ["case-changed requested href", response(propstat(property()), "/dav/SOURCE"), "EACCES"],
  ["extra response", response(propstat(property())) + response(propstat(property()), "/dav/target"), "EIO"],
  ["whole resource404", response("<z:status>HTTP/1.1 404 Missing</z:status>"), "ENOENT"],
  ["denied property", response(propstat(property(), 403)), "EACCES"],
  ["locked property", response(propstat(property(), 423)), "EBUSY"],
  ["invalid success status", response(propstat(property(), 201)), "EIO"],
];

for (const [name, xml, code] of malformed) {
  test(`resource-id ${name} never authorizes data effects`, async () => {
    const mock = seed();
    const before = structuredClone(mock.files);
    const fs = new WebDavFileSystem({ baseUrl, fetch: (url, init) => identityRequest(init)
      ? Promise.resolve(xmlResponse(multistatus(xml))) : mock.fetch(url, init) });
    if (code === "unknown") assert.equal(await fs.compareEntry("/source", fs, "/source"), "unknown");
    else await assert.rejects(fs.compareEntry("/source", fs, "/source"), rejected(code));
    assert.deepEqual(mock.files, before);
    assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  });
}

test("full non-UUID URIs are retained; UUID hex case is canonical, URI paths are not folded", () => {
  assert.equal(resourceIdentifier(identifier.toUpperCase()), identifier);
  assert.equal(resourceIdentifier("https://identity.example/Resource/A"), "https://identity.example/Resource/A");
  assert.notEqual(resourceIdentifier("urn:example:Entry-A"), resourceIdentifier("urn:example:entry-a"));
});

test("property-missing HTTP provider stays unknown and mounted existing target stays untouched", async () => {
  const mock = seed();
  const before = structuredClone(mock.files);
  await withLoopbackDav((url, init) => identityRequest(init)
    ? Promise.resolve(xmlResponse(multistatus(response(propstat("<z:resource-id/>", 404), new URL(url).pathname))))
    : mock.fetch(url, init), async endpoint => {
    const fs = new WebDavFileSystem({ baseUrl: endpoint, fetch: globalThis.fetch });
    const mount = createMountFileSystem({ root: fs });
    await assert.rejects(mount.copyFile("/source", "/target"), rejected("ENOTSUP"));
    assert.deepEqual(mock.files, before);
    assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
  });
});

test("mounted protocol proof permits ordinary overwrite but aliases and exclusive targets never mutate", async () => {
  const mock = seed();
  mock.files.set("/target", old.slice());
  const remote = new WebDavFileSystem({ baseUrl, fetch: mock.createFetch() });
  const mount = createMountFileSystem({ root: remote });
  await mount.copyFile("/source", "/target");
  assert.deepEqual(mock.files.get("/source"), bytes);
  assert.deepEqual(mock.files.get("/target"), bytes);
  const before = structuredClone(mock.files), count = mock.requests.length;
  await assert.rejects(mount.copyFile("/source", "/source"), rejected("EINVAL"));
  await assert.rejects(mount.copyFile("/source", "/target", { exclusive: true }), rejected("EEXIST"));
  assert.deepEqual(mock.files, before);
  assert.ok(mock.requests.slice(count).every(request => request.init.method === "PROPFIND"));
});

test("comparison checks cancellation between ID queries and does not issue the peer request", async () => {
  const mock = seed(), controller = new AbortController();
  let identities = 0;
  const reason = new FsError("ENOENT", { message: "caller abort" });
  const fs = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
    const result = await mock.fetch(url, init);
    if (identityRequest(init)) { identities++; controller.abort(reason); }
    return result;
  } });
  await assert.rejects(fs.compareEntry("/source", fs, "/target", { signal: controller.signal }), error => error === reason);
  assert.equal(identities, 1);
  const count = mock.requests.length;
  await assert.rejects(fs.compareEntry("/source", fs, "/target", { signal: controller.signal }), error => error === reason);
  assert.equal(mock.requests.length, count);
});

test("resource-id XML budget and missing-path errors remain typed", async () => {
  const mock = seed();
  const fs = new WebDavFileSystem({ baseUrl, fetch: (url, init) => identityRequest(init)
    ? Promise.resolve(xmlResponse(multistatus(response(propstat(property("urn:example:" + "x".repeat(5000))))))) : mock.fetch(url, init), maxXmlBytes: 2048 });
  await assert.rejects(fs.compareEntry("/source", fs, "/target"), rejected("EFBIG"));
  await assert.rejects(fs.compareEntry("/absent", fs, "/source"), rejected("ENOENT"));
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
});

test("case-binding aliases with the same protocol resource-id reject before COPY despite distinct hrefs", async () => {
  const mock = seed();
  const before = structuredClone(mock.files);
  const fs = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
    const requested = new URL(url);
    const alias = requested.pathname === "/dav/SOURCE";
    if (alias) requested.pathname = "/dav/source";
    const result = await mock.fetch(requested.href, init);
    if (!alias || init.method !== "PROPFIND") return result;
    return new Response((await result.text()).replaceAll("/dav/source", "/dav/SOURCE"), { status: result.status, headers: result.headers });
  } });
  assert.equal(await fs.compareEntry("/source", fs, "/SOURCE"), "same");
  const mount = createMountFileSystem({ root: fs });
  await assert.rejects(mount.copyFile("/source", "/SOURCE"), rejected("EINVAL"));
  assert.deepEqual(mock.files, before);
  assert.ok(mock.requests.every(request => request.init.method === "PROPFIND"));
});

test("comparison never weakens missing-target exclusive COPY against a concurrent winner", async () => {
  const mock = seed();
  mock.files.delete("/target");
  let raced = false;
  const fs = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
    if (init.method === "COPY") {
      assert.equal(new Headers(init.headers).get("Overwrite"), "F");
      raced = true;
      mock.files.set("/target", old.slice());
    }
    return mock.fetch(url, init);
  } });
  await assert.rejects(createMountFileSystem({ root: fs }).copyFile("/source", "/target"), rejected("EEXIST"));
  assert.equal(raced, true);
  assert.deepEqual(mock.files.get("/source"), bytes);
  assert.deepEqual(mock.files.get("/target"), old);
});
