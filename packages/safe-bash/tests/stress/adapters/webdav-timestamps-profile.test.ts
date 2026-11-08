import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { binary } from "../../fs/conformance/fixtures.js";
import { MockDav } from "../../fs/webdav/mock.js";
import { PropertyDav, withLoopbackDav } from "../../fs/webdav/property-fixture.js";

function rejected(code: ErrnoCode): (error: unknown) => boolean {
  return error => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, code);
    assert.equal(error.path, "/file");
    return true;
  };
}

test("webdav: capable timestamp provider persists exact values over real fetch without rewriting bytes", async () => {
  const mock = new PropertyDav();
  const statuses: number[] = [];
  await withLoopbackDav(async (url, init) => {
    const result = await mock.fetch(url, init);
    if (init.method === "PROPPATCH") statuses.push(result.status);
    return result;
  }, async baseUrl => {
    const fs = new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch });
    await fs.writeFile("/file", binary);
    const tag = mock.base.etag("/file");
    const before = mock.base.requests.length;
    await fs.utimes("/file", 1234.5, -6789);
    const mutations = mock.base.requests.slice(before).filter(request => request.init.method !== "PROPFIND");
    assert.deepEqual(mutations.map(request => request.init.method), ["PROPPATCH"]);
    assert.equal(mutations[0]!.headers.get("If-Match"), tag);
    assert.ok(!String(mutations[0]!.init.body).includes("getlastmodified"));
    assert.deepEqual(statuses, [207]);
    assert.deepEqual(JSON.parse(mock.properties.get("/file")!), {
      version: 1, type: "file", etag: tag, atimeMs: 1234.5, mtimeMs: -6789,
    });
    const fresh = new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch });
    assert.equal(fresh.capabilities.timestamps, true);
    const stat = await fresh.stat("/file");
    assert.equal(stat.atimeMs, 1234.5);
    assert.equal(stat.mtimeMs, -6789);
    assert.deepEqual(await fresh.readFile("/file"), binary);
    assert.deepEqual((await fresh.readdir("/")).map(entry => entry.name), ["file"]);
  });
});

test("webdav: original provider's PROPPATCH 501 remains typed ENOTSUP with no fallback effects", async () => {
  const mock = new MockDav();
  mock.files.set("/file", binary.slice());
  const statuses: number[] = [];
  await withLoopbackDav(async (url, init) => {
    const result = await mock.fetch(url, init);
    if (init.method === "PROPPATCH") statuses.push(result.status);
    return result;
  }, async baseUrl => {
    const fs = new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch });
    const before = await fs.stat("/file");
    const count = mock.requests.length;
    await assert.rejects(fs.utimes("/file", 1, 2), rejected("ENOTSUP"));
    assert.deepEqual(statuses, [501]);
    assert.deepEqual(mock.requests.slice(count).map(request => request.init.method), ["PROPFIND", "PROPPATCH"]);
    assert.deepEqual(await fs.stat("/file"), before);
    assert.deepEqual(await fs.readFile("/file"), binary);
    assert.deepEqual([...mock.files.keys()], ["/", "/file"]);
    assert.equal(fs.capabilities.timestamps, true);
  });
});

for (const [status, code] of [[403, "EACCES"], [423, "EBUSY"], [424, "EIO"], [507, "ENOSPC"]] as const) {
  test(`webdav: timestamp property status ${status} preserves bytes and prior property`, async () => {
    const mock = new PropertyDav();
    mock.base.files.set("/file", binary.slice());
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
    await fs.utimes("/file", 10, 20);
    const property = mock.properties.get("/file");
    const count = mock.base.requests.length;
    mock.propertyStatus = status;
    await assert.rejects(fs.utimes("/file", 30, 40), rejected(code));
    assert.deepEqual(mock.base.requests.slice(count).map(request => request.init.method), ["PROPFIND", "PROPPATCH"]);
    assert.equal(mock.properties.get("/file"), property);
    assert.deepEqual(mock.base.files.get("/file"), binary);
    const stat = await fs.stat("/file");
    assert.equal(stat.atimeMs, 10);
    assert.equal(stat.mtimeMs, 20);
  });
}

test("webdav: stale timestamp condition preserves competing bytes and prior property", async () => {
  const mock = new PropertyDav();
  mock.base.files.set("/file", binary.slice());
  const original = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
  await original.utimes("/file", 10, 20);
  const property = mock.properties.get("/file");
  const winner = new Uint8Array([0, 71, 255]);
  const statuses: number[] = [];
  const racing = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    if (init.method === "PROPPATCH") mock.base.files.set("/file", winner);
    const result = await mock.fetch(url, init);
    if (init.method === "PROPPATCH") statuses.push(result.status);
    return result;
  } });
  await assert.rejects(racing.utimes("/file", 30, 40), rejected("EAGAIN"));
  assert.deepEqual(statuses, [412]);
  assert.equal(mock.properties.get("/file"), property);
  assert.deepEqual(await original.readFile("/file"), winner);
  assert.equal((await original.stat("/file")).atimeMs, 0);
});

test("webdav: lost PROPPATCH acknowledgement reports EIO without pretending persisted effects rolled back", async () => {
  const mock = new PropertyDav();
  mock.base.files.set("/file", binary.slice());
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    const result = await mock.fetch(url, init);
    if (init.method === "PROPPATCH") {
      await result.body?.cancel();
      throw new Error("lost acknowledgement after property commit");
    }
    return result;
  } });
  await assert.rejects(fs.utimes("/file", 30, 40), rejected("EIO"));
  const fresh = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
  const stat = await fresh.stat("/file");
  assert.equal(stat.atimeMs, 30);
  assert.equal(stat.mtimeMs, 40);
  assert.deepEqual(await fresh.readFile("/file"), binary);
  assert.equal(mock.base.requests.filter(request => request.init.method === "PROPPATCH").length, 1);
});
