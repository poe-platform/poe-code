import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../../../src/contracts/errors.js";
import { createMemoryFileSystem } from "../../../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../../../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../../../../../src/fs/readonly/index.js";
import { MockS3Client, S3FileSystem, S3ServiceError, createS3Transport } from "../../../../../src/fs/s3/index.js";
import type { S3Transport } from "../../../../../src/fs/s3/transport.js";
import { WebDavFileSystem } from "../../../../../src/fs/webdav/index.js";
import type { WebDavFetch } from "../../../../../src/fs/webdav/index.js";
import { davChild, davChildren, parseXml, scalar } from "../../../../../src/fs/webdav/xml.js";
import { MockDav } from "../../../webdav/mock.js";
import { bytes, comparison, opaque, seeded, text } from "./support.js";

const observe = (name: string, data: unknown): void => console.log(`IMPLEMENTATION_OBSERVATION ${Buffer.from(JSON.stringify({ name, data })).toString("base64")}`);

async function s3Views() {
  const store = new MockS3Client({ buckets: ["bucket"] });
  const left = new S3FileSystem({ transport: createS3Transport(store, store.capabilities), bucket: "bucket", prefix: "root" });
  const right = new S3FileSystem({ transport: createS3Transport(store, store.capabilities), bucket: "bucket", prefix: "root/nested" });
  await left.mkdir("/nested");
  await left.writeFile("/nested/source", bytes("source"));
  await right.writeFile("/target", bytes("target"));
  return { store, left, right };
}

test("S3 actual shared store through different clients/prefixes: aliases and qualified copies", async () => {
  const { store, left, right } = await s3Views();
  const start = store.requests.length;
  assert.equal(await comparison(left, "/nested/source", right, "/source"), "same");
  assert.equal(await comparison(left, "/nested/source", right, "/target"), "distinct");
  assert.ok(store.requests.slice(start).every(request => ["headObject", "listObjectsV2"].includes(request.operation)));
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
  await mount.copyFile("/left/nested/source", "/right/target");
  await assert.rejects(mount.copyFile("/left/nested/source", "/right/source"), { code: "EINVAL" });
  assert.equal(await text(left, "/nested/source"), "source");
  assert.equal(await text(right, "/target"), "source");
});

test("independent private S3 stores are distinct without per-client invented identity tuples", async () => {
  const first = await s3Views();
  const second = await s3Views();
  assert.equal((await first.left.stat("/nested/source")).identityScope, undefined);
  assert.equal(await comparison(first.left, "/nested/source", second.left, "/nested/source"), "distinct");
});

for (const fault of ["source", "target", "cancel"] as const) {
  test(`qualified distinct S3 copy preserves source on ${fault} failure`, async () => {
    let armed = false;
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { message: "caller abort during remote copy" });
    const store = new MockS3Client({ buckets: ["bucket"], authorize: request => {
      if (!armed) return;
      if (fault === "source" && request.operation === "getObject") throw new S3ServiceError("AccessDenied", 403);
      if (fault === "target" && request.operation === "putObject") throw new S3ServiceError("AccessDenied", 403);
      if (fault === "cancel" && request.operation === "getObject") controller.abort(reason);
    } });
    const left = new S3FileSystem({ transport: createS3Transport(store, store.capabilities), bucket: "bucket" });
    const right = new S3FileSystem({ transport: createS3Transport(store, store.capabilities), bucket: "bucket" });
    await left.writeFile("/source", bytes("source"));
    await right.writeFile("/target", bytes("target"));
    assert.equal(await comparison(left, "/source", right, "/target"), "distinct");
    const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
    armed = true;
    const failure = await mount.copyFile("/left/source", "/right/target", { signal: controller.signal }).then(() => undefined, error => error);
    armed = false;
    assert.ok(failure);
    if (fault !== "cancel") assert.equal(failure.code, "EACCES");
    else assert.equal(controller.signal.reason, reason);
    assert.equal(await text(left, "/source"), "source");
    assert.equal(await text(right, "/target"), "target");
    assert.ok(!store.requests.some(request => request.operation === "deleteObject"));
  });
}

test("S3 honest local-data remapper strips unrelated HEAD authority before destructive copy", async () => {
  const memory = await seeded();
  const store = new MockS3Client({ buckets: ["bucket"] });
  await store.putObject({ Bucket: "bucket", Key: "source", Body: bytes("source sentinel") });
  const forwarding = createS3Transport(store, store.capabilities);
  const effects: string[] = [];
  const transport: S3Transport = {
    ...forwarding,
    capabilities: { ...store.capabilities, streamingRead: false, streamingWrite: false },
    headObject: async (input, options) => ({ ...await forwarding.headObject(input, options) }),
    getObject: async () => { effects.push("GET"); return { Body: await memory.readFile("/source") }; },
    putObject: async () => { effects.push("PUT"); await memory.writeFile("/source", bytes("damaged")); throw new S3ServiceError("InternalError", 500); },
  };
  const remote = new S3FileSystem({ transport, bucket: "bucket" });
  assert.equal(await comparison(remote, "/source", memory, "/source"), "unknown");
  assert.equal(await comparison(createReadOnlyFileSystem(memory), "/source", remote, "/source"), "unknown");
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/local": memory, "/remote": remote } });
  await assert.rejects(mount.copyFile("/local/source", "/remote/source"), { code: "ENOTSUP" });
  assert.deepEqual(effects, []);
  assert.equal(await text(memory, "/source"), "source sentinel");
});

test("S3 faithful subclass and late content decorator retain fresh backing authority", async () => {
  class ForwardingClient extends MockS3Client {
    override getObject(...args: Parameters<MockS3Client["getObject"]>) { return super.getObject(...args); }
  }
  const subclass = new ForwardingClient({ buckets: ["bucket"] });
  const other = new MockS3Client({ buckets: ["bucket"] });
  for (const client of [subclass, other]) await client.putObject({ Bucket: "bucket", Key: "file", Body: bytes("same") });
  const first = new S3FileSystem({ transport: subclass, bucket: "bucket" });
  const transport = createS3Transport(other, { ...other.capabilities, streamingRead: false, streamingWrite: false });
  const second = new S3FileSystem({ transport, bucket: "bucket" });
  assert.equal(await comparison(first, "/file", second, "/file"), "distinct");
  const canonical = new S3FileSystem({ transport: other, bucket: "bucket" });
  assert.equal(await comparison(canonical, "/file", second, "/file"), "same");
  let writes = 0;
  const put = transport.putObject;
  transport.putObject = (...args) => { writes++; return put(...args); };
  assert.equal(await comparison(canonical, "/file", second, "/file"), "same");
  await first.writeFile("/file", bytes("changed source"));
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/first": first, "/second": second, "/alias": canonical } });
  await mount.copyFile("/first/file", "/second/file");
  assert.equal(writes, 1);
  await assert.rejects(mount.copyFile("/alias/file", "/second/file"), { code: "EINVAL" });
  assert.equal(writes, 1);
  assert.equal(await text(first, "/file"), "changed source");
  assert.equal(await text(second, "/file"), "changed source");
});

test("S3 two honest clients omit unrelated mock authority for shared local data", async () => {
  const memory = await seeded();
  const effects: string[] = [];
  const make = async () => {
    const store = new MockS3Client({ buckets: ["bucket"] });
    await store.putObject({ Bucket: "bucket", Key: "source", Body: bytes("source sentinel") });
    const transport: S3Transport = {
      ...createS3Transport(store, store.capabilities),
      capabilities: { ...store.capabilities, streamingRead: false, streamingWrite: false },
      headObject: async (input, options) => ({ ...await store.headObject(input, options) }),
      getObject: async () => { effects.push("GET"); return { Body: await memory.readFile("/source") }; },
      putObject: async () => { effects.push("PUT"); await memory.writeFile("/source", bytes("partial S3 write hit source")); throw new S3ServiceError("InternalError", 500); },
    };
    return new S3FileSystem({ transport, bucket: "bucket" });
  };
  const first = await make();
  const second = await make();
  const result = await comparison(first, "/source", second, "/source");
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/first": first, "/second": second } });
  const failure = await mount.copyFile("/first/source", "/second/source").then(() => undefined, error => error);
  const source = await text(memory, "/source");
  observe("split-s3-copy", { result, code: failure?.code, effects, source });
  assert.deepEqual({ result, code: failure?.code, effects, source }, { result: "unknown", code: "ENOTSUP", effects: [], source: "source sentinel" });
});

for (const code of ["NoSuchKey", "AccessDenied", "InternalError"] as const) {
  test(`S3 metadata ${code} propagates through public comparison with no content operations`, async () => {
    let fail = false;
    const store = new MockS3Client({ buckets: ["bucket"], authorize: request => {
      if (fail && request.operation === "headObject") throw new S3ServiceError(code, code === "NoSuchKey" ? 404 : code === "AccessDenied" ? 403 : 500);
    } });
    const filesystem = new S3FileSystem({ transport: store, bucket: "bucket" });
    await filesystem.writeFile("/source", bytes("source"));
    fail = true;
    const start = store.requests.length;
    await assert.rejects(comparison(filesystem, "/source", filesystem, "/source"), { code: code === "NoSuchKey" ? "ENOENT" : code === "AccessDenied" ? "EACCES" : "EIO" });
    assert.ok(store.requests.slice(start).every(request => ["headObject", "listObjectsV2"].includes(request.operation)));
  });
}

async function davViews(transform?: (response: Response, url: string, init: RequestInit) => Promise<Response>) {
  const store = new MockDav();
  const fetch: WebDavFetch = async (url, init) => {
    const response = await store.fetch(url, init);
    return transform ? transform(response, url, init) : response;
  };
  const left = new WebDavFileSystem({ baseUrl: "https://first.example/dav/", fetch, overwritePolicy: "etag" });
  const right = new WebDavFileSystem({ baseUrl: "https://endpoint-alias.example/dav/", fetch: (url, init) => fetch(url, init), overwritePolicy: "etag" });
  await left.writeFile("/source", bytes("equal bytes"));
  await right.writeFile("/target", bytes("equal bytes"));
  return { store, left, right };
}

test("WebDAV actual provider metadata: endpoint aliases, equal ETags, and qualified nested-wrapper copies", async () => {
  const { store, left, right } = await davViews();
  assert.equal(store.etag("/source"), store.etag("/target"));
  const start = store.requests.length;
  assert.equal(await comparison(left, "/source", right, "/source"), "same");
  assert.equal(await comparison(left, "/source", right, "/target"), "distinct");
  assert.ok(store.requests.slice(start).every(request => request.init.method === "PROPFIND"));
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": createReadOnlyFileSystem(left), "/right": right } });
  await mount.copyFile("/left/source", "/right/target");
  await assert.rejects(mount.copyFile("/left/source", "/right/source"), { code: "EINVAL" });
  assert.equal(await text(right, "/target"), "equal bytes");
  await left.mkdir("/nested");
  await left.writeFile("/nested/source", bytes("nested source"));
  await left.writeFile("/nested/target", bytes("nested target"));
  const rooted = new WebDavFileSystem({ baseUrl: "https://third.example/dav/nested/", fetch: (url, init) => store.fetch(url, init), overwritePolicy: "etag" });
  assert.equal(await comparison(left, "/nested/source", rooted, "/source"), "same");
  assert.equal(await comparison(left, "/nested/source", rooted, "/target"), "distinct");
  const roots = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/outer": left, "/inner": rooted } });
  await roots.copyFile("/outer/nested/source", "/inner/target");
  assert.equal(await text(rooted, "/target"), "nested source");
});

test("WebDAV protocol identity survives Response cloning without private mock provenance", async () => {
  const { store, left, right } = await davViews(async response => response.clone());
  const start = store.requests.length;
  assert.equal(await comparison(left, "/source", right, "/source"), "same");
  assert.equal(await comparison(left, "/source", right, "/target"), "distinct");
  assert.ok(store.requests.slice(start).every(request => request.init.method === "PROPFIND"));
  assert.equal(store.requests.slice(start).filter(request => String(request.init.body).includes("resource-id")).length, 4);
});

test("WebDAV mock identity is stable through PUT/MOVE/COPY overwrite, fresh for COPY creation and recreation", async () => {
  const { store, left, right } = await davViews();
  const identifier = async (path: string): Promise<string> => {
    const response = await store.fetch(`https://first.example/dav${path}`, {
      method: "PROPFIND", headers: { Depth: "0" },
      body: '<d:propfind xmlns:d="DAV:"><d:prop><d:resource-id/></d:prop></d:propfind>',
    });
    assert.equal(response.status, 207);
    const document = parseXml(await response.text());
    const entry = davChildren(document, "response")[0]!;
    for (const propstat of davChildren(entry, "propstat")) {
      const prop = davChild(propstat, "prop");
      const resource = prop && davChild(prop, "resource-id");
      if (resource) return scalar(davChild(resource, "href")!);
    }
    assert.fail("NOT_IMPLEMENTED: actual MockDav resource-id property");
  };
  const original = await identifier("/source");
  const oldTarget = await identifier("/target");
  await left.writeFile("/source", bytes("updated source"));
  assert.equal(await identifier("/source"), original);
  await left.rename("/source", "/moved");
  assert.equal(await identifier("/moved"), original);
  await assert.rejects(comparison(left, "/source", right, "/moved"), { code: "ENOENT" });
  await left.copyFile("/moved", "/target");
  const copied = await identifier("/target");
  assert.notEqual(copied, original);
  assert.equal(copied, oldTarget);
  await left.copyFile("/moved", "/new-copy");
  assert.notEqual(await identifier("/new-copy"), original);
  assert.notEqual(await identifier("/new-copy"), oldTarget);
  await left.rm("/moved");
  await left.writeFile("/moved", bytes("updated source"));
  assert.notEqual(await identifier("/moved"), original);
  assert.equal(await comparison(left, "/moved", right, "/target"), "distinct");
  assert.equal(await text(right, "/target"), "updated source");
});

test("WebDAV cancellation after first protocol identity query prevents the peer query", async () => {
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "identity query cancellation" });
  let identityQueries = 0;
  const { store, left, right } = await davViews(async (response, _url, init) => {
    if (String(init.body).includes("resource-id")) {
      identityQueries++;
      controller.abort(reason);
    }
    return response.clone();
  });
  const start = store.requests.length;
  await assert.rejects(comparison(left, "/source", right, "/target", { signal: controller.signal }), error => error === reason);
  assert.equal(identityQueries, 1);
  assert.ok(store.requests.slice(start).every(request => request.init.method === "PROPFIND"));
});

const identityBody = (href: string, property: string, status = "HTTP/1.1 200 OK", extra = ""): string =>
  `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${href}</d:href><d:propstat><d:prop>${property}</d:prop><d:status>${status}</d:status></d:propstat>${extra}</d:response></d:multistatus>`;
const resourceId = '<d:resource-id><d:href>urn:uuid:c1ee285f-34b2-4e18-9174-411503813c4d</d:href></d:resource-id>';

for (const variant of ["missing", "foreign-namespace", "property-404", "duplicate-property", "duplicate-response", "wrong-response-href", "invalid-uri", "property-403", "resource-404"] as const) {
  test(`WebDAV identity multistatus ${variant} is not a distinctness shortcut`, async () => {
    const { store, left, right } = await davViews(async (response, url, init) => {
      if (!String(init.body).includes("resource-id")) return response.clone();
      const href = new URL(url).pathname;
      let body = identityBody(href, resourceId);
      if (variant === "missing") body = identityBody(href, "");
      if (variant === "foreign-namespace") body = identityBody(href, resourceId.replaceAll("d:resource-id", "x:resource-id").replace("<x:resource-id>", '<x:resource-id xmlns:x="urn:not-dav">'));
      if (variant === "property-404") body = identityBody(href, resourceId, "HTTP/1.1 404 Not Found");
      if (variant === "duplicate-property") body = identityBody(href, resourceId + resourceId);
      if (variant === "duplicate-response") body = body.replace("</d:multistatus>", `${body.slice(body.indexOf("<d:response>"), body.indexOf("</d:multistatus>"))}</d:multistatus>`);
      if (variant === "wrong-response-href") body = identityBody("/dav/not-the-requested-file", resourceId);
      if (variant === "invalid-uri") body = identityBody(href, resourceId.replace("urn:uuid:c1ee285f-34b2-4e18-9174-411503813c4d", "not-an-absolute-uri"));
      if (variant === "property-403") body = identityBody(href, resourceId, "HTTP/1.1 403 Forbidden");
      if (variant === "resource-404") return new Response(null, { status: 404 });
      return new Response(body, { status: 207, headers: { "Content-Type": "application/xml" } });
    });
    const start = store.requests.length;
    if (["missing", "foreign-namespace", "property-404"].includes(variant)) assert.equal(await comparison(left, "/source", right, "/target"), "unknown");
    else await assert.rejects(comparison(left, "/source", right, "/target"), { code: variant === "resource-404" ? "ENOENT" : ["wrong-response-href", "property-403"].includes(variant) ? "EACCES" : "EIO" });
    assert.ok(store.requests.slice(start).every(request => request.init.method === "PROPFIND"));
    assert.equal(await text(left, "/source"), "equal bytes");
  });
}

async function splitDavTransport() {
  const memory = await seeded();
  const metadataProvider = new MockDav();
  const seed = new WebDavFileSystem({ baseUrl: "https://metadata.example/dav/", fetch: metadataProvider.fetch });
  await seed.writeFile("/source", bytes("source sentinel"));
  const effects: string[] = [];
  const fetch: WebDavFetch = async (url, init) => {
    if (init.method === "GET") { effects.push("GET"); return new Response(await memory.readFile("/source")); }
    if (init.method === "PUT") {
      effects.push("PUT");
      await memory.writeFile("/source", bytes("partial remote write hit local source"));
      return new Response(null, { status: 500 });
    }
    const response = await metadataProvider.fetch(url, init);
    if (init.method !== "PROPFIND" || response.status !== 207) return response;
    const xml = (await response.text()).replace(/<z:resource-id>.*?<\/z:resource-id>/gs, "");
    return new Response(xml, { status: response.status, headers: response.headers });
  };
  const remote = new WebDavFileSystem({ baseUrl: "https://split.example/dav/", fetch, overwritePolicy: "etag" });
  return { memory, remote, effects };
}

test("WebDAV honest local-data fetch omits unrelated private and protocol identity", async () => {
  const { memory, remote, effects } = await splitDavTransport();
  const result = await comparison(remote, "/source", memory, "/source");
  observe("split-dav-comparison", { result, effects });
  assert.equal(result, "unknown");
  assert.deepEqual(effects, []);
});

test("WebDAV honest remapper cannot authorize truncating an unproven aliased local source", async () => {
  const { memory, remote, effects } = await splitDavTransport();
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/local": memory, "/remote": remote } });
  const failure = await mount.copyFile("/local/source", "/remote/source").then(() => undefined, error => error);
  const source = await text(memory, "/source");
  observe("split-dav-copy", { code: failure?.code, effects, source });
  assert.deepEqual({ code: failure?.code, effects, source }, { code: "ENOTSUP", effects: [], source: "source sentinel" });
});

test("WebDAV data-method remapper strips inherited authority at its public filesystem view", async () => {
  const memory = await seeded();
  const effects: string[] = [];
  class DataView extends WebDavFileSystem {
    override stat(...args: Parameters<WebDavFileSystem["stat"]>) { return memory.stat(...args); }
    override lstat(...args: Parameters<WebDavFileSystem["lstat"]>) { return memory.lstat(...args); }
    override realpath(...args: Parameters<WebDavFileSystem["realpath"]>) { return memory.realpath(...args); }
    override readdir(...args: Parameters<WebDavFileSystem["readdir"]>) { return memory.readdir(...args); }
    override readFile(...args: Parameters<WebDavFileSystem["readFile"]>) { effects.push("readFile"); return memory.readFile(...args); }
    override async *readStream(...args: Parameters<WebDavFileSystem["readStream"]>) { effects.push("readStream"); yield* memory.readStream!(...args); }
    override writeFile(...args: Parameters<WebDavFileSystem["writeFile"]>) { effects.push("writeFile"); return memory.writeFile(...args); }
    override writeStream(...args: Parameters<WebDavFileSystem["writeStream"]>) { effects.push("writeStream"); return memory.writeStream!(...args); }
  }
  const make = async () => {
    const store = new MockDav();
    const seed = new WebDavFileSystem({ baseUrl: "https://provider.example/dav/", fetch: store.fetch });
    await seed.writeFile("/source", bytes("source sentinel"));
    return opaque(new DataView({ baseUrl: "https://provider.example/dav/", fetch: store.fetch }));
  };
  const first = await make();
  const second = await make();
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/first": first, "/second": second } });
  const result = await comparison(mount, "/first/source", mount, "/second/source");
  const failure = await mount.copyFile("/first/source", "/second/source").then(() => undefined, error => error);
  const source = await text(memory, "/source");
  observe("subclass-dav-copy", { result, code: failure?.code, effects, source });
  assert.deepEqual({ result, code: failure?.code, effects, source }, { result: "unknown", code: "ENOTSUP", effects: [], source: "source sentinel" });
});
