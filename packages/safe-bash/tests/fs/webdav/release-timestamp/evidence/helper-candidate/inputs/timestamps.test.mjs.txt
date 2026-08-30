import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, WebDavFileSystem } from "virtual-bash";
import { withBackingDav } from "./provider.mjs";

const namespace = "urn:virtual-bash:metadata";
const bytes = new Uint8Array([0, 255, 128, 13, 10, 65]);
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const unescape = (text) => text.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const document = (value, prefix = "v") => `<d:propertyupdate xmlns:d="DAV:" xmlns:${prefix}="${namespace}"><d:set><d:prop><${prefix}:timestamps>${escape(JSON.stringify(value))}</${prefix}:timestamps></d:prop></d:set></d:propertyupdate>`;

async function fixture(name, body) {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/file", bytes);
  await backing.utimes("/file", 1000, 2000);
  await backing.mkdir("/directory");
  await backing.utimes("/directory", 1000, 2000);
  await withBackingDav(backing, async (baseUrl) => {
    const wire = [];
    const transport = async (url, options) => {
      const response = await fetch(url, options);
      wire.push({ method: options.method, path: new URL(url).pathname, requestHeaders: Object.fromEntries(new Headers(options.headers)),
        requestBody: options.body, status: response.status, body: await response.clone().text() });
      return response;
    };
    const remote = new WebDavFileSystem({ baseUrl, fetch: transport });
    const raw = async (method, path, body, headers = {}) => {
      const response = await transport(`${baseUrl}${path.slice(1)}`, { method, headers, body });
      return { status: response.status, body: await response.text() };
    };
    const properties = async (path = "/file") => {
      const reply = await raw("PROPFIND", path, `<d:propfind xmlns:d="DAV:" xmlns:v="${namespace}"><d:prop><d:getetag/><v:timestamps/></d:prop></d:propfind>`, { Depth: "0" });
      assert.equal(reply.status, 207);
      const etag = /<d:getetag>(.*?)<\/d:getetag>/u.exec(reply.body)?.[1];
      assert.ok(etag);
      const stored = /<v:timestamps(?:\s+xmlns:v="urn:virtual-bash:metadata")?>(.*?)<\/v:timestamps>/u.exec(reply.body)?.[1];
      return { etag: unescape(etag), value: stored === undefined ? undefined : JSON.parse(unescape(stored)), body: reply.body };
    };
    const patch = async (value, xmlBody = document(value), extra = {}) => raw("PROPPATCH", "/file", xmlBody,
      { "Content-Type": "application/xml", "If-Match": value.etag, ...extra });
    const state = async () => {
      try { const stat = await backing.stat("/file"); return { atimeMs: stat.atimeMs, mtimeMs: stat.mtimeMs, size: stat.size }; }
      catch (error) { return { code: error.code }; }
    };
    const initial = await state();
    try { await body({ backing, remote, raw, properties, patch, state }); }
    finally { console.log(`TIMESTAMP_WITNESS ${JSON.stringify({ name, initial, after: await state(), wire })}`); }
  });
}

for (const path of ["/file", "/directory"]) {
  test(`exact public timestamp readback for ${path}`, { timeout: 5000 }, () => fixture(`public:${path}`, async ({ backing, remote }) => {
    await remote.utimes(path, -1234.5, 6789.25);
    const observed = await remote.stat(path);
    assert.equal(observed.atimeMs, -1234.5);
    assert.equal(observed.mtimeMs, 6789.25);
    const actual = await backing.stat(path);
    assert.equal(actual.atimeMs, -1234.5);
    assert.equal(actual.mtimeMs, 6789.25);
  }));
}

test("raw property persists unchanged with stable representation ETag and replaces old value", () => fixture("persistence", async ({ properties, patch, state }) => {
  const before = await properties();
  const first = { version: 1, etag: before.etag, type: "file", atimeMs: 1234.5, mtimeMs: -9876.25 };
  assert.equal((await patch(first)).status, 207);
  const after = await properties();
  assert.equal(after.etag, before.etag);
  assert.deepEqual(after.value, first);
  assert.match(after.body, /xmlns:v="urn:virtual-bash:metadata"/u);
  assert.deepEqual(await state(), { atimeMs: first.atimeMs, mtimeMs: first.mtimeMs, size: bytes.length });
  const second = { ...first, atimeMs: 15.125, mtimeMs: 90.875 };
  assert.equal((await patch(second)).status, 207);
  assert.deepEqual((await properties()).value, second);
}));

test("equivalent non-v namespace prefix is accepted", () => fixture("prefix", async ({ properties, patch }) => {
  const value = { version: 1, etag: (await properties()).etag, type: "file", atimeMs: 31.5, mtimeMs: 41.5 };
  assert.equal((await patch(value, document(value, "meta"))).status, 207);
  assert.deepEqual((await properties()).value, value);
}));

const invalidDocuments = {
  "wrong property namespace": (value) => document(value).replace(namespace, "urn:wrong"),
  "shadowed property namespace": (value) => document(value).replace("<v:timestamps>", '<v:timestamps xmlns:v="urn:wrong">'),
  "wrong DAV namespace": (value) => document(value).replace('xmlns:d="DAV:"', 'xmlns:d="urn:wrong"'),
  "wrong property name": (value) => document(value).replaceAll("timestamps", "other"),
  "duplicate property": (value) => document(value).replace("</d:prop>", `<v:timestamps>${escape(JSON.stringify(value))}</v:timestamps></d:prop>`),
  "multiple updates": (value) => document(value).replace("</d:propertyupdate>", "<d:remove><d:prop><v:timestamps/></d:prop></d:remove></d:propertyupdate>"),
  "malformed XML": (value) => document(value).replace("</d:set>", "</d:wrong>"),
};
for (const [name, makeDocument] of Object.entries(invalidDocuments)) {
  test(`${name} cannot mutate or publish timestamps`, () => fixture(name, async ({ properties, patch, state }) => {
    const before = await properties();
    const oldState = await state();
    const value = { version: 1, etag: before.etag, type: "file", atimeMs: 123, mtimeMs: 456 };
    assert.equal((await patch(value, makeDocument(value))).status, 400);
    assert.deepEqual(await state(), oldState);
    assert.deepEqual(await properties(), before);
  }));
}

for (const [name, change] of Object.entries({ "wrong version": { version: 2 }, "wrong type": { type: "directory" },
  "nonnumeric time": { atimeMs: "123" }, "out-of-range time": { mtimeMs: 9e15 } })) {
  test(`${name} cannot mutate or publish timestamps`, () => fixture(name, async ({ properties, patch, state }) => {
    const before = await properties();
    const oldState = await state();
    const value = { version: 1, etag: before.etag, type: "file", atimeMs: 123, mtimeMs: 456, ...change };
    assert.equal((await patch(value)).status, 400);
    assert.deepEqual(await state(), oldState);
    assert.deepEqual(await properties(), before);
  }));
}

test("mismatched property ETag and stale HTTP condition both preserve state", () => fixture("conditions", async ({ properties, patch, state }) => {
  const before = await properties();
  const initial = await state();
  const value = { version: 1, etag: before.etag, type: "file", atimeMs: 123, mtimeMs: 456 };
  assert.equal((await patch({ ...value, etag: '"wrong"' }, document({ ...value, etag: '"wrong"' }), { "If-Match": before.etag })).status, 412);
  assert.equal((await patch(value, document(value), { "If-Match": '"stale"' })).status, 412);
  assert.deepEqual(await state(), initial);
  assert.deepEqual(await properties(), before);
}));

test("PUT and DELETE/recreate invalidate metadata instead of rebinding it", () => fixture("replacement", async ({ remote, raw, properties }) => {
  await remote.utimes("/file", 1234.5, 6789.5);
  assert.ok((await properties()).value);
  assert.equal((await raw("PUT", "/file", "NEW")).status, 204);
  assert.equal((await properties()).value, undefined);
  await remote.utimes("/file", 1234.5, 6789.5);
  assert.equal((await raw("DELETE", "/file")).status, 204);
  assert.equal((await raw("PUT", "/file", "RECREATED")).status, 201);
  assert.equal((await properties()).value, undefined);
}));

test("out-of-band backing change invalidates the retained property", () => fixture("native-change", async ({ backing, remote, properties }) => {
  await remote.utimes("/file", 1234.5, 6789.5);
  const before = await properties();
  await backing.writeFile("/file", new Uint8Array([7, 8, 9]));
  await backing.utimes("/file", 10, 12000);
  const after = await properties();
  assert.notEqual(after.etag, before.etag);
  assert.equal(after.value, undefined);
  assert.deepEqual(await backing.readFile("/file"), new Uint8Array([7, 8, 9]));
}));

test("missing backing utimes and ignored backing effect cannot claim successful persistence", () => fixture("backing-failure", async ({ backing, properties, patch, state }) => {
  const before = await properties();
  const initial = await state();
  const value = { version: 1, etag: before.etag, type: "file", atimeMs: 123, mtimeMs: 456 };
  backing.utimes = undefined;
  assert.equal((await patch(value)).status, 501);
  backing.utimes = async () => {};
  assert.equal((await patch(value)).status, 409);
  assert.deepEqual(await state(), initial);
  assert.deepEqual(await properties(), before);
}));
