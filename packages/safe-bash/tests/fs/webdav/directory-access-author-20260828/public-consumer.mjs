import assert from "node:assert/strict";
import { WebDavFileSystem, ReadOnlyFileSystem, FsError, Shell } from "virtual-bash";
import { WebDavFileSystem as SubpathWebDav } from "virtual-bash/fs/webdav";

const rows = [];
const check = async (name, operation) => { await operation(); rows.push(name); };
const requests = [];
let denyListing = false;
let file = false;
const filesystem = new WebDavFileSystem({ baseUrl: "https://public.invalid/dav/", fetch: async (url, init) => {
  const depth = new Headers(init.headers).get("depth");
  requests.push({ url, method: init.method, depth, redirect: init.redirect, credentials: init.credentials });
  if (denyListing && depth === "1") return new Response(null, { status: 403 });
  return new Response(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${new URL(url).pathname}</d:href><d:propstat><d:prop><d:resourcetype>${file ? "" : "<d:collection/>"}</d:resourcetype><d:getcontentlength>1</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`, { status: 207 });
} });
const error = code => value => value instanceof FsError && value.code === code;
await check("root-subpath same class", async () => assert.equal(WebDavFileSystem, SubpathWebDav));
await check("directory X_OK depth0 only", async () => {
  await filesystem.access("/folder", 1);
  assert.deepEqual(requests.map(request => request.depth), ["0"]);
  assert.equal(filesystem.capabilities.permissions, false);
});
await check("directory combined mode requires listing", async () => {
  requests.length = 0;
  await filesystem.access("/folder", 5);
  assert.deepEqual(requests.map(request => request.depth), ["0", "1"]);
});
await check("listing denial remains separate from navigation", async () => {
  denyListing = true;
  await filesystem.access("/folder", 1);
  await assert.rejects(filesystem.access("/folder", 5), error("EACCES"));
  denyListing = false;
});
await check("file X_OK refusal never GETs", async () => {
  file = true;
  requests.length = 0;
  await assert.rejects(filesystem.access("/file", 1), error("ENOTSUP"));
  assert.deepEqual(requests.map(request => request.method), ["PROPFIND"]);
  file = false;
});
await check("raw private cap before transport", async () => {
  requests.length = 0;
  await assert.rejects(filesystem.access("/".repeat(65537), 1), error("ENAMETOOLONG"));
  assert.equal(requests.length, 0);
});
await check("typed cancellation and readonly precedence", async () => {
  requests.length = 0;
  const options = { signal: AbortSignal.abort(0) };
  await assert.rejects(filesystem.access("/folder", 3, options), error("ECANCELED"));
  await assert.rejects(new ReadOnlyFileSystem(filesystem).access("/folder", 3, options), error("EROFS"));
  assert.equal(requests.length, 0);
});
await check("readonly navigation and unchanged shell cd", async () => {
  const readonly = new ReadOnlyFileSystem(filesystem);
  await readonly.access("/folder", 1);
  const shell = new Shell({ fs: readonly, cwd: "/", env: { HOME: "/", PATH: "" } });
  try {
    const result = await shell.exec("cd /folder; pwd");
    assert.equal(result.stdout, "/folder\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});
await check("no network policy or capability expansion", async () => {
  assert.ok(requests.every(request => request.method === "PROPFIND" && request.redirect === "manual" && request.credentials === "omit"));
  assert.deepEqual(Object.keys(filesystem.capabilities).sort(), ["atomicRename", "hardlinks", "permissions", "streamingRead", "streamingWrite", "symlinks", "timestamps"]);
});
console.log(JSON.stringify({ rows, count: rows.length, profile: "injected protocol, not a real service" }));
