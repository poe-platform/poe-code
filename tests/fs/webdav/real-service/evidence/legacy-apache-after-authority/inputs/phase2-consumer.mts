import assert from "node:assert/strict";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { FsError } from "virtual-bash";
import { WebDavFileSystem } from "virtual-bash/fs/webdav";
import type { WebDavFileSystemOptions, WebDavFetch } from "virtual-bash/fs/webdav";
import { createApplication, type LiteralConfiguration } from "./example.mjs";
import type { WireObservation } from "./https.mjs";

const config: LiteralConfiguration = JSON.parse(await readFile(process.argv[2]!, "utf8"));
const evidence = process.argv[3]!;
const provider = process.argv[4]!;
const events: WireObservation[] = [];
const app = await createApplication(config, events);
const payload = new Uint8Array([0, 255, 128, 65, 13, 10]);
const original = new Uint8Array([79, 76, 68]);
const paths = new Set<string>();
const observations: unknown[] = [];
const rows: { name: string; kind: string; result: string; detail?: unknown; methods: string[]; witnesses: unknown }[] = [];
const settings: WebDavFileSystemOptions = { baseUrl: config.baseUrl, fetch: app.fetch, headers: { Authorization: config.authorization }, timeoutMs: 5000 };
const reject = (code: string) => (error: unknown) => { assert.ok(error instanceof FsError); assert.equal(error.code, code); return true; };
const sleep = (delay: number) => new Promise<void>(resolve => setTimeout(resolve, delay));
async function seed(name: string) {
  const source = `/phase2-${name}-source`, target = `/phase2-${name}-target`;
  paths.add(source); paths.add(target);
  await app.native.writeFile(source, payload); await app.native.writeFile(target, original);
  return { source, target };
}
async function witnesses() {
  const output: Record<string, unknown> = {};
  for (const path of paths) {
    try {
      const stat = await app.native.lstat(path);
      output[path] = { type: stat.type, dev: stat.dev, ino: stat.ino, nlink: stat.nlink,
        bytes: [...await app.native.readFile(path)], ...(stat.type === "symlink" ? { target: await app.native.readlink(path) } : {}) };
    } catch (error) { output[path] = { error: error instanceof FsError ? error.code : String(error) }; }
  }
  return output;
}
async function row(name: string, kind: "positive" | "guard", operation: () => Promise<void>) {
  const start = events.length;
  let detail: unknown;
  try { await operation(); }
  catch (error) { detail = { message: String(error), ...(error instanceof FsError ? { code: error.code, path: error.path } : {}) }; }
  const result = { name, kind, result: detail ? "fail" : "pass", ...(detail ? { detail } : {}), methods: events.slice(start).map(event => event.method), witnesses: await witnesses() };
  rows.push(result); await appendFile(`${evidence}/phase2-consumer.jsonl`, `${JSON.stringify(result)}\n`);
  console.log(`${result.result} ${kind}: ${name}`);
}
const wire: WebDavFetch = (url, init) => app.fetch(url, { ...init, headers: { Authorization: config.authorization, ...Object.fromEntries(new Headers(init.headers)) }, redirect: "manual", credentials: "omit" });
const url = (path: string) => new URL(path.slice(1), config.baseUrl).href;
const lockBody = '<d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype></d:lockinfo>';
async function acquire(path: string) {
  const response = await wire(url(path), { method: "LOCK", headers: { Depth: "infinity", Timeout: "Second-60", "Content-Type": "application/xml" }, body: lockBody });
  const body = await response.text();
  observations.push({ method: "LOCK", path, status: response.status, headers: Object.fromEntries(response.headers), body });
  assert.equal(response.status, 200);
  return response.headers.get("lock-token")!;
}
async function unlock(path: string, token: string) {
  const response = await wire(url(path), { method: "UNLOCK", headers: { "Lock-Token": token.startsWith("<") ? token : `<${token}>` } });
  observations.push({ method: "UNLOCK", path, status: response.status, body: await response.text() });
}
async function discovery(path: string) {
  const response = await wire(url(path), { method: "PROPFIND", headers: { Depth: "0", "Content-Type": "application/xml" }, body: '<d:propfind xmlns:d="DAV:"><d:prop><d:lockdiscovery/></d:prop></d:propfind>' });
  const body = await response.text(); observations.push({ method: "PROPFIND-locks", path, status: response.status, body });
  return body;
}

for (const operation of ["copyFile", "rename"] as const) {
  await row(`default direct ${operation} distinct entries with truthful callback`, "positive", async () => {
    const { source, target } = await seed(`distinct-${operation}`);
    await app.dav[operation](source, target);
    assert.deepEqual(await app.native.readFile(target), payload);
    if (operation === "rename") await assert.rejects(app.native.stat(source), reject("ENOENT"));
    else assert.deepEqual(await app.native.readFile(source), payload);
    assert.doesNotMatch(await discovery(target), /<(?:[\w-]+:)?activelock[ >]/);
  });
  for (const alias of ["hardlink", "symlink"] as const) {
    await row(`direct ${operation} ${alias} rejects known same before LOCK or mutation`, "guard", async () => {
      const { source, target } = await seed(`${operation}-${alias}`);
      await app.native.rm(target);
      if (alias === "hardlink") await app.native.link(source, target);
      else await app.native.symlink(source.slice(1), target);
      const start = events.length;
      await assert.rejects(app.dav[operation](source, target), reject("EINVAL"));
      assert.ok(events.slice(start).every(event => event.method === "PROPFIND"));
      assert.deepEqual(await app.native.readFile(source), payload); assert.deepEqual(await app.native.readFile(target), payload);
      assert.equal((await app.native.lstat(target)).type, alias === "symlink" ? "symlink" : "file");
    });
  }
  for (const outcome of ["error", "unknown", "cancel"] as const) {
    await row(`direct ${operation} callback ${outcome} precedes acquisition/effects`, "guard", async () => {
      const { source, target } = await seed(`${operation}-${outcome}`);
      const controller = new AbortController(); let calls = 0;
      const filesystem = new WebDavFileSystem({ ...settings, compareEntry: async function(path, peer, peerPath, options) {
        calls++; assert.equal(this, filesystem); assert.equal(peer, filesystem); assert.equal(path, source); assert.equal(peerPath, target);
        assert.equal(options?.signal, controller.signal);
        if (outcome === "error") throw new FsError("EACCES");
        if (outcome === "cancel") { controller.abort(new FsError("ECANCELED")); return "distinct"; }
        return "unknown";
      } });
      const start = events.length;
      await assert.rejects(filesystem[operation](source, target, { signal: controller.signal }), reject(outcome === "error" ? "EACCES" : outcome === "cancel" ? "ECANCELED" : "ENOTSUP"));
      assert.equal(calls, 1); assert.ok(events.slice(start).every(event => event.method === "PROPFIND"));
      assert.deepEqual(await app.native.readFile(source), payload); assert.deepEqual(await app.native.readFile(target), original);
    });
  }
}
await row("direct lexical self-rename still observes callback error", "guard", async () => {
  const { source } = await seed("self-error");
  const filesystem = new WebDavFileSystem({ ...settings, compareEntry: async () => { throw new FsError("EACCES"); } });
  await assert.rejects(filesystem.rename(source, source), reject("EACCES"));
  assert.deepEqual(await app.native.readFile(source), payload);
});
await row("direct known lexical identity cannot be overridden as distinct", "guard", async () => {
  const { source } = await seed("self-conflict");
  const filesystem = new WebDavFileSystem({ ...settings, compareEntry: async () => "distinct" });
  await assert.rejects(filesystem.rename(source, source), reject("EIO"));
  assert.deepEqual(await app.native.readFile(source), payload);
});
await row("raw destination lock rejects an alias URL write", "guard", async () => {
  const { target } = await seed("locked-url-alias");
  const token = await acquire(target);
  try {
    const response = await wire(new URL(target.slice(1), config.aliasUrl).href, { method: "PUT", body: payload });
    observations.push({ method: "PUT-alias", path: target, status: response.status, body: await response.text() });
    assert.equal(response.status, 423);
    assert.deepEqual(await app.native.readFile(target), original);
  } finally { await discovery(target); await unlock(target, token); }
});
await row("default overwrite cannot take another client's destination lock", "guard", async () => {
  const { source, target } = await seed("locked-conflict");
  const token = await acquire(target);
  try {
    await assert.rejects(app.dav.copyFile(source, target), reject("EBUSY"));
    assert.deepEqual(await app.native.readFile(source), payload); assert.deepEqual(await app.native.readFile(target), original);
  } finally { await discovery(target); await unlock(target, token); }
});
await row("late real LOCK cancellation cleans its grant without transfer", "guard", async () => {
  const { source, target } = await seed("late-lock");
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const controller = new AbortController();
  const delayed: WebDavFetch = async (url, init) => {
    const response = await app.fetch(url, init);
    if (init.method === "LOCK") { enter(); await gate; }
    return response;
  };
  const filesystem = new WebDavFileSystem({ ...settings, fetch: delayed });
  const start = events.length;
  const checking = assert.rejects(filesystem.copyFile(source, target, { signal: controller.signal }), reject("ECANCELED"));
  await entered; controller.abort();
  try { await checking; } finally { release(); }
  await sleep(100);
  assert.ok(!events.slice(start).some(event => event.method === "COPY"));
  assert.deepEqual(await app.native.readFile(source), payload); assert.deepEqual(await app.native.readFile(target), original);
  assert.doesNotMatch(await discovery(target), /<(?:[\w-]+:)?activelock[ >]/);
});
await writeFile(`${evidence}/phase2-consumer.json`, JSON.stringify({ provider, rows, events, observations, publicImports: { root: import.meta.resolve("virtual-bash"), webdav: import.meta.resolve("virtual-bash/fs/webdav") } }, null, 2), { flag: "wx" });
