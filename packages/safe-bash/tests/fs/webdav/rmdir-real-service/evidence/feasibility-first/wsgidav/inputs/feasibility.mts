import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { FsError, createReadOnlyFileSystem, createOverlayFileSystem, createMemoryFileSystem } from "virtual-bash";
import type { WebDavFetch } from "virtual-bash/fs/webdav";
import { createApplication, type LiteralConfiguration } from "./example.mjs";
import type { WireObservation } from "./https.mjs";

const config: LiteralConfiguration = JSON.parse(await readFile(process.argv[2]!, "utf8"));
const evidence = process.argv[3]!, provider = process.argv[4]!;
const events: WireObservation[] = [], observations: unknown[] = [];
const app = await createApplication(config, events);
const payload = new Uint8Array([0, 255, 128, 65, 13, 10]);
const rows: object[] = [];
let paths: string[] = [];
const url = (path: string, alias = false) => new URL(path.slice(1), alias ? config.aliasUrl : config.baseUrl).href;
class UnsupportedGrant extends Error {}
const code = (expected: string) => (error: unknown) => error instanceof FsError && error.code === expected;
const wire: WebDavFetch = (requestUrl, init) => {
  const headers = new Headers(init.headers); headers.set("Authorization", config.authorization);
  return app.fetch(requestUrl, { ...init, headers, redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(5000) });
};
async function response(method: string, path: string, headers: Record<string, string> = {}, body?: string | Uint8Array, alias = false) {
  const result = await wire(url(path, alias), { method, headers, ...(body === undefined ? {} : { body }) });
  const text = await result.text(); observations.push({ method, path, alias, status: result.status, headers: Object.fromEntries(result.headers), body: text });
  return { status: result.status, headers: result.headers, body: text };
}
async function witnesses() {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    try {
      const stat = await app.native.lstat(path);
      result[path] = { type: stat.type, dev: stat.dev, ino: stat.ino, ...(stat.type === "file" ? { bytes: [...await app.native.readFile(path)] } : {}),
        ...(stat.type === "directory" ? { children: await app.native.readdir(path) } : {}), ...(stat.type === "symlink" ? { target: await app.native.readlink(path) } : {}) };
    } catch (error) { result[path] = { error: error instanceof FsError ? error.code : String(error) }; }
  }
  return result;
}
async function row(name: string, surface: "public" | "raw", kind: "positive" | "guard" | "refusal", operation: () => Promise<void>) {
  paths = []; const start = events.length, observationStart = observations.length;
  let result = "pass", error: unknown;
  try { await operation(); } catch (caught) { result = caught instanceof UnsupportedGrant ? "refused" : "fail"; error = { message: String(caught), ...(caught instanceof FsError ? { code: caught.code } : {}) }; }
  const post = await witnesses();
  for (const path of paths.filter(path => path.endsWith("/"))) await response("PROPFIND", path, { Depth: "0", "Content-Type": "application/xml" }, '<d:propfind xmlns:d="DAV:"><d:prop><d:lockdiscovery/></d:prop></d:propfind>');
  rows.push({ name, surface, kind, result, error, events: events.slice(start), observations: observations.slice(observationStart), witnesses: post });
  console.log(`${result} ${surface} ${kind}: ${name}`);
}
async function seed(name: string) {
  const path = `/rmdir-${name}/`; paths.push(path); await app.native.mkdir(path); return path;
}
async function withLock(path: string, operation: (token: string) => Promise<void>, timeout = "Second-60") {
  const grant = await response("LOCK", path, { Depth: "infinity", Timeout: timeout, "If-Match": "*", "Content-Type": "application/xml" }, '<d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype></d:lockinfo>');
  assert.equal(grant.status, 200);
  const token = grant.headers.get("Lock-Token");
  if (!token || !/^<[a-z][a-z0-9+.-]*:[^<>\s]+>$/i.test(token)) throw new UnsupportedGrant("invalid actual Lock-Token: no operation or header repair");
  try {
    assert.match(grant.body, /<(?:\w+:)?exclusive\s*\/>/); assert.doesNotMatch(grant.body, /<(?:\w+:)?shared\b/);
    assert.match(grant.body, /<(?:\w+:)?write\s*\/>/); assert.match(grant.body, /<(?:\w+:)?depth>infinity<\//);
    await operation(token);
  } finally { await response("UNLOCK", path, { "Lock-Token": token }); }
}
const tagged = (path: string, token: string) => ({ If: `<${url(path)}> (${token})` });

await row("required public empty rmdir removes only directory", "public", "positive", async () => {
  const path = await seed("public-empty"); await app.dav.rmdir(path); await assert.rejects(app.native.stat(path), code("ENOENT"));
});
await row("required public Shell rmdir removes empty directory", "public", "positive", async () => {
  const path = await seed("shell-empty"); const result = await app.shell.exec(`rmdir /dav${path}`); observations.push({ shell: result });
  assert.equal(result.exitCode, 0); await assert.rejects(app.native.stat(path), code("ENOENT"));
});
await row("preexisting nonempty directory preserves child", "public", "guard", async () => {
  const path = await seed("nonempty"), child = `${path}child`; paths.push(child); await app.native.writeFile(child, payload);
  await assert.rejects(app.dav.rmdir(path), code("ENOTEMPTY")); assert.deepEqual(await app.native.readFile(child), payload);
});
await row("root file missing and preabort keep typed errors", "public", "guard", async () => {
  const path = await seed("errors"), child = `${path}file`; paths.push(child); await app.native.writeFile(child, payload);
  await assert.rejects(app.dav.rmdir("/"), code("EBUSY")); await assert.rejects(app.dav.rmdir(child), code("ENOTDIR"));
  await assert.rejects(app.dav.rmdir(`${path}missing`), code("ENOENT")); await assert.rejects(app.dav.rmdir(path, { signal: AbortSignal.abort() }), code("ECANCELED"));
});
await row("readonly mounted-root and overlay-upper propagate safe refusal", "public", "guard", async () => {
  const path = await seed("wrappers");
  await assert.rejects(createReadOnlyFileSystem(app.dav).rmdir(path), code("EROFS"));
  await assert.rejects(app.mounted.rmdir("/dav"), code("EBUSY"));
  const overlay = createOverlayFileSystem({ lower: createMemoryFileSystem(), upper: app.dav });
  await assert.rejects(overlay.rmdir(path), code("ENOTSUP")); await app.native.stat(path);
});
await row("locked empty collection DELETE primitive succeeds", "raw", "positive", async () => {
  const path = await seed("empty-delete");
  await withLock(path, async token => { assert.deepEqual(await app.dav.readdir(path), []); assert.equal((await response("DELETE", path, tagged(path, token))).status, 204); });
  await assert.rejects(app.native.stat(path), code("ENOENT"));
});
await row("late child before lock is visible and no DELETE occurs", "raw", "guard", async () => {
  const path = await seed("before-lock"), child = `${path}child`; paths.push(child); assert.deepEqual(await app.dav.readdir(path), []);
  assert.equal((await response("PUT", child, {}, payload)).status, 201);
  await withLock(path, async () => { assert.equal((await app.dav.readdir(path)).length, 1); });
  assert.deepEqual(await app.native.readFile(child), payload);
});
await row("depth-infinity blocks descendant PUT MKCOL and URL aliases", "raw", "guard", async () => {
  const path = await seed("descendants"), nested = `${path}nested/`; paths.push(nested); await app.native.mkdir(nested);
  await withLock(path, async () => {
    for (const alias of [false, true]) for (const method of ["PUT", "MKCOL"]) {
      const child = `${nested}${method}-${alias}${method === "MKCOL" ? "/" : ""}`; paths.push(child);
      const result = await response(method, child, {}, method === "PUT" ? payload : undefined, alias);
      assert.equal(result.status, 423); await assert.rejects(app.native.stat(child), code("ENOENT"));
    }
  });
});
await row("wrong token cannot recursively delete existing child", "raw", "guard", async () => {
  const path = await seed("wrong-token"), child = `${path}child`; paths.push(child); await app.native.writeFile(child, payload);
  await withLock(path, async () => { assert.equal((await response("DELETE", path, tagged(path, "<opaquelocktoken:00000000-0000-4000-8000-000000000000>"))).status, 412); });
  assert.deepEqual(await app.native.readFile(child), payload);
});
await row("expired token rejects deletion after a new child arrives", "raw", "guard", async () => {
  const path = await seed("expiry"), child = `${path}child`; paths.push(child);
  await withLock(path, async token => {
    assert.deepEqual(await app.dav.readdir(path), []); await new Promise(resolve => setTimeout(resolve, 2200));
    assert.equal((await response("PUT", child, {}, payload)).status, 201);
    assert.equal((await response("DELETE", path, tagged(path, token))).status, 412);
    assert.deepEqual(await app.native.readFile(child), payload);
  }, "Second-1");
});
await row("native child after locked listing must not be deleted", "raw", "guard", async () => {
  const path = await seed("native-writer"), child = `${path}late-child`; paths.push(child);
  await withLock(path, async token => {
    assert.deepEqual(await app.dav.readdir(path), []); await app.native.writeFile(child, payload);
    observations.push({ beforeDelete: await witnesses() });
    const result = await response("DELETE", path, tagged(path, token)); observations.push({ candidateDeleteStatus: result.status });
    assert.deepEqual(await app.native.readFile(child), payload);
  });
});
await row("final host symlink collection mapping is not an empty-directory primitive", "raw", "guard", async () => {
  const path = await seed("symlink-target"), link = "/rmdir-symlink/"; paths.push(link);
  await app.native.symlink(path.slice(1, -1), link.slice(0, -1));
  observations.push({ davType: (await app.dav.stat(link)).type, nativeType: (await app.native.lstat(link.slice(0, -1))).type });
  await withLock(link, async token => {
    assert.deepEqual(await app.dav.readdir(link), []); const result = await response("DELETE", link, tagged(link, token)); observations.push({ symlinkDeleteStatus: result.status });
    assert.equal((await app.native.lstat(link.slice(0, -1))).type, "symlink"); await app.native.stat(path);
  });
});
await writeFile(`${evidence}/feasibility.json`, JSON.stringify({ provider, rows, imports: { root: import.meta.resolve("virtual-bash"), webdav: import.meta.resolve("virtual-bash/fs/webdav") } }, null, 2), { flag: "wx" });
