import assert from "node:assert/strict";
import { test } from "node:test";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { binary, deferred, errno, loopbackDav } from "../../fs/conformance/fixtures.js";
import { MockDav, multistatus, resource, xmlResponse } from "../../fs/webdav/mock.js";

test("webdav: 1103 direct children return complete depth-one listing over loopback HTTP", async (context) => {
  const { fs, mock } = await loopbackDav(context);
  const names = Array.from({ length: 1103 }, (_, index) => `file-${String(index).padStart(4, "0")}`);
  for (const name of names) mock.files.set(`/${name}`, binary.slice(0, 3));
  mock.files.set("/nested", null);
  mock.files.set("/nested/invisible", binary);
  const entries = await fs.readdir("/");
  assert.deepEqual(entries.map((entry) => entry.name).sort(), [...names, "nested"].sort());
  assert.equal(entries.filter((entry) => entry.type === "directory").length, 1);
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0]?.headers.get("Depth"), "1");
});

test("webdav: maxEntries rejects rather than truncates a valid multistatus", async (context) => {
  const { fs, mock } = await loopbackDav(context, { maxEntries: 3 });
  for (let index = 0; index < 3; index++) mock.files.set(`/file-${index}`, binary);
  await assert.rejects(fs.readdir("/"), errno("EFBIG"));
});

test("webdav: 256 children with redundant DAV namespace declarations list completely", async (context) => {
  const { fs, fixture } = await loopbackDav(context);
  const names = Array.from({ length: 256 }, (_, index) => `f${index}`).sort();
  const member = (href: string, directory: boolean) => `<d:response xmlns:d="DAV:"><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${directory ? "<d:collection/>" : ""}</d:resourcetype><d:getcontentlength>0</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  const xml = `<d:multistatus xmlns:d="DAV:">${member("/dav/", true)}${names.map((name) => member(`/dav/${name}`, false)).join("")}</d:multistatus>`;
  assert.equal(Buffer.byteLength(xml), 56230);
  context.diagnostic(`REDUNDANT NAMESPACE FIXTURE: ${Buffer.byteLength(xml)} bytes, 256 children`);
  fixture.intercept = async () => xmlResponse(xml);
  assert.deepEqual(await fs.readdir("/"), names.map((name) => ({ name, type: "file" })));
});

test("webdav: advertised pagination fails closed as an explicit capability gap", async (context) => {
  const { fs, fixture } = await loopbackDav(context);
  fixture.intercept = async () => xmlResponse(multistatus(resource("/dav/", true)), { Link: '</dav/?page=2>; rel="next"' });
  await assert.rejects(fs.readdir("/"), errno("ENOTSUP"));
  context.diagnostic("CAPABILITY GAP: vendor WebDAV pagination unsupported; rel=next fails ENOTSUP");
});

for (const href of ["/outside/file", "http://127.0.0.2/dav/file", "/dav/%2e%2e/file", "/dav/a%2fb", "/dav/file?query=1", "/dav/deep/child"]) {
  test(`webdav: untrusted response href ${href} cannot escape requested root/depth`, async (context) => {
    const { fs, fixture, mock } = await loopbackDav(context);
    let requests = 0;
    fixture.intercept = async () => {
      requests++;
      return xmlResponse(multistatus(resource("/dav/", true), resource(href, false, 3)));
    };
    await assert.rejects(fs.readdir("/"), errno("EACCES", "EIO"));
    assert.equal(requests, 1);
    assert.equal(mock.requests.length, 0);
  });
}

test("webdav: duplicate response members reject instead of silently deduplicating", async (context) => {
  const { fs, fixture } = await loopbackDav(context);
  fixture.intercept = async () => xmlResponse(multistatus(resource("/dav/", true), resource("/dav/file", false, 1), resource("/dav/file", false, 1)));
  await assert.rejects(fs.readdir("/"), errno("EIO"));
});

for (const xml of [
  '<?xml version="1.0"?><!DOCTYPE d:multistatus [<!ENTITY secret SYSTEM "file:///unread">]><d:multistatus xmlns:d="DAV:">&secret;</d:multistatus>',
  '<d:multistatus xmlns:d="DAV:"><d:response></d:multistatus>',
]) {
  test(`webdav: malformed XML rejects ${xml.includes("DOCTYPE") ? "external entity declarations" : "mismatched nesting"}`, async (context) => {
    const { fs, fixture } = await loopbackDav(context);
    fixture.intercept = async () => xmlResponse(xml);
    await assert.rejects(fs.readdir("/"), errno("EIO"));
  });
}

test("webdav: actual HTTP body overflow is bounded without Content-Length", async (context) => {
  const { fs, fixture, mock } = await loopbackDav(context);
  mock.files.set("/file", binary);
  fixture.intercept = async (url, init) => init.method === "GET"
    ? new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(binary); controller.close(); } }))
    : mock.fetch(url, init);
  await assert.rejects(fs.readFile("/file", { maxBytes: 32 }), errno("EFBIG"));
  assert.deepEqual(mock.files.get("/file"), binary);
});

test("webdav: injected identity response with Content-Length 5 and two bytes rejects EIO", async () => {
  const mock = new MockDav();
  mock.files.set("/file", new Uint8Array([0, 255]));
  let reads = 0;
  const fs = new WebDavFileSystem({ baseUrl: "http://127.0.0.1/dav/", fetch: async (url, init) => {
    if (init.method !== "GET") return mock.fetch(url, init);
    reads++;
    return new Response(new Uint8Array([0, 255]), { headers: { "Content-Length": "5", "Content-Encoding": "identity" } });
  } });
  await assert.rejects(fs.readFile("/file"), errno("EIO"));
  assert.equal(reads, 1);
  assert.deepEqual(mock.files.get("/file"), new Uint8Array([0, 255]));
});

test("webdav: caller cancellation during pending response headers stops mutation", { timeout: 3000 }, async (context) => {
  const { fs, fixture, mock } = await loopbackDav(context);
  const entered = deferred<void>();
  const release = deferred<void>();
  context.signal.addEventListener("abort", () => release.resolve(), { once: true });
  fixture.intercept = async (url, init) => {
    if (init.method === "PROPFIND") { entered.resolve(); await release.promise; }
    return mock.fetch(url, init);
  };
  const controller = new AbortController();
  const rejected = assert.rejects(fs.writeFile("/new", binary, { signal: controller.signal }), errno("ECANCELED"));
  try {
    await entered.promise;
    controller.abort(new Error("abort before preflight response"));
    await rejected;
  } finally { release.resolve(); }
  assert.equal(mock.files.has("/new"), false);
  assert.equal(mock.requests.filter((request) => request.init.method === "PUT").length, 0);
});

test("webdav: caller cancellation interrupts an actual stalled HTTP response body", { timeout: 3000 }, async (context) => {
  const { fixture, mock, baseUrl } = await loopbackDav(context);
  mock.files.set("/file", binary);
  const entered = deferred<void>();
  const release = deferred<void>();
  context.signal.addEventListener("abort", () => release.resolve(), { once: true });
  const fs = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
    const response = await fetch(url, init);
    if (init.method !== "GET") return response;
    assert.ok(response.body);
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) { controller.enqueue(chunk); entered.resolve(); },
    }));
    return new Response(body, { status: response.status, headers: response.headers });
  } });
  fixture.intercept = async (url, init) => {
    if (init.method !== "GET") return mock.fetch(url, init);
    return new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(binary.slice(0, 1));
        await release.promise;
        controller.close();
      },
    }));
  };
  const controller = new AbortController();
  const rejected = assert.rejects(fs.readFile("/file", { signal: controller.signal }), errno("ECANCELED"));
  try {
    await entered.promise;
    controller.abort();
    await rejected;
  } finally { release.resolve(); }
  assert.deepEqual(mock.files.get("/file"), binary);
});

test("webdav: request deadline interrupts pending loopback response headers", { timeout: 3000 }, async (context) => {
  const { fs, fixture } = await loopbackDav(context, { timeoutMs: 25 });
  const release = deferred<void>();
  context.signal.addEventListener("abort", () => release.resolve(), { once: true });
  fixture.intercept = async () => {
    await release.promise;
    return xmlResponse(multistatus(resource("/dav/", true)));
  };
  try { await assert.rejects(fs.stat("/"), errno("ETIMEDOUT")); }
  finally { release.resolve(); }
});

test("webdav: append without a strong response validator fails closed before PUT", async (context) => {
  const { fs, mock, fixture } = await loopbackDav(context);
  await fs.writeFile("/file", binary);
  fixture.intercept = async (url, init) => {
    const response = await mock.fetch(url, init);
    if (init.method === "GET") response.headers.delete("ETag");
    return response;
  };
  const puts = () => mock.requests.filter((request) => request.init.method === "PUT").length;
  const before = puts();
  await assert.rejects(fs.appendFile("/file", new Uint8Array([1])), errno("ENOTSUP"));
  assert.equal(puts(), before);
  assert.deepEqual(await fs.readFile("/file"), binary);
});

for (const operation of ["rename", "copyFile"] as const) {
  test(`webdav: ${operation} replacement without server locking fails closed`, async (context) => {
    const { fs, mock, fixture } = await loopbackDav(context);
    const destination = new Uint8Array([255, 0, 7]);
    await fs.writeFile("/source", binary);
    await fs.writeFile("/dest", destination);
    let locks = 0;
    fixture.intercept = async (url, init) => {
      if (init.method === "LOCK") { locks++; return new Response(null, { status: 501 }); }
      return mock.fetch(url, init);
    };
    await assert.rejects(fs[operation]("/source", "/dest"), errno("ENOTSUP"));
    assert.equal(locks, 1);
    assert.equal(mock.requests.filter((request) => request.init.method === "MOVE" || request.init.method === "COPY").length, 0);
    assert.deepEqual(await fs.readFile("/source"), binary);
    assert.deepEqual(await fs.readFile("/dest"), destination);
  });
}

test("webdav: optional truncate and nonrecursive directory removal fail without mutation", async (context) => {
  const { fs, mock } = await loopbackDav(context);
  await fs.writeFile("/file", binary);
  await fs.mkdir("/dir");
  const mutations = () => mock.requests.filter((request) => ["PUT", "DELETE", "MOVE", "COPY", "MKCOL"].includes(request.init.method ?? "")).length;
  const before = mutations();
  await assert.rejects(fs.rm("/dir"), errno("ENOTSUP"));
  await assert.rejects(fs.truncate("/file", 0), errno("ENOTSUP"));
  assert.equal(mutations(), before);
  assert.deepEqual(await fs.readFile("/file"), binary);
  assert.equal((await fs.stat("/dir")).type, "directory");
  context.diagnostic("CAPABILITY GAP: optional truncate unsupported; nonrecursive directory rm policy rejects ENOTSUP");
});
