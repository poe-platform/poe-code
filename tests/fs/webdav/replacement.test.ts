import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "./mock.js";

const baseUrl = "https://example.test/dav/";

for (const method of ["MOVE", "COPY"] as const) {
  for (const overwritePolicy of ["lock", "etag"] as const) {
    test(`${method} replaces files under ${overwritePolicy} protection`, async () => {
      const mock = new MockDav();
      mock.files.set("/source", new Uint8Array([0, 255]));
      mock.files.set("/destination", new Uint8Array([9]));
      const sourceTag = mock.etag("/source");
      const destinationTag = mock.etag("/destination");
      const fs = new WebDavFileSystem({ baseUrl, fetch: mock.fetch, overwritePolicy });
      await (method === "MOVE" ? fs.rename("/source", "/destination") : fs.copyFile("/source", "/destination"));
      assert.deepEqual(mock.files.get("/destination"), new Uint8Array([0, 255]));
      assert.equal(mock.files.has("/source"), method === "COPY");
      const transfer = mock.requests.find((request) => request.init.method === method)!;
      assert.equal(transfer.headers.get("Overwrite"), "T");
      assert.equal(transfer.headers.get("If-Match"), sourceTag);
      assert.ok(transfer.headers.get("If")?.startsWith(`<${baseUrl}destination> (`));
      if (overwritePolicy === "etag") assert.equal(transfer.headers.get("If"), `<${baseUrl}destination> ([${destinationTag}])`);
      assert.equal(mock.locks.size, 0);
    });
  }

  for (const change of ["file", "directory", "missing"] as const) {
    test(`${method} tagged ETag rejects destination ${change} race`, async () => {
      const mock = new MockDav();
      mock.files.set("/source", new Uint8Array([1]));
      mock.files.set("/destination", new Uint8Array([2]));
      const fs = new WebDavFileSystem({ baseUrl, overwritePolicy: "etag", fetch: async (url, init) => {
        if (init.method === method) {
          if (change === "missing") mock.files.delete("/destination");
          else mock.files.set("/destination", change === "directory" ? null : new Uint8Array([9]));
          if (change === "directory") mock.files.set("/destination/precious", new Uint8Array([8]));
        }
        return mock.fetch(url, init);
      } });
      await assert.rejects(method === "MOVE" ? fs.rename("/source", "/destination") : fs.copyFile("/source", "/destination"), { code: "EAGAIN" });
      assert.deepEqual(mock.files.get("/source"), new Uint8Array([1]));
      assert.deepEqual(mock.files.get("/destination"), change === "missing" ? undefined : change === "directory" ? null : new Uint8Array([9]));
      if (change === "directory") assert.deepEqual(mock.files.get("/destination/precious"), new Uint8Array([8]));
    });
  }

  test(`${method} default lock prevents a competing overwrite`, async () => {
    const mock = new MockDav();
    mock.files.set("/source", new Uint8Array([1]));
    mock.files.set("/destination", new Uint8Array([2]));
    const fs = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
      if (init.method === method) {
        const competing = await mock.fetch(`${baseUrl}destination`, { method: "PUT", body: new Uint8Array([9]) });
        assert.equal(competing.status, 423);
      }
      return mock.fetch(url, init);
    } });
    await (method === "MOVE" ? fs.rename("/source", "/destination") : fs.copyFile("/source", "/destination"));
    assert.deepEqual(mock.files.get("/destination"), new Uint8Array([1]));
    assert.equal(mock.locks.size, 0);
  });
}

test("directory replacement locks membership before emptiness check", async () => {
  const mock = new MockDav();
  mock.files.set("/source", null);
  mock.files.set("/source/child", new Uint8Array([1]));
  mock.files.set("/destination", null);
  const fs = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
    if (init.method === "MOVE") {
      const competing = await mock.fetch(`${baseUrl}destination/precious`, { method: "PUT", body: new Uint8Array([9]) });
      assert.equal(competing.status, 423);
    }
    return mock.fetch(url, init);
  } });
  await fs.rename("/source", "/destination");
  assert.deepEqual(mock.files.get("/destination/child"), new Uint8Array([1]));
  assert.equal(mock.files.has("/source"), false);
  assert.equal(mock.locks.size, 0);
  const methods = mock.requests.map((request) => request.init.method);
  assert.ok(methods.indexOf("LOCK") < methods.indexOf("MOVE"));
});

for (const phase of ["before-lock", "after-list-expired"] as const) {
  test(`directory membership race ${phase} preserves the competing child`, async () => {
    const mock = new MockDav();
    mock.files.set("/source", null);
    mock.files.set("/destination", null);
    const fs = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
      if ((phase === "before-lock" && init.method === "LOCK") || (phase === "after-list-expired" && init.method === "MOVE")) {
        for (const lock of mock.locks.values()) lock.expires = 0;
        assert.equal((await mock.fetch(`${baseUrl}destination/precious`, { method: "PUT", body: new Uint8Array([9]) })).status, 201);
      }
      return mock.fetch(url, init);
    } });
    await assert.rejects(fs.rename("/source", "/destination"), { code: phase === "before-lock" ? "ENOTEMPTY" : "EAGAIN" });
    assert.deepEqual(mock.files.get("/destination/precious"), new Uint8Array([9]));
    assert.equal(mock.files.get("/source"), null);
    assert.equal(mock.locks.size, 0);
  });
}

test("locks are released on cancellation and partial MOVE failure", async () => {
  for (const cancel of [false, true]) {
    const mock = new MockDav();
    const controller = new AbortController();
    mock.files.set("/source", new Uint8Array([1]));
    mock.files.set("/destination", new Uint8Array([2]));
    const fs = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
      if (init.method === "MOVE") {
        if (cancel) controller.abort();
        return new Response('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/source</d:href><d:status>HTTP/1.1 403 Forbidden</d:status></d:response></d:multistatus>', { status: 207 });
      }
      return mock.fetch(url, init);
    } });
    await assert.rejects(fs.rename("/source", "/destination", { signal: controller.signal }), { code: cancel ? "ECANCELED" : "EIO" });
    assert.equal(mock.locks.size, 0);
    assert.equal(mock.requests.at(-1)!.init.method, "UNLOCK");
    assert.equal(mock.requests.at(-1)!.init.signal!.aborted, false);
  }
});

test("lockless servers require explicit ETag file policy, never unsafe directory overwrite", async () => {
  const mock = new MockDav();
  mock.files.set("/source", new Uint8Array([1]));
  mock.files.set("/destination", new Uint8Array([2]));
  const transport = async (url: string, init: RequestInit): Promise<Response> => init.method === "LOCK" ? new Response(null, { status: 405 }) : mock.fetch(url, init);
  const fs = new WebDavFileSystem({ baseUrl, fetch: transport });
  await assert.rejects(fs.rename("/source", "/destination"), { code: "ENOTSUP" });
  const conditional = new WebDavFileSystem({ baseUrl, fetch: transport, overwritePolicy: "etag" });
  await conditional.rename("/source", "/destination");
  mock.files.set("/source", null);
  mock.files.set("/destination", null);
  await assert.rejects(conditional.rename("/source", "/destination"), { code: "ENOTSUP" });
});

test("native loopback HTTP supports append, exclusive append and all replacement targets", async (context) => {
  const mock = new MockDav();
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const result = await mock.fetch(`http://${request.headers.host}${request.url}`, {
        method: request.method!, headers, ...(chunks.length ? { body: new Uint8Array(Buffer.concat(chunks)) } : {}),
      });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    })().catch((error: unknown) => response.destroy(error instanceof Error ? error : new Error(String(error))));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => { const closed = once(server, "close"); server.close(); server.closeAllConnections(); await closed; });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const fs = new WebDavFileSystem({ baseUrl: `http://127.0.0.1:${address.port}/dav/`, fetch: globalThis.fetch });
  await fs.appendFile("/source", new Uint8Array([1]));
  await fs.writeFile("/source", new Uint8Array([2]), { flag: "a" });
  await fs.writeFile("/destination", new Uint8Array([9]), { flag: "ax" });
  await fs.copyFile("/source", "/destination");
  await fs.rename("/source", "/destination");
  assert.deepEqual(await fs.readFile("/destination"), new Uint8Array([1, 2]));
  await fs.mkdir("/from");
  await fs.mkdir("/to");
  await fs.writeFile("/from/child", new Uint8Array([8]));
  await fs.rename("/from", "/to");
  assert.deepEqual(await fs.readFile("/to/child"), new Uint8Array([8]));
  assert.equal(mock.locks.size, 0);
});
