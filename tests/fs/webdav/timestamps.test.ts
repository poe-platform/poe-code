import assert from "node:assert/strict";
import { test } from "node:test";
import { agentCommands, Shell, WebDavFileSystem } from "../../../src/index.js";
import { MockDav, multistatus, xmlResponse } from "./mock.js";
import { namespace, PropertyDav, withLoopbackDav } from "./property-fixture.js";

function fixture(mock = new PropertyDav()) {
  mock.base.files.set("/file", new Uint8Array([0, 255, 128]));
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
  return { fs, mock };
}

test("utimes persists millisecond timestamps across adapter instances without changing bytes", async () => {
  const { fs, mock } = fixture();
  await fs.utimes("/file", 1234.5, -6789);
  const next = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
  assert.equal((await next.stat("/file")).atimeMs, 1234.5);
  assert.equal((await next.stat("/file")).mtimeMs, -6789);
  assert.deepEqual(await next.readFile("/file"), new Uint8Array([0, 255, 128]));
  assert.equal(next.capabilities.timestamps, true);
  const patch = mock.base.requests.find(request => request.init.method === "PROPPATCH")!;
  assert.equal(patch.headers.get("If-Match"), mock.base.etag("/file"));
  assert.ok(!String(patch.init.body).includes("getlastmodified"));
  await fs.utimes("/", 1, 2);
  assert.equal((await fs.stat("/")).mtimeMs, 2);
  await fs.writeFile("/file", new Uint8Array([9]));
  assert.equal((await next.stat("/file")).atimeMs, 0, "timestamps bound to a different representation are ignored");
});

test("timestamp validation and missing targets cause no creation or mutation", async () => {
  const { fs, mock } = fixture();
  for (const value of [NaN, Infinity, -Infinity, 8.64e15 + 1]) {
    await assert.rejects(fs.utimes("/file", value, 0), { code: "EINVAL" });
    await assert.rejects(fs.utimes("/file", 0, value), { code: "EINVAL" });
  }
  assert.equal(mock.base.requests.length, 0);
  await assert.rejects(fs.utimes("/file", 0, 0, { signal: AbortSignal.abort() }), { code: "ECANCELED" });
  await assert.rejects(fs.utimes("/missing", 0, 0), { code: "ENOENT" });
  assert.ok(!mock.base.files.has("/missing"));
  assert.ok(!mock.base.requests.some(request => request.init.method === "PROPPATCH"));
});

test("unsupported, denied, locked and stale timestamp updates preserve remote state", async () => {
  for (const [status, code] of [[403, "EACCES"], [423, "EBUSY"], [424, "EIO"], [507, "ENOSPC"]] as const) {
    const { fs, mock } = fixture();
    mock.propertyStatus = status;
    await assert.rejects(fs.utimes("/file", 1, 2), { code });
    assert.equal(mock.properties.size, 0);
    assert.deepEqual(mock.base.files.get("/file"), new Uint8Array([0, 255, 128]));
  }
  const unsupported = new MockDav();
  unsupported.files.set("/file", new Uint8Array([7]));
  await assert.rejects(new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: unsupported.fetch }).utimes("/file", 0, 0), { code: "ENOTSUP" });
  const { mock } = fixture();
  const racing = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    if (init.method === "PROPPATCH") mock.base.files.set("/file", new Uint8Array([42]));
    return mock.fetch(url, init);
  } });
  await assert.rejects(racing.utimes("/file", 1, 2), { code: "EAGAIN" });
  assert.equal(mock.properties.size, 0);
  mock.base.locks.set("/file", { token: "urn:uuid:another-writer", expires: Date.now() + 60_000 });
  await assert.rejects(fixture(mock).fs.utimes("/file", 1, 2), { code: "EBUSY" });
  assert.equal(mock.properties.size, 0);
});

test("PROPPATCH requires exactly the requested resource and successful property result", async () => {
  for (const [body, code] of [
    [multistatus(), "EIO"],
    [multistatus('<z:response><z:href>/dav/file</z:href><z:status>HTTP/1.1 200 OK</z:status></z:response>'), "EIO"],
    [multistatus('<z:response><z:href>/dav/other</z:href></z:response>'), "EACCES"],
    [multistatus('<z:response><z:href>/dav/file</z:href><z:propstat><z:prop><z:timestamps/></z:prop><z:status>HTTP/1.1 200 OK</z:status></z:propstat></z:response>'), "EIO"],
    [multistatus(`<z:response><z:href>/dav/file</z:href><z:propstat><z:prop><v:timestamps xmlns:v="${namespace}"/></z:prop><z:status>HTTP/1.1 201 Created</z:status></z:propstat></z:response>`), "EIO"],
  ] as const) {
    const { mock } = fixture();
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: (url, init) =>
      init.method === "PROPPATCH" ? Promise.resolve(xmlResponse(body)) : mock.fetch(url, init) });
    await assert.rejects(fs.utimes("/file", 1, 2), { code });
  }
});

test("invalid persisted timestamps fail closed while stale representation metadata is ignored", async () => {
  const { fs, mock } = fixture();
  for (const value of ["null", "{}", "invalid-json", JSON.stringify({ version: 1, type: "file", etag: 'W/"weak"', atimeMs: 1, mtimeMs: 2 }),
    JSON.stringify({ version: 1, type: "file", etag: mock.base.etag("/file"), atimeMs: "1", mtimeMs: 2 }),
    JSON.stringify({ version: 1, type: "file", etag: mock.base.etag("/file"), atimeMs: 1, mtimeMs: 1e20 })]) {
    mock.properties.set("/file", value);
    await assert.rejects(fs.stat("/file"), { code: "EIO" });
  }
  mock.properties.set("/file", JSON.stringify({ version: 1, type: "file", etag: '"old-version"', atimeMs: 1, mtimeMs: 2 }));
  assert.equal((await fs.stat("/file")).atimeMs, 0);
});

test("loopback agentCommands touch and named gzip reads work with streamed uploads", async () => {
  const mock = new PropertyDav();
  await withLoopbackDav(mock.fetch, async baseUrl => {
    const fs = new WebDavFileSystem({ baseUrl, fetch, timeoutMs: 2000 });
    const shell = new Shell({ fs });
    shell.use(agentCommands());
    await fs.writeStream("/file", (async function* () { yield new Uint8Array([0, 255]); yield new Uint8Array([128, 10]); })());
    const created = await shell.exec("touch /new && touch /new");
    assert.equal(created.exitCode, 0, created.stderr);
    assert.ok((await fs.stat("/new")).mtimeMs > 0);
    await fs.utimes("/file", 12345, 67890);
    const result = await shell.exec("gzip -c /file > /file.gz && gzip -dc /file.gz | sha256sum");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/file"), new Uint8Array([0, 255, 128, 10]));
    const copied = await shell.exec("touch -r /file /new");
    assert.equal(copied.exitCode, 0, copied.stderr);
    assert.equal((await fs.stat("/new")).atimeMs, 12345);
    assert.equal((await fs.stat("/new")).mtimeMs, 67890);
    await fs.rm("/file.gz");
    const namedOutput = await shell.exec("gzip -k /file");
    assert.equal(namedOutput.exitCode, 1);
    assert.match(namedOutput.stderr, /ENOTSUP: mkdir mode/);
    assert.deepEqual(await fs.readFile("/file"), new Uint8Array([0, 255, 128, 10]));
    assert.equal(mock.base.locks.size, 0);
  });
});
