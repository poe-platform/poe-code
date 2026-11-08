import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "./mock.js";

test("real HTTP streaming abort closes a stalled GET without buffering or draining it", { timeout: 3000 }, async () => {
  const mock = new MockDav();
  mock.files.set("/file", new Uint8Array([0, 255, 128]));
  let ready!: () => void;
  const disconnected = new Promise<void>(resolve => { ready = resolve; });
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      request.once("close", ready);
      response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": "1000" });
      response.write(new Uint8Array([0, 255, 128]));
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await mock.fetch(`http://${request.headers.host}${request.url}`, {
        method: request.method!, headers: { Depth: "0" }, body: Buffer.concat(chunks),
      });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(new Uint8Array(await result.arrayBuffer()));
    } catch { response.writeHead(500); response.end(); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const fs = new WebDavFileSystem({ baseUrl: `http://127.0.0.1:${address.port}/dav/`, fetch, timeoutMs: 1000 });
    const controller = new AbortController();
    const stream = fs.readStream("/file", { signal: controller.signal });
    assert.deepEqual((await stream.next()).value, new Uint8Array([0, 255, 128]));
    const rejected = assert.rejects(stream.next(), { code: "ECANCELED" });
    controller.abort();
    await rejected;
    await disconnected;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
