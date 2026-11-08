import assert from "node:assert/strict";
import { test } from "node:test";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "./mock.js";

const baseUrl = "https://example.test/dav/";

test("appendFile and a create and append binary slices; ax exclusively creates", async () => {
  const mock = new MockDav();
  const fs = new WebDavFileSystem({ baseUrl, fetch: mock.fetch });
  await fs.appendFile("/file", new Uint8Array([0, 255]));
  await fs.writeFile("/file", new Uint8Array([9, 128, 13, 9]).subarray(1, 3), { flag: "a" });
  await fs.appendFile("/file", new Uint8Array());
  assert.deepEqual(await fs.readFile("/file"), new Uint8Array([0, 255, 128, 13]));
  await fs.writeFile("/exclusive", new Uint8Array([7]), { flag: "ax" });
  await assert.rejects(fs.writeFile("/exclusive", new Uint8Array([8]), { flag: "ax" }), { code: "EEXIST" });
  assert.deepEqual(await fs.readFile("/exclusive"), new Uint8Array([7]));
  await fs.mkdir("/directory");
  await assert.rejects(fs.appendFile("/directory", new Uint8Array()), { code: "EISDIR" });
  await assert.rejects(fs.appendFile("/file/child", new Uint8Array()), { code: "ENOTDIR" });
  await assert.rejects(fs.appendFile("/file/", new Uint8Array()), { code: "ENOTDIR" });
});

for (const race of ["create", "update", "delete", "directory"] as const) {
  test(`append protects against ${race} between read and PUT`, async () => {
    const mock = new MockDav();
    if (race !== "create") mock.files.set("/file", new Uint8Array([1]));
    const fs = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
      if (init.method === "PUT") {
        if (race === "delete") mock.files.delete("/file");
        else mock.files.set("/file", race === "directory" ? null : new Uint8Array([9]));
      }
      return mock.fetch(url, init);
    } });
    await assert.rejects(fs.appendFile("/file", new Uint8Array([2])), { code: race === "create" ? "EEXIST" : "EAGAIN" });
    assert.deepEqual(mock.files.get("/file"), race === "delete" ? undefined : race === "directory" ? null : new Uint8Array([9]));
  });
}

for (const etag of [null, 'W/"weak"', '"bad tag"', '"one", "two"']) {
  test(`append refuses unavailable or non-strong validator ${etag}`, async () => {
    const mock = new MockDav();
    mock.files.set("/file", new Uint8Array([1]));
    const fs = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
      if (init.method === "GET") return new Response(new Uint8Array([1]), { headers: etag === null ? {} : { ETag: etag } });
      return mock.fetch(url, init);
    } });
    await assert.rejects(fs.appendFile("/file", new Uint8Array([2])), { code: "ENOTSUP" });
    assert.equal(mock.requests.some((request) => request.init.method === "PUT"), false);
  });
}

test("append bounds combined bytes and honors cancellation", async () => {
  const mock = new MockDav();
  mock.files.set("/file", new Uint8Array([1, 2]));
  const fs = new WebDavFileSystem({ baseUrl, fetch: mock.fetch, maxResponseBytes: 2 });
  await assert.rejects(fs.appendFile("/file", new Uint8Array([3])), { code: "EFBIG" });
  await assert.rejects(fs.appendFile("/file", new Uint8Array(), { signal: AbortSignal.abort() }), { code: "ECANCELED" });
  assert.equal(mock.requests.some((request) => request.init.method === "PUT"), false);
});
