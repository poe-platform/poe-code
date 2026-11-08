import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "./mock.js";

for (const encoding of [undefined, "identity"]) {
  for (const length of ["5", "1", "0", "invalid", "-1"]) {
    test(`identity GET rejects mismatched or malformed length ${length}, encoding ${encoding}`, async () => {
      const mock = new MockDav();
      mock.files.set("/file", new Uint8Array([65, 66]));
      const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
        if (init.method === "GET") return new Response(new Uint8Array([65, 66]), {
          headers: { "Content-Length": length, ...(encoding ? { "Content-Encoding": encoding } : {}) },
        });
        return mock.fetch(url, init);
      } });
      await assert.rejects(fs.readFile("/file"), { code: "EIO" });
    });
  }
}

test("null response bodies must agree with a declared identity length", async () => {
  const mock = new MockDav();
  mock.files.set("/file", new Uint8Array());
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => init.method === "GET"
    ? new Response(null, { headers: { "Content-Length": "2" } }) : mock.fetch(url, init) });
  await assert.rejects(fs.readFile("/file"), { code: "EIO" });
});

test("append never writes a truncated identity representation", async () => {
  const mock = new MockDav();
  mock.files.set("/file", new Uint8Array([1, 2, 3]));
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => init.method === "GET"
    ? new Response(new Uint8Array([1]), { headers: { "Content-Length": "3", ETag: mock.etag("/file")! } }) : mock.fetch(url, init) });
  await assert.rejects(fs.appendFile("/file", new Uint8Array([4])), { code: "EIO" });
  assert.equal(mock.requests.some((request) => request.init.method === "PUT"), false);
  assert.deepEqual(mock.files.get("/file"), new Uint8Array([1, 2, 3]));
});

test("matching identity length and omitted length preserve binary bytes", async () => {
  for (const length of [undefined, "2"]) {
    const mock = new MockDav();
    mock.files.set("/file", new Uint8Array([0, 255]));
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => init.method === "GET"
      ? new Response(new Uint8Array([0, 255]), { headers: length ? { "Content-Length": length } : {} }) : mock.fetch(url, init) });
    assert.deepEqual(await fs.readFile("/file"), new Uint8Array([0, 255]));
  }
});

test("native gzip reads compare decoded bounds, never encoded Content-Length", async (context) => {
  const mock = new MockDav();
  const plain = new Uint8Array([65, 66]);
  const compressed = gzipSync(plain);
  mock.files.set("/file", plain);
  let mode: "valid" | "missing-trailer" | "corrupt" = "valid";
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === "GET") {
        assert.equal(request.headers["accept-encoding"], "identity");
        const body = mode === "missing-trailer" ? compressed.subarray(0, compressed.length - 5) : new Uint8Array(compressed);
        if (mode === "corrupt") body[0] = 0;
        response.writeHead(200, { "Content-Encoding": "gzip", "Content-Length": body.length });
        response.end(body);
        return;
      }
      const result = await mock.fetch(`http://${request.headers.host}${request.url}`, { method: request.method!, headers: { Depth: "0" } });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    })().catch((error: unknown) => response.destroy(error instanceof Error ? error : new Error(String(error))));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => { const closed = once(server, "close"); server.close(); server.closeAllConnections(); await closed; });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const fs = new WebDavFileSystem({ baseUrl: `http://127.0.0.1:${address.port}/dav/`, fetch: globalThis.fetch, maxResponseBytes: 2 });
  assert.ok(compressed.length > plain.length);
  assert.deepEqual(await fs.readFile("/file"), plain);
  await assert.rejects(fs.readFile("/file", { maxBytes: 1 }), { code: "EFBIG" });
  mode = "missing-trailer";
  assert.deepEqual(await fs.readFile("/file"), plain);
  mode = "corrupt";
  await assert.rejects(fs.readFile("/file"), { code: "EIO" });
});
