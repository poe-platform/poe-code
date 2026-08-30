import assert from "node:assert/strict";
import { readFile, writeFile, appendFile, readdir, readlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { FsError, WebDavFileSystem as RootWebDav, RealFileSystem, Shell, standardCommands, createMemoryFileSystem, createMountFileSystem, createReadOnlyFileSystem } from "virtual-bash";
import { WebDavFileSystem } from "virtual-bash/fs/webdav";
import type { WebDavFileSystemOptions, WebDavFetch } from "virtual-bash/fs/webdav";
import { createApplication, type LiteralConfiguration } from "./example.mjs";
import { createHttpsFetch, type WireObservation } from "./https.mjs";

const config: LiteralConfiguration = JSON.parse(await readFile(process.argv[2]!, "utf8"));
const evidence = process.argv[3]!;
const provider = process.argv[4]!;
const events: WireObservation[] = [];
const app = await createApplication(config, events);
const bytes = new Uint8Array(Array.from({ length: 256 }, (_, index) => index));
const text = (value: string) => new TextEncoder().encode(value);
const pause = (delay = 40) => new Promise<void>(resolve => setTimeout(resolve, delay));
const settle = () => provider === "apache" ? pause(2100) : Promise.resolve();
const headers = { Authorization: config.authorization };
const options: WebDavFileSystemOptions = { baseUrl: config.baseUrl, fetch: app.fetch, headers, timeoutMs: 5000 };
const plain = new WebDavFileSystem(options);
const raw = async (method: string, path: string, extra: RequestInit = {}) => app.fetch(new URL(path, config.baseUrl).href,
  { ...extra, method, headers: { ...headers, ...Object.fromEntries(new Headers(extra.headers)) }, redirect: "manual", credentials: "omit" });
const rejectCode = (code: string) => (error: unknown) => { assert.ok(error instanceof FsError); assert.equal(error.code, code); return true; };
const rows: { name: string; kind: string; result: string; detail?: unknown; events: number[]; witnesses?: unknown }[] = [];
const observations: Record<string, unknown> = {};
async function witness(path = config.serverRoot): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === ".DAV") continue;
    const full = `${path}/${entry.name}`;
    if (entry.isDirectory()) result[entry.name] = await witness(full);
    else if (entry.isSymbolicLink()) result[entry.name] = { symlink: await readlink(full) };
    else if (entry.isFile()) {
      const data = await readFile(full);
      result[entry.name] = { size: data.length, sha256: createHash("sha256").update(data).digest("hex"), ...(data.length <= 1024 ? { base64: data.toString("base64") } : {}) };
    }
  }
  return result;
}
async function row(name: string, kind: "positive" | "guard" | "refusal", operation: () => Promise<void>) {
  const start = events.length;
  let detail: unknown;
  try { await operation(); }
  catch (error) { detail = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack, ...(error instanceof FsError ? { code: error.code, syscall: error.syscall, path: error.path, cause: String(error.cause) } : {}) } : String(error); }
  const operationEnd = events.length;
  const methods = events.slice(start, operationEnd).map(event => event.method);
  const lockObservations = [];
  for (const event of events.slice(start, operationEnd).filter(event => event.method === "LOCK")) {
    const response = await app.fetch(event.url, { method: "PROPFIND", headers: { ...headers, Depth: "0", "Content-Type": "application/xml" }, body: '<d:propfind xmlns:d="DAV:"><d:prop><d:lockdiscovery/></d:prop></d:propfind>', redirect: "manual", credentials: "omit" });
    lockObservations.push({ url: event.url, status: response.status, xml: await response.text() });
  }
  const result = { name, kind, result: detail ? "fail" : "pass", ...(detail ? { detail } : {}), events: [start, operationEnd], methods, nativeTransferDispatched: methods.some(method => method === "COPY" || method === "MOVE"), lockObservations, witnesses: await witness() };
  rows.push(result);
  await appendFile(`${evidence}/consumer.jsonl`, `${JSON.stringify(result)}\n`);
  console.log(`${result.result} ${kind}: ${name}`);
}

await row("packed root and subpath public exports", "positive", async () => {
  assert.equal(RootWebDav, WebDavFileSystem);
  observations.publicImports = Object.fromEntries(["virtual-bash", "virtual-bash/fs/webdav"].map(name => [name, import.meta.resolve(name)]));
  for (const name of ["virtual-bash", "virtual-bash/fs/webdav"]) {
    assert.match(fileURLToPath(import.meta.resolve(name)), /consumer\/node_modules\/virtual-bash\/dist\//);
  }
  assert.equal(plain.capabilities.atomicRename, false);
  assert.equal(plain.capabilities.permissions, false);
});
await row("HTTP Authorization and Cookie remain forbidden", "guard", async () => {
  for (const name of ["Authorization", "Cookie"]) assert.throws(() => new WebDavFileSystem({ ...options, baseUrl: "http://127.0.0.1:1/dav/", headers: { [name]: "fixture" } }), rejectCode("EINVAL"));
});
await row("binary UTF8 percent space XML names and full listing", "positive", async () => {
  await plain.mkdir("/names/deep", { recursive: true });
  for (const name of ["binary", "snow 雪.txt", "100% complete & <tag>.txt"]) {
    await plain.writeFile(`/names/${name}`, bytes, { flag: "wx" });
    assert.deepEqual(await plain.readFile(`/names/${name}`), bytes);
  }
  assert.deepEqual((await plain.readdir("/names/")).map(entry => entry.name), ["100% complete & <tag>.txt", "binary", "deep", "snow 雪.txt"]);
  assert.equal((await plain.stat("/names/deep/")).type, "directory");
  assert.equal((await plain.lstat("/names/binary")).size, 256);
});
await row("empty bytes and absent native COPY MOVE DELETE", "positive", async () => {
  await plain.writeFile("/empty-bytes", new Uint8Array());
  assert.equal((await plain.readFile("/empty-bytes")).length, 0);
  await plain.copyFile("/names/binary", "/native-copy");
  await plain.rename("/native-copy", "/native-moved");
  assert.deepEqual(await plain.readFile("/native-moved"), bytes);
  await assert.rejects(plain.stat("/native-copy"), rejectCode("ENOENT"));
  await plain.rm("/native-moved");
  await assert.rejects(plain.stat("/native-moved"), rejectCode("ENOENT"));
});
await row("native collection MOVE and explicit recursive DELETE", "positive", async () => {
  await plain.mkdir("/collection/sub", { recursive: true });
  await plain.writeFile("/collection/sub/file", bytes);
  await plain.rename("/collection", "/collection-moved");
  assert.deepEqual(await plain.readFile("/collection-moved/sub/file"), bytes);
  await assert.rejects(plain.stat("/collection"), rejectCode("ENOENT"));
  await plain.rm("/collection-moved", { recursive: true });
  await assert.rejects(plain.stat("/collection-moved"), rejectCode("ENOENT"));
});
for (const policy of ["lock", "etag"] as const) for (const operation of ["copyFile", "rename"] as const) {
  await row(`${policy} native ${operation} existing target using provider validators`, "positive", async () => {
    const filesystem = policy === "lock" ? plain : new WebDavFileSystem({ ...options, overwritePolicy: "etag" });
    const source = `/${policy}-${operation}-source`, target = `/${policy}-${operation}-target`;
    await plain.writeFile(source, bytes); await plain.writeFile(target, text("OLD"));
    await settle();
    await filesystem[operation](source, target);
    assert.deepEqual(await plain.readFile(target), bytes);
    if (operation === "rename") await assert.rejects(plain.stat(source), rejectCode("ENOENT"));
    else assert.deepEqual(await plain.readFile(source), bytes);
    const locks = await raw("PROPFIND", target.slice(1), { headers: { Depth: "0", "Content-Type": "application/xml" }, body: '<d:propfind xmlns:d="DAV:"><d:prop><d:lockdiscovery/></d:prop></d:propfind>' });
    assert.equal(locks.status, 207);
    assert.doesNotMatch(await locks.text(), /<(?:[\w-]+:)?activelock[ >]/);
  });
}
await row("exclusive create and COPY preserve existing bytes", "guard", async () => {
  await plain.writeFile("/exclusive", bytes, { flag: "wx" });
  await assert.rejects(plain.writeFile("/exclusive", text("BAD"), { flag: "wx" }), rejectCode("EEXIST"));
  await assert.rejects(plain.copyFile("/empty-bytes", "/exclusive", { exclusive: true }), rejectCode("EEXIST"));
  assert.deepEqual(await plain.readFile("/exclusive"), bytes);
});
await row("conditional append after provider validator stabilization", "positive", async () => {
  await plain.writeFile("/append", bytes); await settle();
  await plain.appendFile("/append", text("tail"));
  assert.deepEqual(await plain.readFile("/append"), new Uint8Array([...bytes, ...text("tail")]));
});
await row("file PROPPATCH persists virtual timestamps not native times", "positive", async () => {
  await plain.writeFile("/metadata", bytes); await settle();
  const nativeBefore = await app.native.stat("/metadata");
  await plain.utimes("/metadata", 1234.5, -6789);
  const remote = await new WebDavFileSystem(options).stat("/metadata");
  assert.equal(remote.atimeMs, 1234.5); assert.equal(remote.mtimeMs, -6789);
  assert.equal((await app.native.stat("/metadata")).mtimeMs, nativeBefore.mtimeMs);
  assert.deepEqual(await plain.readFile("/metadata"), bytes);
});
await row("directory timestamps provider-specific support", provider === "wsgidav" ? "refusal" : "positive", async () => {
  await plain.mkdir("/directory-times"); await settle();
  if (provider === "wsgidav") await assert.rejects(plain.utimes("/directory-times", 10, 20), rejectCode("ENOTSUP"));
  else {
    const inspect = async () => {
      const response = await raw("PROPFIND", "directory-times/", { headers: { Depth: "0", "Content-Type": "application/xml" }, body: '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><v:timestamps xmlns:v="urn:virtual-bash:metadata"/></d:prop></d:propfind>' });
      return { status: response.status, xml: await response.text(), native: await app.native.stat("/directory-times"), nativeChildren: await app.native.readdir("/directory-times") };
    };
    const before = await inspect();
    try { await plain.utimes("/directory-times", 10, 20); }
    finally { observations.directoryMetadata = { before, after: await inspect() }; }
    assert.equal((await plain.stat("/directory-times")).mtimeMs, 20);
  }
});
if (provider === "apache") await row("directory timestamp mismatch reports EAGAIN without retry or byte loss", "guard", async () => {
  await plain.mkdir("/directory-postcondition");
  await plain.writeFile("/directory-postcondition/sentinel", bytes); await settle();
  const start = events.length;
  await assert.rejects(plain.utimes("/directory-postcondition", 10, 20), rejectCode("EAGAIN"));
  assert.deepEqual(events.slice(start).map(event => event.method), ["PROPFIND", "PROPPATCH", "PROPFIND"]);
  assert.deepEqual(await app.native.readFile("/directory-postcondition/sentinel"), bytes);
});
await row("directory timestamp second update after metadata-store initialization", provider === "wsgidav" ? "refusal" : "positive", async () => {
  await settle();
  if (provider === "wsgidav") await assert.rejects(plain.utimes("/directory-times", 30, 40), rejectCode("ENOTSUP"));
  else { await plain.utimes("/directory-times", 30, 40); assert.equal((await plain.stat("/directory-times")).mtimeMs, 40); }
});
await row("404 bad authentication and configured readonly 403", "guard", async () => {
  await assert.rejects(plain.readFile("/missing"), rejectCode("ENOENT"));
  const bad = new WebDavFileSystem({ ...options, headers: { Authorization: `Basic ${Buffer.from("fixture:wrong").toString("base64")}` } });
  await assert.rejects(bad.stat("/names/binary"), rejectCode("EACCES"));
  const readonly = new WebDavFileSystem({ ...options, baseUrl: new URL("/readonly/", config.baseUrl).href });
  await assert.rejects(readonly.writeFile("/forbidden", bytes), rejectCode("EACCES"));
  await assert.rejects(app.native.stat("/forbidden"), rejectCode("ENOENT"));
  assert.ok(events.some(event => event.status === 401)); assert.ok(events.some(event => event.status === 403));
});
await row("empty rmdir refusal and no recursive fallback", "refusal", async () => {
  await plain.mkdir("/keep-empty");
  const start = events.length;
  await assert.rejects(plain.rmdir("/keep-empty"), rejectCode("ENOTSUP"));
  assert.ok(events.slice(start).every(event => event.method === "PROPFIND"));
  assert.equal((await app.native.stat("/keep-empty")).type, "directory");
});
await row("permissions and access advisory limitations", "refusal", async () => {
  await plain.access("/names/binary", 4);
  await assert.rejects(plain.access("/names/binary", 2), rejectCode("ENOTSUP"));
  await assert.rejects(plain.chmod("/names/binary", 0o600), rejectCode("ENOTSUP"));
});
await row("response XML and entry budgets reject rather than truncate", "guard", async () => {
  await assert.rejects(new WebDavFileSystem({ ...options, maxXmlBytes: 32 }).stat("/names/binary"), rejectCode("EFBIG"));
  await assert.rejects(new WebDavFileSystem({ ...options, maxEntries: 2 }).readdir("/names"), rejectCode("EFBIG"));
  await assert.rejects(new WebDavFileSystem({ ...options, maxResponseBytes: 32 }).readFile("/names/binary"), rejectCode("EFBIG"));
});
await row("Shell VFS UTF8 pipeline and cross-view existing cp", "positive", async () => {
  await app.native.writeFile("/shell-target", text("OLD"));
  const result = await app.shell.exec("printf 'hello 雪\\n' | cat > /dav/shell-source; cp /dav/shell-source /native/shell-target; cat /dav/shell-target | cat");
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "hello 雪\n");
  assert.deepEqual(await app.native.readFile("/shell-target"), text("hello 雪\n"));
});
await row("Shell binary pipelines and native-to-WebDAV existing cp", "positive", async () => {
  await plain.writeFile("/shell-binary-target", text("OLD"));
  const result = await app.shell.exec("cat /dav/names/binary | cat > /dav/pipeline-binary; cp /native/names/binary /dav/shell-binary-target");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await app.native.readFile("/pipeline-binary"), bytes);
  assert.deepEqual(await plain.readFile("/shell-binary-target"), bytes);
});
await row("Shell MOVE across truthful views", "positive", async () => {
  await app.native.writeFile("/shell-mv-source", bytes);
  const result = await app.shell.exec("mv /native/shell-mv-source /dav/shell-mv-target");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await plain.readFile("/shell-mv-target"), bytes);
  await assert.rejects(app.native.stat("/shell-mv-source"), rejectCode("ENOENT"));
});
await row("registered aliases hardlinks and symlinks retain native identity", "guard", async () => {
  await app.native.writeFile("/identity", bytes);
  await app.native.link("/identity", "/hardlink");
  await app.native.symlink("identity", "/symlink");
  for (const path of ["/identity", "/hardlink", "/symlink"]) {
    assert.deepEqual(await app.alias.readFile(path), bytes);
    assert.equal(await app.dav.compareEntry("/identity", app.alias, path), "same");
    const result = await app.shell.exec(`cp /dav/identity /alias${path}`);
    assert.notEqual(result.exitCode, 0); assert.match(result.stderr, /same/i);
    assert.deepEqual(await app.native.readFile("/identity"), bytes);
  }
  assert.equal((await app.native.lstat("/symlink")).type, "symlink");
  assert.equal((await app.dav.lstat("/symlink")).type, "file");
});
await row("unknown arbitrary Real/WebDAV relationship cannot overwrite", "guard", async () => {
  await app.native.writeFile("/unknown-target", text("PRESERVE"));
  const unknown = new RealFileSystem({ root: config.serverRoot });
  assert.equal(await app.dav.compareEntry("/identity", unknown, "/unknown-target"), "unknown");
  const filesystem = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dav": app.dav, "/unknown": unknown } });
  const result = await new Shell({ fs: filesystem }).use(standardCommands()).exec("cp /dav/identity /unknown/unknown-target");
  assert.notEqual(result.exitCode, 0); assert.match(result.stderr, /not supported/i);
  assert.deepEqual(await unknown.readFile("/unknown-target"), text("PRESERVE"));
});
await row("readonly composition keeps alias identity and mutation policy", "guard", async () => {
  const readonly = createReadOnlyFileSystem(app.alias);
  const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/remote": app.dav, "/readonly": readonly } });
  assert.equal(await mounted.compareEntry("/remote/identity", mounted, "/readonly/hardlink"), "same");
  await assert.rejects(readonly.writeFile("/identity", text("BAD")), rejectCode("EROFS"));
  assert.deepEqual(await app.native.readFile("/identity"), bytes);
});
await row("streamed upload copies producer chunks and waits for drain", "positive", async () => {
  const chunk = new Uint8Array(65536);
  const expected = new Uint8Array(chunk.length * 16);
  async function* producer() {
    for (let index = 0; index < 16; index++) { chunk.fill(index); expected.fill(index, index * chunk.length, (index + 1) * chunk.length); yield chunk; }
  }
  await plain.writeStream("/stream-upload", producer(), { flag: "wx" });
  assert.deepEqual(await plain.readFile("/stream-upload"), expected);
  const event = events.findLast(event => event.method === "PUT" && event.url.endsWith("/stream-upload"))!;
  assert.equal(event.uploadedBytes, expected.length); assert.ok(event.drains > 0);
});
await row("stream range chunks paused consumer and early return", "positive", async () => {
  const large = new Uint8Array(4 * 1024 * 1024).fill(37);
  await app.native.writeFile("/large", large);
  const source = plain.readStream("/large", { start: 10, endExclusive: large.length - 10, chunkSize: 16384 });
  try {
    const first = await source.next(); assert.ok(first.value instanceof Uint8Array);
    const firstChunk: Uint8Array = first.value;
    assert.ok(firstChunk.byteLength > 0 && firstChunk.byteLength <= 16384);
    assert.ok(firstChunk.every(value => value === 37));
    const event = events.findLast(event => event.method === "GET" && event.url.endsWith("/large"))!;
    const downloaded = event.downloadedBytes, pulls = event.pulls;
    await pause(); assert.equal(event.downloadedBytes, downloaded); assert.equal(event.pulls, pulls);
    assert.ok(downloaded <= 256 * 1024);
    await source.return(undefined); assert.ok(event.cancelled); assert.ok(downloaded < large.length);
  } finally { await source.return(undefined); }
  const chunks: Uint8Array[] = [];
  for await (const chunk of plain.readStream("/names/binary", { start: 2, endExclusive: 19, chunkSize: 5 })) { assert.ok(chunk.length <= 5); chunks.push(chunk); }
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(bytes.slice(2, 19)));
});
await row("pre-abort has no requests or file effects", "guard", async () => {
  const count = events.length;
  await assert.rejects(plain.writeFile("/pre-abort", bytes, { signal: AbortSignal.abort(new FsError("ENOENT")) }), rejectCode("ECANCELED"));
  assert.equal(events.length, count); await assert.rejects(app.native.stat("/pre-abort"), rejectCode("ENOENT"));
});
await row("active download abort while consumer paused", "guard", async () => {
  const controller = new AbortController();
  const stream = plain.readStream("/large", { signal: controller.signal });
  await stream.next(); controller.abort(new Error("fixture stop"));
  await assert.rejects(stream.next(), rejectCode("ECANCELED"));
  assert.ok(events.findLast(event => event.url.endsWith("/large") && event.method === "GET")!.aborted);
});
await row("per-request timeout closes a paused real download", "guard", async () => {
  const filesystem = new WebDavFileSystem({ ...options, timeoutMs: 250 });
  const stream = filesystem.readStream("/large");
  try {
    await stream.next(); await pause(350);
    await assert.rejects(stream.next(), rejectCode("ETIMEDOUT"));
    assert.ok(events.findLast(event => event.url.endsWith("/large") && event.method === "GET")!.aborted);
  } finally { await stream.return(undefined); }
});
await row("late real response settlement is observed and cancelled", "guard", async () => {
  let entered!: () => void;
  const arrived = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const controller = new AbortController();
  const delayed: WebDavFetch = async (url, init) => {
    const response = await app.fetch(url, init);
    if (init.method === "GET") { entered(); await gate; }
    return response;
  };
  const filesystem = new WebDavFileSystem({ ...options, fetch: delayed });
  const checking = assert.rejects(filesystem.readFile("/large", { signal: controller.signal }), rejectCode("ECANCELED"));
  await arrived; controller.abort(); await checking; release(); await pause();
  const event = events.findLast(event => event.url.endsWith("/large") && event.method === "GET")!;
  assert.ok(event.aborted); assert.ok(event.downloadedBytes < 4 * 1024 * 1024);
});
await row("upload cancellation bounds wait without rollback promise", "guard", async () => {
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  async function* producer() { yield new Uint8Array(65536).fill(88); entered(); await gate; yield bytes; }
  const checking = assert.rejects(plain.writeStream("/cancel-upload", producer(), { signal: controller.signal }), rejectCode("ECANCELED"));
  await started; controller.abort(); await checking; release(); await pause(100);
  assert.ok(events.findLast(event => event.url.endsWith("/cancel-upload") && event.method === "PUT")!.aborted);
});
await row("TLS rejects unrelated CA and has no global mutation", "guard", async () => {
  const broken = createHttpsFetch(new URL(config.baseUrl).origin, new Uint8Array());
  await assert.rejects(broken(config.baseUrl, { method: "PROPFIND", redirect: "manual", credentials: "omit" }));
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
  assert.equal((await plain.stat("/names/binary")).size, 256);
});

const summary = Object.fromEntries(["positive", "guard", "refusal"].map(kind => [kind, { pass: rows.filter(row => row.kind === kind && row.result === "pass").length, fail: rows.filter(row => row.kind === kind && row.result === "fail").length }]));
await writeFile(`${evidence}/consumer.json`, JSON.stringify({ provider, summary, rows, events, observations }, null, 2), { flag: "wx" });
console.log(JSON.stringify(summary));
