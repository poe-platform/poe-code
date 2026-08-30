import assert from "node:assert/strict";
import { readFile, writeFile, stat as hostStat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { FsError, WebDavFileSystem as RootWebDav, readBytes } from "virtual-bash";
import { WebDavFileSystem } from "virtual-bash/fs/webdav";
import type { WebDavFetch, WebDavFileSystemOptions } from "virtual-bash/fs/webdav";
import { createApplication, type LiteralConfiguration } from "./example.mjs";
import type { WireObservation } from "./https.mjs";

const config: LiteralConfiguration = JSON.parse(await readFile(process.argv[2]!, "utf8"));
const evidence = process.argv[3]!;
const provider = process.argv[4]!;
const events: WireObservation[] = [];
const app = await createApplication(config, events);
const settings: WebDavFileSystemOptions = { baseUrl: config.baseUrl, fetch: app.fetch, headers: { Authorization: config.authorization }, timeoutMs: 2000 };
const payload = new Uint8Array([0, 255, 128, 195, 169, 13, 10, 0, 65]);
const old = new Uint8Array([79, 76, 68]);
const rows: object[] = [];
const observations: object[] = [];
let paths: string[] = [];
let sequence = 0;
const url = (path: string) => new URL(path.slice(1), config.baseUrl).href;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const isCode = (code: string) => (error: unknown) => error instanceof FsError && error.code === code;
async function wire(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers); headers.set("Authorization", config.authorization);
  return app.fetch(url(path), { ...init, headers, redirect: "manual", credentials: "omit" });
}
async function seed() {
  const source = `/ind-${++sequence}-source`, target = `/ind-${sequence}-target`;
  paths.push(source, target);
  await app.native.writeFile(source, payload); await app.native.writeFile(target, old);
  return { source, target };
}
async function unchanged(source: string, target: string) {
  assert.deepEqual(await app.native.readFile(source), payload);
  assert.deepEqual(await app.native.readFile(target), old);
}
async function discovery(path: string) {
  const response = await wire(path, { method: "PROPFIND", headers: { Depth: "0", "Content-Type": "application/xml" }, body: '<d:propfind xmlns:d="DAV:"><d:prop><d:lockdiscovery/></d:prop></d:propfind>' });
  const body = await response.text();
  observations.push({ kind: "lockdiscovery", path, status: response.status, body });
  return body;
}
async function witnesses() {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    try {
      const metadata = await hostStat(`${config.serverRoot}${path}`);
      const bytes = await readFile(`${config.serverRoot}${path}`);
      result[path] = { dev: metadata.dev, ino: metadata.ino, nlink: metadata.nlink, bytes: bytes.length <= 64 ? [...bytes] : undefined, size: bytes.length, sha256: hash(bytes) };
    } catch (error) { result[path] = { error: (error as NodeJS.ErrnoException).code }; }
  }
  return result;
}
async function row(name: string, boundary: string, operation: () => Promise<void>) {
  const start = events.length;
  paths = [];
  let failure: unknown;
  try { await operation(); } catch (error) { failure = error; }
  const record = { name, boundary, result: failure ? "fail" : "pass", error: failure instanceof Error ? { name: failure.name, message: failure.message, stack: failure.stack } : failure, events: events.slice(start), witnesses: await witnesses() };
  rows.push(record);
  console.log(JSON.stringify({ name, boundary, result: record.result, error: record.error }));
}

await row("root/subpath constructors and declared capabilities agree", "public-package", async () => {
  assert.equal(RootWebDav, WebDavFileSystem);
  assert.match(import.meta.resolve("virtual-bash"), /\/consumer\/node_modules\/virtual-bash\/dist\/index.js$/);
  assert.match(import.meta.resolve("virtual-bash/fs/webdav"), /\/consumer\/node_modules\/virtual-bash\/dist\/fs\/webdav\/index.js$/);
  assert.equal(app.dav.capabilities.atomicRename, false);
});
for (const method of ["copyFile", "rename"] as const) {
  await row(`default ${method} preserves binary output using actual backing authority`, "public-positive", async () => {
    const { source, target } = await seed();
    await app.dav[method](source, target);
    assert.deepEqual(await app.native.readFile(target), payload);
    if (method === "rename") await assert.rejects(app.native.stat(source), isCode("ENOENT"));
    else assert.deepEqual(await app.native.readFile(source), payload);
    assert.doesNotMatch(await discovery(target), /<(?:[\w-]+:)?activelock[ >]/);
  });
  for (const answer of ["unknown", "same", "throw", "abort"] as const) {
    await row(`${method} ${answer} authority has no destructive request`, "public-authority", async () => {
      const { source, target } = await seed();
      const controller = new AbortController();
      const marker = new FsError("EACCES");
      let calls = 0;
      const filesystem: WebDavFileSystem = new WebDavFileSystem({ ...settings, compareEntry: async function () {
        assert.equal(this, filesystem); calls++;
        if (answer === "throw") throw marker;
        if (answer === "abort") { controller.abort(marker); return "distinct"; }
        return answer;
      } });
      const start = events.length;
      await assert.rejects(filesystem[method](source, target, { signal: controller.signal }));
      assert.equal(calls, 1);
      assert.ok(!events.slice(start).some(event => ["LOCK", "PUT", "COPY", "MOVE", "DELETE"].includes(event.method)));
      await unchanged(source, target);
    });
  }
}

const mutations: [string, (body: string, target: string) => string][] = [
  ["contradictory shared and exclusive scope", body => body.replace(/<(\w+:)?exclusive\s*\/>/, (match, prefix) => `${match}<${prefix ?? ""}shared/>`)],
  ["contradictory read and write type", body => body.replace(/<(\w+:)?write\s*\/>/, (match, prefix) => `${match}<${prefix ?? ""}read/>`)],
  ["duplicate active grants", body => body.replace(/(<(?:\w+:)?activelock>[\s\S]*?<\/(?:\w+:)?activelock>)/, "$1$1")],
  ["wrong explicit root with encoded slash", (body, target) => body.replace(/<\/(\w+:)?activelock>/, (match, prefix) => `<${prefix ?? ""}lockroot><${prefix ?? ""}href>${url(target)}%2fother</${prefix ?? ""}href></${prefix ?? ""}lockroot>${match}`)],
  ["empty explicit root cannot be legacy absence", body => body.replace(/<\/(\w+:)?activelock>/, (match, prefix) => `<${prefix ?? ""}lockroot></${prefix ?? ""}lockroot>${match}`)],
  ["finite timeout overflow", body => body.replace(/Second-\d+/, "Second-4294967296")],
  ["zero depth", body => body.replace(/(<(?:\w+:)?depth>)infinity(<\/(?:\w+:)?depth>)/, "$10$2")],
];
for (const [name, mutate] of mutations) {
  await row(`malformed real LOCK: ${name}`, "injected-server-grant", async () => {
    const { source, target } = await seed();
    let captured = "";
    let reached = false;
    const grant: { token: string | null } = { token: null };
    const altered: WebDavFetch = async (requestUrl, init) => {
      const response = await app.fetch(requestUrl, init);
      if (init.method !== "LOCK") return response;
      reached = true; grant.token = response.headers.get("Lock-Token");
      captured = await response.text();
      const modified = mutate(captured, target);
      observations.push({ kind: "grant-mutation", name, original: captured, modified, token: grant.token, tokenCodedValid: /^<[^<>]+>$/.test(grant.token ?? ""), status: response.status });
      assert.notEqual(modified, captured, "negative fixture mutation must actually apply");
      const result = new Response(modified, { status: response.status, headers: response.headers });
      Object.defineProperty(result, "url", { value: response.url });
      return result;
    };
    const filesystem = new WebDavFileSystem({ ...settings, fetch: altered });
    const start = events.length;
    try {
      await assert.rejects(filesystem.copyFile(source, target));
      assert.equal(reached, true);
      await unchanged(source, target);
      assert.ok(!events.slice(start).some(event => event.method === "COPY"));
      if (provider === "apache") assert.doesNotMatch(await discovery(target), /<(?:[\w-]+:)?activelock[ >]/);
    } finally {
      if (grant.token) {
        const cleanup = await wire(target, { method: "UNLOCK", headers: { "Lock-Token": grant.token.startsWith("<") ? grant.token : `<${grant.token}>` } });
        observations.push({ kind: "test-cleanup-only", target, status: cleanup.status });
        await cleanup.body?.cancel();
      }
    }
  });
}

for (const method of ["COPY", "MOVE"]) {
  await row(`raw ${method} changed source validator preserves both native entries`, "server-conditional", async () => {
    const { source, target } = await seed();
    const before = await wire(source, { method: "GET" });
    const validator = before.headers.get("ETag")!; await before.body?.cancel();
    assert.match(validator, /^".+"$/);
    const changed = new Uint8Array([...payload, 99, 100, 101]);
    await app.native.writeFile(source, changed);
    const response = await wire(source, { method, headers: { Destination: url(target), Overwrite: "T", "If-Match": validator } });
    const body = await response.text();
    observations.push({ kind: "changed-source", method, validator, status: response.status, body });
    assert.equal(response.status, 412);
    assert.deepEqual(await app.native.readFile(source), changed);
    assert.deepEqual(await app.native.readFile(target), old);
  });
}
await row("wrong authentication cannot mutate native target", "server-auth", async () => {
  const { source, target } = await seed();
  const filesystem = new WebDavFileSystem({ ...settings, headers: { Authorization: "Basic Zml4dHVyZTppbnZhbGlk" } });
  await assert.rejects(filesystem.writeFile(target, payload), isCode("EACCES"));
  await unchanged(source, target);
});
await row("exclusive creation cannot replace native target", "public-conditional", async () => {
  const { source, target } = await seed();
  await assert.rejects(app.dav.writeFile(target, payload, { flag: "wx" }), isCode("EEXIST"));
  await unchanged(source, target);
});
await row("preabort does not contact service or consume upload", "public-cancel", async () => {
  const { source, target } = await seed();
  let pulls = 0;
  const input = { async *[Symbol.asyncIterator]() { pulls++; yield payload; } };
  const start = events.length;
  await assert.rejects(app.dav.writeStream(target, input, { signal: AbortSignal.abort(new Error("independent")) }), isCode("ECANCELED"));
  assert.equal(pulls, 0); assert.equal(events.length, start);
  await unchanged(source, target);
});
await row("binary range and early close stop actual HTTP body", "public-stream", async () => {
  const { source } = await seed();
  const large = new Uint8Array(2 * 1024 * 1024);
  for (let index = 0; index < large.length; index++) large[index] = index % 251;
  await app.native.writeFile(source, large);
  const bytes = await readBytes(app.dav.readStream(source, { start: 255, endExclusive: 512 }));
  assert.deepEqual(bytes, large.slice(255, 512));
  const stream = app.dav.readStream(source)[Symbol.asyncIterator]();
  assert.equal((await stream.next()).done, false);
  await stream.return?.(undefined);
  await delay(30);
  const get = events.findLast(event => event.method === "GET" && event.url === url(source))!;
  assert.equal(get.cancelled, true);
  assert.ok(get.downloadedBytes < large.length);
});
await row("inflight download abort closes HTTP body without source mutation", "public-cancel", async () => {
  const { source } = await seed();
  const large = new Uint8Array(2 * 1024 * 1024).fill(203);
  await app.native.writeFile(source, large);
  const controller = new AbortController();
  const stream = app.dav.readStream(source, { signal: controller.signal })[Symbol.asyncIterator]();
  await stream.next(); controller.abort();
  await assert.rejects(stream.next(), isCode("ECANCELED"));
  await stream.return?.(undefined);
  await delay(30);
  const get = events.findLast(event => event.method === "GET" && event.url === url(source))!;
  assert.ok(get.aborted || get.cancelled);
  assert.deepEqual(await app.native.readFile(source), large);
});
await row("response quota rejects instead of returning a prefix", "public-quota", async () => {
  const { source } = await seed();
  const filesystem = new WebDavFileSystem({ ...settings, maxResponseBytes: 4 });
  await assert.rejects(filesystem.readFile(source));
  assert.deepEqual(await app.native.readFile(source), payload);
});
await row("first directory timestamp never reports unretained success", "public-timestamp-postcondition", async () => {
  const path = `/ind-directory-${++sequence}`;
  paths.push(path);
  await app.native.mkdir(path);
  const requested = 1_700_000_000_123;
  let error: unknown;
  try { await app.dav.utimes(path, requested, requested); } catch (caught) { error = caught; }
  const observed = await app.dav.stat(path);
  observations.push({ kind: "timestamp", requested, observed, error: error instanceof FsError ? error.code : String(error) });
  if (error) assert.ok(isCode("EAGAIN")(error) || provider === "wsgidav" && isCode("ENOTSUP")(error));
  else { assert.equal(observed.atimeMs, requested); assert.equal(observed.mtimeMs, requested); }
});
await writeFile(`${evidence}/independent.json`, JSON.stringify({ provider, rows, observations, imports: { root: import.meta.resolve("virtual-bash"), webdav: import.meta.resolve("virtual-bash/fs/webdav") } }, null, 2) + "\n");
