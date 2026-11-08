import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "./mock.js";

test("missing remote descendants distinguish non-directory from missing ancestors", async () => {
  const mock = new MockDav();
  mock.files.set("/file", new Uint8Array([0, 255]));
  mock.files.set("/directory", null);
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
  await assert.rejects(fs.readFile("/file/child"), { code: "ENOTDIR" });
  await assert.rejects(fs.stat("/file/missing/child"), { code: "ENOTDIR" });
  await assert.rejects(fs.readFile("/directory/missing/child"), { code: "ENOENT" });
  await assert.rejects(fs.stat("/file/child", { signal: AbortSignal.abort() }), { code: "ECANCELED" });
  assert.deepEqual(mock.files.get("/file"), new Uint8Array([0, 255]));
  assert.ok(mock.requests.every((request) => request.init.method === "PROPFIND"));
});

for (const flag of ["w", "wx"] as const) {
  for (const descendant of ["child", "missing/child"]) {
    test(`write ${flag} rejects a file ancestor before PUT: ${descendant}`, async () => {
      const mock = new MockDav();
      const original = new Uint8Array([0, 255, 13]);
      mock.files.set("/parent", original);
      const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
      await assert.rejects(fs.writeFile(`/parent/${descendant}`, new Uint8Array([9]), { flag }), { code: "ENOTDIR" });
      assert.deepEqual(mock.files.get("/parent"), original);
      assert.equal(mock.files.has(`/parent/${descendant}`), false);
      assert.equal(mock.requests.some((request) => request.init.method === "PUT"), false);
    });
  }
}

for (const method of ["MOVE", "COPY"] as const) {
  test(`${method} reports EISDIR for a file-to-collection mismatch without mutation`, async () => {
    const mock = new MockDav();
    mock.files.set("/source", new Uint8Array([1]));
    mock.files.set("/destination", null);
    mock.files.set("/destination/precious", new Uint8Array([9]));
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
    await assert.rejects(method === "MOVE" ? fs.rename("/source", "/destination") : fs.copyFile("/source", "/destination"), { code: "EISDIR" });
    assert.deepEqual(mock.files.get("/source"), new Uint8Array([1]));
    assert.deepEqual(mock.files.get("/destination/precious"), new Uint8Array([9]));
    assert.equal(mock.requests.some((request) => ["MOVE", "COPY", "DELETE"].includes(request.init.method!)), false);
  });
}

for (const suffix of ["/", "//", "/.", "/.."]) {
  for (const operation of ["write", "exclusive-write", "remove", "force-remove", "move-source", "move-destination", "copy-source", "copy-destination", "same-move"] as const) {
    test(`${operation} preserves a regular file with directory suffix ${suffix}`, async () => {
      const mock = new MockDav();
      const bytes = new Uint8Array([0, 255, 13]);
      mock.files.set("/precious", bytes);
      mock.files.set("/other", new Uint8Array([2]));
      const path = suffix === "/.." ? "/precious/child/.." : `/precious${suffix}`;
      const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
      const actions = {
        write: () => fs.writeFile(path, new Uint8Array([9])),
        "exclusive-write": () => fs.writeFile(path, new Uint8Array([9]), { flag: "wx" }),
        remove: () => fs.rm(path),
        "force-remove": () => fs.rm(path, { force: true, recursive: true }),
        "move-source": () => fs.rename(path, "/new"),
        "move-destination": () => fs.rename("/other", path),
        "copy-source": () => fs.copyFile(path, "/new"),
        "copy-destination": () => fs.copyFile("/other", path),
        "same-move": () => fs.rename("/precious", path),
      };
      await assert.rejects(actions[operation](), { code: "ENOTDIR" });
      assert.deepEqual(mock.files.get("/precious"), bytes);
      assert.equal(mock.requests.some((request) => ["PUT", "DELETE", "MOVE", "COPY"].includes(request.init.method!)), false);
    });
  }
}

test("directory suffix applies to stat, lstat, readFile, realpath and access", async () => {
  const mock = new MockDav();
  mock.files.set("/file", new Uint8Array([1]));
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
  for (const action of [() => fs.stat("/file/"), () => fs.lstat("/file/"), () => fs.readFile("/file/"),
    () => fs.realpath("/file/"), () => fs.access("/file/")]) {
    await assert.rejects(action(), { code: "ENOTDIR" });
  }
  assert.equal(mock.requests.some((request) => request.init.method === "GET"), false);
});

test("directory suffix cannot create a regular file at an absent path", async () => {
  const mock = new MockDav();
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
  await assert.rejects(fs.writeFile("/missing/", new Uint8Array([1])), { code: "ENOENT" });
  await assert.rejects(fs.writeFile("/missing/", new Uint8Array([1]), { flag: "wx" }), { code: "ENOENT" });
  assert.equal(mock.requests.some((request) => request.init.method === "PUT"), false);
  assert.equal(mock.files.has("/missing"), false);
});

test("explicit collection paths retain mkdir, move, listing, and recursive removal", async () => {
  const mock = new MockDav();
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
  await fs.mkdir("/parent/child/", { recursive: true });
  await fs.writeFile("/parent/child/file", new Uint8Array([1]));
  await assert.rejects(fs.writeFile("/parent/child/", new Uint8Array([2])), { code: "EISDIR" });
  await fs.rename("/parent/child/", "/moved/");
  assert.deepEqual(await fs.readdir("/moved/"), [{ name: "file", type: "file" }]);
  await fs.rm("/moved/", { recursive: true });
  assert.equal(mock.files.has("/moved/file"), false);
});

for (const method of ["MOVE", "COPY"] as const) {
  test(`${method} rejects a stale file destination without deleting its replacement collection`, async () => {
    const mock = new MockDav();
    const child = new Uint8Array([9, 8, 7]);
    mock.files.set("/source", new Uint8Array([1]));
    mock.files.set("/destination", new Uint8Array([2]));
    let mutations = 0;
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
      if (init.method === method) {
        mutations++;
        if (new Headers(init.headers).get("Overwrite") === "T") {
          for (const name of mock.files.keys()) {
            if (name === "/destination" || name.startsWith("/destination/")) mock.files.delete(name);
          }
        }
      }
      const response = await mock.fetch(url, init);
      if (init.method === "PROPFIND" && new URL(url).pathname === "/dav/destination") {
        mock.files.set("/destination", null);
        mock.files.set("/destination/precious", child);
      }
      return response;
    } });
    await assert.rejects(method === "MOVE" ? fs.rename("/source", "/destination") : fs.copyFile("/source", "/destination"), { code: "EAGAIN" });
    assert.equal(mutations, 0);
    assert.equal(mock.files.get("/destination"), null);
    assert.deepEqual(mock.files.get("/destination/precious"), child);
    assert.deepEqual(mock.files.get("/source"), new Uint8Array([1]));
  });

  test(`${method} conditionally protects an absent destination from concurrent collection creation`, async () => {
    const mock = new MockDav();
    mock.files.set("/source", new Uint8Array([1]));
    let overwrite: string | null = null;
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
      if (init.method === method) {
        overwrite = new Headers(init.headers).get("Overwrite");
        mock.files.set("/destination", null);
        mock.files.set("/destination/precious", new Uint8Array([9]));
      }
      return mock.fetch(url, init);
    } });
    await assert.rejects(method === "MOVE" ? fs.rename("/source", "/destination") : fs.copyFile("/source", "/destination"), { code: "EEXIST" });
    assert.equal(overwrite, "F");
    assert.deepEqual(mock.files.get("/destination/precious"), new Uint8Array([9]));
    assert.deepEqual(mock.files.get("/source"), new Uint8Array([1]));
  });
}

test("explicit collection slash works directly on a real slash-canonicalizing server", async () => {
  const mock = new MockDav();
  mock.files.set("/collection", null);
  mock.files.set("/collection/file", new Uint8Array([1]));
  const paths: string[] = [];
  const server = createServer(async (request, response) => {
    paths.push(request.url!);
    if (request.url === "/dav/collection") {
      response.writeHead(301, { Location: "/dav/collection/" });
      response.end();
      return;
    }
    try {
      const result = await mock.fetch(`http://${request.headers.host}${request.url}`, {
        method: request.method!, headers: request.headers as Record<string, string>,
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
    assert.equal((await fs.stat("/collection/")).type, "directory");
    assert.deepEqual(paths, ["/dav/collection/"]);
    paths.length = 0;
    assert.equal((await fs.stat("/collection")).type, "directory");
    assert.deepEqual(paths, ["/dav/collection", "/dav/collection/"]);
    paths.length = 0;
    assert.equal((await fs.lstat("/collection/")).type, "directory");
    assert.equal(await fs.realpath("/collection/"), "/collection");
    await fs.access("/collection/");
    await fs.rm("/collection/", { recursive: true });
    assert.equal(mock.files.has("/collection/file"), false);
    assert.equal(paths.every((path) => path === "/dav/collection/"), true);
    mock.files.set("/precious", new Uint8Array([7]));
    await assert.rejects(fs.rm("/precious/", { recursive: true, force: true }), { code: "ENOTDIR" });
    await assert.rejects(fs.writeFile("/precious/", new Uint8Array([8])), { code: "ENOTDIR" });
    assert.deepEqual(mock.files.get("/precious"), new Uint8Array([7]));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

for (const status of [301, 302, 307, 308]) {
  test(`PROPFIND permits one exact collection-slash canonicalization for ${status}`, async () => {
    const mock = new MockDav();
    mock.files.set("/collection &雪", null);
    const requests: { url: string; init: RequestInit }[] = [];
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", headers: { Authorization: "Bearer explicit" }, fetch: async (url, init) => {
      requests.push({ url, init });
      if (!url.endsWith("/")) return new Response(null, { status, headers: { Location: `${url}/` } });
      return mock.fetch(url, init);
    } });
    assert.equal((await fs.stat("/collection &雪")).type, "directory");
    assert.equal(requests.length, 2);
    assert.equal(requests[1]!.url, `${requests[0]!.url}/`);
    assert.equal(requests[1]!.init.method, "PROPFIND");
    assert.equal(requests[1]!.init.body, requests[0]!.init.body);
    assert.equal(requests[1]!.init.signal, requests[0]!.init.signal);
    assert.equal(requests[1]!.init.credentials, "omit");
    assert.equal(requests[1]!.init.redirect, "manual");
    assert.equal(new Headers(requests[1]!.init.headers).get("Authorization"), "Bearer explicit");
  });
}

for (const location of ["https://evil.test/dav/collection/", "/outside/collection/", "/dav/collection/child/",
  "/dav/collection/?", "/dav/collection/#", "/dav/collection/%2e%2e/", "//example.test/dav/collection/",
  "http://example.test/dav/collection/", "https://user:pass@example.test/dav/collection/", "/dav/%63ollection/", "collection/"]) {
  test(`canonicalization never follows unsafe or non-exact Location ${location}`, async () => {
    let requests = 0;
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async () => {
      requests++;
      return new Response(null, { status: 307, headers: { Location: location } });
    } });
    await assert.rejects(fs.stat("/collection"));
    assert.equal(requests, 1);
  });
}

test("canonicalization never loops or redirects a mutation", async () => {
  let requests = 0;
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url) => {
    requests++;
    return new Response(null, { status: 307, headers: { Location: url.endsWith("/") ? url : `${url}/` } });
  } });
  await assert.rejects(fs.stat("/collection"), { code: "ENOTSUP" });
  assert.equal(requests, 2);
  requests = 0;
  await assert.rejects(fs.writeFile("/new", new Uint8Array([1]), { flag: "wx" }), { code: "ENOTSUP" });
  assert.equal(requests, 1);
});

test("canonicalization cancels the old response body before the second request", async () => {
  const mock = new MockDav();
  mock.files.set("/collection", null);
  let cancelled = false;
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    if (!url.endsWith("/")) return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      status: 301, headers: { Location: "/dav/collection/" },
    });
    assert.equal(cancelled, true);
    return mock.fetch(url, init);
  } });
  assert.equal((await fs.stat("/collection")).type, "directory");
});

test("303 is not a collection canonicalization", async () => {
  let requests = 0;
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url) => {
    requests++;
    return new Response(null, { status: 303, headers: { Location: `${url}/` } });
  } });
  await assert.rejects(fs.stat("/collection"), { code: "ENOTSUP" });
  assert.equal(requests, 1);
});
