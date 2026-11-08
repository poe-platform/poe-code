import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { FileSystem } from "../../../src/contracts/filesystem.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import type { WebDavFetch } from "../../../src/fs/webdav/index.js";
import { MockDav, multistatus, resource, xmlResponse } from "./mock.js";

function fixture() {
  const mock = new MockDav();
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
  return { mock, fs };
}

function withXml(xml: string, options: { maxXmlBytes?: number; maxEntries?: number } = {}) {
  return new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async () => xmlResponse(xml), ...options });
}

test("implements foundation FileSystem contract and constructor performs no request", () => {
  const { fs, mock } = fixture();
  const contract: FileSystem = fs;
  assert.equal(contract.capabilities.permissions, false);
  assert.equal(contract.capabilities.atomicRename, false);
  assert.equal(mock.requests.length, 0);
  assert.throws(() => new WebDavFileSystem({ baseUrl: "https://example.test", fetch: undefined as unknown as WebDavFetch }), { code: "EINVAL" });
});

test("GET and PUT preserve empty and binary files, slices, and encoded names", async () => {
  const { fs, mock } = fixture();
  const data = new Uint8Array([99, 0, 255, 128, 13, 10, 7]).subarray(1, 6);
  const path = '/a &<>"雪#?%2e%2e';
  await fs.writeFile(path, data);
  assert.deepEqual(await fs.readFile(path), data);
  await fs.writeFile("/empty", new Uint8Array(), { flag: "wx" });
  assert.deepEqual(await fs.readFile("/empty", { maxBytes: 0 }), new Uint8Array());
  assert.equal(mock.requests.find((request) => request.init.method === "PUT")!.url, `https://example.test/dav/${encodeURIComponent(path.slice(1))}`);
  assert.deepEqual(await fs.readdir("/"), [{ name: path.slice(1), type: "file" }, { name: "empty", type: "file" }]);
});

test("stat, lstat, realpath and existence access map metadata explicitly", async () => {
  const { fs } = fixture();
  await fs.writeFile("hello", new Uint8Array([1, 2]));
  const stat = await fs.stat("/hello");
  assert.equal(stat.type, "file");
  assert.equal(stat.size, 2);
  assert.equal(stat.mode, 0o100666);
  assert.equal(stat.atimeMs, 0);
  assert.equal(stat.ctimeMs, 0);
  assert.equal(stat.mtimeMs, Date.parse("2026-08-26T12:00:00Z"));
  assert.equal(stat.birthtimeMs, Date.parse("2026-08-01T00:00:00Z"));
  assert.deepEqual(await fs.lstat("hello"), stat);
  assert.equal(await fs.realpath("/one/../hello"), "/hello");
  await fs.access("/hello");
  await assert.rejects(fs.access("/missing"), { code: "ENOENT" });
  await assert.rejects(fs.readdir("/hello"), { code: "ENOTDIR" });
  await assert.rejects(fs.readFile("/"), { code: "EISDIR" });
  await assert.rejects(fs.writeFile("/", new Uint8Array()), { code: "EISDIR" });
});

test("recursive MKCOL, MOVE directory, COPY file, and recursive DELETE use DAV methods", async () => {
  const { fs, mock } = fixture();
  await fs.mkdir("/a/b", { recursive: true });
  await fs.mkdir("/a/b", { recursive: true });
  await fs.writeFile("/a/b/file", new Uint8Array([9]));
  await fs.copyFile("/a/b/file", "/copied", { exclusive: true });
  await fs.rename("/a", "/moved");
  assert.deepEqual(await fs.readFile("/moved/b/file"), new Uint8Array([9]));
  await fs.rm("/moved", { recursive: true });
  await fs.rm("/absent", { force: true });
  assert.deepEqual(await fs.readdir("/"), [{ name: "copied", type: "file" }]);
  const copy = mock.requests.find((request) => request.init.method === "COPY")!;
  assert.equal(copy.headers.get("Depth"), "0");
  assert.equal(copy.headers.get("Overwrite"), "F");
  assert.equal(copy.headers.get("Destination"), "https://example.test/dav/copied");
  const move = mock.requests.find((request) => request.init.method === "MOVE")!;
  assert.equal(move.headers.get("Depth"), "infinity");
  assert.equal(move.headers.get("Destination"), "https://example.test/dav/moved/");
  assert.equal(mock.requests.filter((request) => request.init.method === "MKCOL").length, 2);
});

test("safe writes, guarded destination overwrites, exclusive copies, directory mismatches, root protection", async () => {
  const { fs, mock } = fixture();
  await fs.writeFile("/a", new Uint8Array([1]));
  await fs.writeFile("/b", new Uint8Array([2]));
  await assert.rejects(fs.writeFile("/a", new Uint8Array(), { flag: "wx" }), { code: "EEXIST" });
  await assert.rejects(fs.copyFile("/a", "/b", { exclusive: true }), { code: "EEXIST" });
  await fs.copyFile("/a", "/b");
  assert.deepEqual(await fs.readFile("/b"), new Uint8Array([1]));
  await fs.rename("/a", "/b");
  await assert.rejects(fs.stat("/a"), { code: "ENOENT" });
  assert.equal(mock.requests.filter((request) => ["COPY", "MOVE"].includes(request.init.method!)).every((request) => request.headers.has("If")), true);
  await fs.writeFile("/b", new Uint8Array([1]));
  assert.deepEqual(await fs.readFile("/b"), new Uint8Array([1]));
  await fs.rename("/b", "/b");
  await assert.rejects(fs.copyFile("/b", "/b"), { code: "EINVAL" });
  await fs.mkdir("/dir");
  await assert.rejects(fs.copyFile("/dir", "/copy"), { code: "EISDIR" });
  await assert.rejects(fs.rename("/dir", "/dir/child"), { code: "EINVAL" });
  await assert.rejects(fs.rename("/dir", "/b"), { code: "ENOTDIR" });
  await assert.rejects(fs.rename("/b", "/dir"), { code: "EISDIR" });
  await assert.rejects(fs.writeFile("/dir", new Uint8Array()), { code: "EISDIR" });
  await assert.rejects(fs.mkdir("/dir"), { code: "EEXIST" });
  await assert.rejects(fs.mkdir("/b/child", { recursive: true }), { code: "ENOTDIR" });
  await assert.rejects(fs.mkdir("/missing/child"), { code: "ENOENT" });
  await assert.rejects(fs.mkdir("/"), { code: "EEXIST" });
  await fs.mkdir("/", { recursive: true });
  await assert.rejects(fs.rm("/", { force: true, recursive: true }), { code: "EBUSY" });
  await assert.rejects(fs.rename("/", "/new"), { code: "EBUSY" });
  await assert.rejects(fs.rename("/b", "/"), { code: "EBUSY" });
});

test("unsupported semantics fail without network or lossy read-modify-write", async () => {
  const { fs, mock } = fixture();
  await Promise.all([
    fs.writeFile("/file", new Uint8Array(), { mode: 0o600 }),
    fs.mkdir("/dir", { mode: 0o700 }), fs.chmod("/file", 0o600),
    fs.truncate("/file"), fs.symlink("/file", "/link"), fs.link("/file", "/link"), fs.readlink("/link"),
    fs.access("/file", 2),
  ].map((promise) => assert.rejects(promise, { code: "ENOTSUP" })));
  assert.equal(mock.requests.length, 0);
  await fs.mkdir("/dir");
  await assert.rejects(fs.rm("/dir"), { code: "ENOTSUP" });
  assert.equal(mock.requests.some((request) => request.init.method === "DELETE"), false);
});

for (const baseUrl of ["file:///dav", "https://user:password@example.test/dav", "https://example.test/dav?query",
  "https://example.test/dav#fragment", "https://example.test/dav?", "https://example.test/dav#",
  "https://example.test/a/../dav", "https://example.test/a/%2e%2e/dav",
  "https://example.test/dav/%2fescape", "https://example.test/dav/%5cescape", "https://example.test/dav//nested",
  "https://example.test/dav/%zz", "https://example.test/dav\\nested"]) {
  test(`rejects unsafe base URL ${baseUrl}`, () => {
    assert.throws(() => new WebDavFileSystem({ baseUrl, fetch: async () => new Response() }), { code: "EINVAL" });
  });
}

test("explicit HTTPS credentials only; every request disables implicit credentials and redirects", async () => {
  const mock = new MockDav();
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav", fetch: mock.fetch, headers: { Authorization: "Bearer explicit", Cookie: "explicit=yes" } });
  await fs.stat("/");
  const request = mock.requests[0]!;
  assert.equal(request.headers.get("Authorization"), "Bearer explicit");
  assert.equal(request.headers.get("Cookie"), "explicit=yes");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.redirect, "manual");
  assert.equal(request.headers.get("Depth"), "0");
  assert.equal(request.headers.get("Cache-Control"), "no-cache");
  assert.throws(() => new WebDavFileSystem({ baseUrl: "http://localhost/dav", fetch: mock.fetch, headers: { Authorization: "Basic secret" } }), { code: "EINVAL" });
  for (const header of ["Destination", "Host", "Depth", "If-None-Match", "Content-Length", "Proxy-Authorization"]) {
    assert.throws(() => new WebDavFileSystem({ baseUrl: "https://example.test/dav", fetch: mock.fetch, headers: { [header]: "unsafe" } }), { code: "EINVAL" });
  }
  const plain = fixture();
  await plain.fs.stat("/");
  assert.equal(plain.mock.requests[0]!.headers.has("Authorization"), false);
  assert.equal(plain.mock.requests[0]!.headers.has("Cookie"), false);
});

for (const path of ["../outside", "/../../outside", "/a/../../outside", "/bad\0name", "/bad\\name", "/\ud800"]) {
  test(`rejects traversal or invalid caller path ${JSON.stringify(path)} before transport`, async () => {
    const { fs, mock } = fixture();
    await assert.rejects(fs.stat(path), (error: unknown) => error instanceof FsError && ["EINVAL", "EACCES"].includes(error.code));
    assert.equal(mock.requests.length, 0);
  });
}

for (const href of ["https://evil.test/dav/file", "https://example.test/other/file", "/dav-evil/file", "/dav/../file",
  "/dav/%2e%2e/file", "/dav/%2Foutside", "/dav/%5coutside", "/dav/%00name", "/dav/%zz",
  "/dav/file?query", "/dav/file#fragment", "/dav/file?", "/dav/file#", "//example.test/dav/file", "file", "/dav/sub/deep",
  "https://user:pass@example.test/dav/file", "/dav//file"]) {
  test(`rejects unconfined or ambiguous response href ${href}`, async () => {
    await assert.rejects(withXml(multistatus(resource("/dav/", true), resource(href))).readdir("/"), { code: "EACCES" });
  });
}

test("response namespaces, default namespace, entities and split successful/failed propstats", async () => {
  const xml = '<multistatus xmlns="DAV:" xmlns:evil="urn:evil"><evil:response><evil:href>/escape</evil:href></evil:response>'
    + '<response><href>/dav/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>'
    + '<response><href>/dav/a&amp;b%20&#x26;%20雪</href><propstat><prop><resourcetype/>'
    + '<getcontentlength>0</getcontentlength></prop><status>HTTP/1.1 &#50;00 OK</status></propstat>'
    + '<propstat><prop><getlastmodified/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response></multistatus>';
  assert.deepEqual(await withXml(xml).readdir("/"), [{ name: "a&b & 雪", type: "file" }]);
  const rootStat = await withXml(multistatus(resource("https://example.test/dav/", true))).stat("/");
  assert.equal(rootStat.type, "directory");
});

test("UTF-16 XML is decoded with BOM", async () => {
  const data = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(multistatus(resource("/dav/", true)).replace("utf-8", "utf-16"), "utf16le")]);
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async () => new Response(data, { status: 207 }) });
  assert.equal((await fs.stat("/")).type, "directory");
});

test("missing required metadata is unsupported, denied property fails, malformed status is rejected", async () => {
  const wrap = (body: string) => multistatus(`<z:response><z:href>/dav/file</z:href>${body}</z:response>`);
  await assert.rejects(withXml(wrap('<z:propstat><z:prop><z:resourcetype/></z:prop><z:status>HTTP/1.1 200 OK</z:status></z:propstat>')).stat("/file"), { code: "ENOTSUP" });
  await assert.rejects(withXml(wrap('<z:propstat><z:prop><z:resourcetype/></z:prop><z:status>HTTP/1.1 403 Forbidden</z:status></z:propstat>')).stat("/file"), { code: "EACCES" });
  await assert.rejects(withXml(wrap('<z:status>403</z:status>')).stat("/file"), { code: "EIO" });
  await assert.rejects(withXml(multistatus()).stat("/"), { code: "EIO" });
  await assert.rejects(withXml(multistatus(resource("/dav/", true), resource("/dav/", true))).readdir("/"), { code: "EIO" });
  await assert.rejects(withXml(multistatus(resource("/dav/", true), resource("/dav/file"))).stat("/"), { code: "EACCES" });
});

for (const [status, code] of [[401, "EACCES"], [403, "EACCES"], [404, "ENOENT"], [423, "EBUSY"], [429, "EAGAIN"],
  [500, "EIO"], [501, "ENOTSUP"], [507, "ENOSPC"], [301, "ENOTSUP"], [302, "ENOTSUP"], [307, "ENOTSUP"], [308, "ENOTSUP"], [206, "EIO"]] as const) {
  test(`HTTP ${status} maps to ${code}, without retries or redirects`, async () => {
    let requests = 0;
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async () => {
      requests++;
      return new Response(null, { status, headers: { Location: "https://evil.test/" } });
    } });
    await assert.rejects(fs.stat("/"), { code });
    assert.equal(requests, 1);
  });
}

test("transport-followed redirects and mismatched final URL are rejected", async () => {
  for (const override of [{ redirected: true }, { url: "https://evil.test/dav/" }, { url: "https://example.test/dav/other" }, { type: "opaqueredirect" }]) {
    const response = xmlResponse(multistatus(resource("/dav/", true)));
    for (const [key, value] of Object.entries(override)) Object.defineProperty(response, key, { value });
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async () => response });
    await assert.rejects(fs.stat("/"), (error: unknown) => error instanceof FsError && ["ENOTSUP", "EACCES"].includes(error.code));
  }
});

test("partial DELETE failure is never swallowed by force", async () => {
  const mock = new MockDav();
  mock.files.set("/dir", null);
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => init.method === "DELETE"
    ? xmlResponse(multistatus('<z:response><z:href>/dav/dir/child</z:href><z:status>HTTP/1.1 404 Not Found</z:status></z:response>'))
    : mock.fetch(url, init) });
  await assert.rejects(fs.rm("/dir", { recursive: true, force: true }), (error: unknown) => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "EIO");
    assert.ok(error.cause instanceof FsError);
    assert.equal(error.cause.code, "ENOENT");
    return true;
  });
});

test("standard depth-one listings are bounded, and pagination is never silently truncated", async () => {
  const xml = multistatus(resource("/dav/", true), ...Array.from({ length: 100 }, (_, index) => resource(`/dav/file${index}`)));
  assert.equal((await withXml(xml).readdir("/")).length, 100);
  await assert.rejects(withXml(xml, { maxEntries: 10 }).readdir("/"), { code: "EFBIG" });
  await assert.rejects(withXml(xml, { maxXmlBytes: 20 }).readdir("/"), { code: "EFBIG" });
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async () => xmlResponse(xml, { Link: '</dav/?page=2>; rel="next"' }) });
  await assert.rejects(fs.readdir("/"), { code: "ENOTSUP" });
  assert.deepEqual(await withXml(multistatus(resource("/dav/", true))).readdir("/"), []);
});

test("GET response bounds count actual streamed bytes and cancel on excess", async () => {
  const mock = new MockDav();
  mock.files.set("/file", new Uint8Array([1, 2, 3]));
  let cancelled = false;
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => init.method === "GET"
    ? new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); }, cancel() { cancelled = true; } }))
    : mock.fetch(url, init) });
  await assert.rejects(fs.readFile("/file", { maxBytes: 2 }), { code: "EFBIG" });
  assert.equal(cancelled, true);
  await assert.rejects(fs.readFile("/file", { maxBytes: -1 }), { code: "EINVAL" });
});

test("abort signals, body cancellation, timeouts and transport failures normalize errors", async () => {
  const { fs, mock } = fixture();
  await assert.rejects(fs.stat("/", { signal: AbortSignal.abort() }), { code: "ECANCELED" });
  assert.equal(mock.requests.length, 0);
  const rejected = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async () => { throw new Error("offline"); } });
  await assert.rejects(rejected.stat("/"), { code: "EIO" });
  const timeout = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", timeoutMs: 20,
    fetch: async (_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true })) });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(timeout.stat("/"), { code: "ETIMEDOUT" }); }
  finally { clearTimeout(keepAlive); }
  const controller = new AbortController();
  let canceled = false;
  const waiting = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async () => {
    setTimeout(() => controller.abort(), 10);
    return new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 207 });
  } });
  await assert.rejects(waiting.stat("/", { signal: controller.signal }), { code: "ECANCELED" });
  assert.equal(canceled, true);
});

test("real HTTP fetch exercises loopback PROPFIND/GET/PUT/MKCOL/MOVE/COPY/DELETE", async () => {
  const mock = new MockDav();
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const result = await mock.fetch(`http://${request.headers.host}${request.url}`, {
        method: request.method!, headers: request.headers as Record<string, string>,
        ...(body.length ? { body } : {}),
      });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      response.writeHead(500);
      response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const fs = new WebDavFileSystem({ baseUrl: `http://127.0.0.1:${address.port}/dav/`, fetch });
    await fs.mkdir("/test");
    await fs.writeFile("/test/data &雪", new Uint8Array([0, 255, 128, 1]));
    await fs.writeFile("/test/empty", new Uint8Array(), { flag: "wx" });
    assert.deepEqual(await fs.readFile("/test/data &雪"), new Uint8Array([0, 255, 128, 1]));
    assert.deepEqual(await fs.readFile("/test/empty"), new Uint8Array());
    await fs.copyFile("/test/data &雪", "/copy");
    await fs.rename("/copy", "/moved");
    await fs.rm("/test", { recursive: true });
    await fs.rm("/moved");
    assert.deepEqual(await fs.readdir("/"), []);
    assert.deepEqual(new Set(mock.requests.map((request) => request.init.method)), new Set(["PROPFIND", "MKCOL", "PUT", "GET", "COPY", "MOVE", "DELETE"]));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("real fetch never contacts a redirect target", async () => {
  const requested: string[] = [];
  const server = createServer((request, response) => {
    requested.push(request.url!);
    response.writeHead(307, { Location: "/outside-root" });
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const fs = new WebDavFileSystem({ baseUrl: `http://127.0.0.1:${address.port}/dav/`, fetch });
    await assert.rejects(fs.stat("/"), { code: "ENOTSUP" });
    assert.deepEqual(requested, ["/dav/"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("bounded stress cycle preserves hundreds of binary and escaped resources", async () => {
  const { fs } = fixture();
  await fs.mkdir("/stress/deep", { recursive: true });
  const names = Array.from({ length: 200 }, (_, index) => `file ${index} &雪%#?`);
  await Promise.all(names.map(async (name, index) => {
    const bytes = Uint8Array.from({ length: index % 37 }, (_, offset) => (index * 31 + offset) % 256);
    await fs.writeFile(`/stress/deep/${name}`, bytes, { flag: "wx" });
    await fs.copyFile(`/stress/deep/${name}`, `/stress/${name}`, { exclusive: true });
    await fs.rename(`/stress/${name}`, `/stress/moved-${name}`);
    assert.deepEqual(await fs.readFile(`/stress/moved-${name}`), bytes);
  }));
  assert.equal((await fs.readdir("/stress/deep")).length, 200);
  assert.equal((await fs.readdir("/stress")).length, 201);
  await fs.rm("/stress", { recursive: true });
  assert.deepEqual(await fs.readdir("/"), []);
});

test("exclusive COPY handles a destination created after preflight", async () => {
  const mock = new MockDav();
  mock.files.set("/file", new Uint8Array([1]));
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    if (init.method === "COPY") mock.files.set("/new", new Uint8Array([2]));
    return mock.fetch(url, init);
  } });
  await assert.rejects(fs.copyFile("/file", "/new", { exclusive: true }), { code: "EEXIST" });
  assert.deepEqual(mock.files.get("/new"), new Uint8Array([2]));
});

test("recursive mkdir tolerates a concurrently created collection", async () => {
  const mock = new MockDav();
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    if (init.method === "MKCOL") mock.files.set("/race", null);
    return mock.fetch(url, init);
  } });
  await fs.mkdir("/race", { recursive: true });
  assert.equal((await fs.stat("/race")).type, "directory");
});

test("malformed XML and DTD responses become filesystem EIO", async () => {
  for (const xml of ['<!DOCTYPE multistatus SYSTEM "http://evil.test/entity"><multistatus xmlns="DAV:"/>',
    '<z:multistatus xmlns:z="DAV:">', '<multistatus xmlns="urn:not-dav"/>']) {
    await assert.rejects(withXml(xml).stat("/"), { code: "EIO" });
  }
});
