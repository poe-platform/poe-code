import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { standardCommands } from "../../../src/commands/index.js";
import { FsError } from "../../../src/contracts/errors.js";
import type { FileStat, FileSystem } from "../../../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { compareEntries, resolveEntryView } from "../../../src/fs/mount/comparison.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { MockS3Client, S3FileSystem, createS3Transport, S3ServiceError } from "../../../src/fs/s3/index.js";
import type { S3HeadOutput, S3Transport } from "../../../src/fs/s3/index.js";
import { getOwnedS3Entry } from "../../../src/fs/s3/authority.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { getOwnedWebDavEntry } from "../../../src/fs/webdav/resource-id.js";
import { Shell } from "../../../src/shell/index.js";
import { MockDav, multistatus, resource, xmlResponse } from "../webdav/mock.js";

const sourceBytes = new Uint8Array([0, 255, 19, 65, 10, 128]);
const targetBytes = new Uint8Array([79, 76, 68, 0]);
const keepBytes = new Uint8Array([75, 69, 69, 80]);
const options = { timeout: 5000 };

function opaque<Backend extends object>(backend: Backend, overrides: Partial<Backend> = {}): Backend {
  return new Proxy(backend, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

function mounted(left: FileSystem, right: FileSystem) {
  return createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
}

async function seed(filesystem: FileSystem) {
  await filesystem.writeFile("/source", sourceBytes);
  await filesystem.writeFile("/target", targetBytes);
  await filesystem.writeFile("/keep", keepBytes);
}

async function contents(filesystem: FileSystem) {
  return Object.fromEntries(await Promise.all((await filesystem.readdir("/")).map(async entry => [entry.name,
    entry.type === "file" ? [...await filesystem.readFile(`/${entry.name}`, { maxBytes: 1024 })] : entry.type])));
}

const original = () => ({ source: [...sourceBytes], target: [...targetBytes], keep: [...keepBytes] });
const copied = () => ({ ...original(), target: [...sourceBytes] });
const observe = (name: string, value: unknown) => console.log(JSON.stringify({ review: name, value }));

async function failure(action: Promise<unknown>, code: string) {
  let caught: unknown;
  try { await action; } catch (error) { caught = error; }
  assert.ok(caught instanceof FsError, `expected typed ${code}`);
  observe("error", { code: caught.code, path: caught.path, dest: caught.dest, syscall: caught.syscall });
  assert.equal(caught.code, code);
}

function s3(store = new MockS3Client({ buckets: ["bucket"] }), transport: S3Transport = opaque(store)) {
  return { store, fs: new S3FileSystem({ bucket: "bucket", transport }) };
}

function dav(store = new MockDav()) {
  return { store, fs: new WebDavFileSystem({ baseUrl: "https://same.invalid/dav/", fetch: (url, init) => store.fetch(url, init), timeoutMs: 1000 }) };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

test("01 faithful opaque S3 readonly source executes shell cp over existing target", options, async () => {
  const { store, fs } = s3();
  await seed(fs);
  const other = s3(store).fs;
  const mount = mounted(createReadOnlyFileSystem(fs), other);
  const result = await new Shell({ fs: mount }).use(standardCommands()).exec("cp /left/source /right/target");
  observe("01", { result, files: await contents(fs) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(await contents(fs), copied());
  await failure(mount.copyFile("/left/source", "/right/source"), "EINVAL");
  assert.deepEqual(await contents(fs), copied());
});

test("02 faithful opaque DAV instances execute existing-target cp and preserve aliases", options, async () => {
  const { store, fs } = dav();
  await seed(fs);
  const mount = mounted(fs, dav(store).fs);
  const result = await new Shell({ fs: mount }).use(standardCommands()).exec("cp /left/source /right/target");
  observe("02", { result, files: await contents(fs) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(await contents(fs), copied());
  await failure(mount.copyFile("/left/source", "/right/source"), "EINVAL");
  assert.deepEqual(await contents(fs), copied());
});

test("03 distinct Real instances share actual backing, permit distinct copy and reject hardlink alias", options, async () => {
  const directory = await mkdtemp(join(tmpdir(), "real-views-"));
  try {
    const left = await createRealFileSystem({ root: directory });
    const right = await createRealFileSystem({ root: directory });
    await seed(left);
    await left.link!("/source", "/alias");
    const mount = mounted(left, right);
    await mount.copyFile("/left/source", "/right/target");
    await failure(mount.copyFile("/left/source", "/right/alias"), "EINVAL");
    const expected = { ...copied(), alias: [...sourceBytes] };
    observe("03", await contents(left));
    assert.deepEqual(await contents(left), expected);
    assert.deepEqual(await contents(right), expected);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("04 actual distinct maps override identical URL bucket key and client hints", options, async () => {
  for (const make of [s3, dav]) {
    const left = make().fs;
    const right = make().fs;
    await seed(left);
    await seed(right);
    assert.equal(await compareEntries(left, "/source", right, "/source"), "distinct");
    await mounted(left, right).copyFile("/left/source", "/right/target");
    assert.deepEqual(await contents(left), original());
    assert.deepEqual(await contents(right), copied());
    observe("04", { backend: left.constructor.name, left: await contents(left), right: await contents(right) });
  }
});

test("05 legitimate Real DAV overlap refuses unknown, then truthful existing comparison permits distinct copy", options, async () => {
  const directory = await mkdtemp(join(tmpdir(), "real-dav-"));
  try {
    const real = await createRealFileSystem({ root: directory });
    await seed(real);
    const requests: string[] = [];
    const remote = new WebDavFileSystem({ baseUrl: "http://127.0.0.1/dav/", timeoutMs: 1000, fetch: async (url, init) => {
      const path = decodeURIComponent(new URL(url).pathname.slice(4)).replace(/\/$/, "") || "/";
      const method = init.method ?? "GET";
      const settings = init.signal ? { signal: init.signal } : {};
      requests.push(`${method} ${path}`);
      try {
        const stat = await real.stat(path, settings);
        if (method === "PROPFIND") return xmlResponse(multistatus(resource(`/dav${path}`, stat.type === "directory", stat.size)));
        if (method === "GET") return new Response(await real.readFile(path, { ...settings, maxBytes: 1024 }));
        if (method === "PUT" && init.body) {
          const body = new Uint8Array(await new Response(init.body).arrayBuffer());
          assert.ok(body.byteLength <= 1024);
          await real.writeFile(path, body, settings);
          return new Response(null, { status: 204 });
        }
        return new Response(null, { status: 405 });
      } catch (error) { if (error instanceof FsError && error.code === "ENOENT") return new Response(null, { status: 404 }); throw error; }
    } });
    assert.equal(await compareEntries(real, "/source", remote, "/source"), "unknown");
    await failure(mounted(real, remote).copyFile("/left/source", "/right/source"), "ENOTSUP");
    await failure(mounted(remote, real).copyFile("/left/source", "/right/source"), "ENOTSUP");
    assert.ok(requests.every(request => request.startsWith("PROPFIND ")));
    assert.deepEqual(await contents(real), original());
    observe("05 safe-refusal limitation, not positive overwrite credit", { requests, files: await contents(real) });
    remote.compareEntry = async (path, peer, peerPath, settings) => {
      if (peer !== real && peer !== remote) return "unknown";
      settings?.signal?.throwIfAborted();
      const own = await real.stat(path, settings);
      const other = await real.stat(peerPath, settings);
      settings?.signal?.throwIfAborted();
      if (own.identityScope !== other.identityScope || own.identityScope === undefined
        || ![own.dev, own.ino, other.dev, other.ino].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) return "unknown";
      return own.dev === other.dev && own.ino === other.ino ? "same" : "distinct";
    };
    await failure(mounted(real, remote).copyFile("/left/source", "/right/source"), "EINVAL");
    await mounted(real, remote).copyFile("/left/source", "/right/target");
    assert.deepEqual(await contents(real), copied());
    observe("05 existing FileSystem method, not future constructor option", { requests, files: await contents(real) });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("06 fresh S3 HEAD authority rejects cached response and FS path stat replay", options, async () => {
  const store = new MockS3Client({ buckets: ["bucket"] });
  let cached: S3HeadOutput | undefined;
  let replay = false;
  const transport = opaque(store, { headObject: async (input, settings) => {
    if (replay && input.Key === "source") return cached!;
    const output = await store.headObject(input, settings);
    if (input.Key === "source") cached = output;
    return output;
  } });
  const fs = s3(store, transport).fs;
  await seed(fs);
  const view = await resolveEntryView(fs, "/source");
  assert.ok(getOwnedS3Entry(view));
  assert.equal(getOwnedS3Entry({ ...view, filesystem: s3(store).fs }), undefined);
  assert.equal(getOwnedS3Entry({ ...view, path: "/target" }), undefined);
  assert.equal(getOwnedS3Entry({ ...view, stat: { ...view.stat } }), undefined);
  replay = true;
  assert.equal(getOwnedS3Entry(await resolveEntryView(fs, "/source")), undefined);
  const memory = createMemoryFileSystem();
  await seed(memory);
  await failure(mounted(memory, fs).copyFile("/left/source", "/right/source"), "ENOTSUP");
  replay = false;
  assert.ok(getOwnedS3Entry(await resolveEntryView(fs, "/source")));
  assert.deepEqual(await contents(fs), original());
  assert.deepEqual(await contents(memory), original());
  observe("06", { files: await contents(fs), replay: "unknown; restored fresh observation accepted" });
});

test("07 DAV response authority binds exact FS path stat and does not follow response clones", options, async () => {
  const store = new MockDav();
  let clone = false;
  const fs = new WebDavFileSystem({ baseUrl: "https://same.invalid/dav/", fetch: async (url, init) => {
    const response = await store.fetch(url, init);
    return clone ? response.clone() : response;
  } });
  await seed(fs);
  const view = await resolveEntryView(fs, "/source");
  assert.ok(getOwnedWebDavEntry(view));
  assert.equal(getOwnedWebDavEntry({ ...view, filesystem: dav(store).fs }), undefined);
  assert.equal(getOwnedWebDavEntry({ ...view, path: "/target" }), undefined);
  assert.equal(getOwnedWebDavEntry({ ...view, stat: { ...view.stat } }), undefined);
  clone = true;
  assert.equal(getOwnedWebDavEntry(await resolveEntryView(fs, "/source")), undefined);
  const memory = createMemoryFileSystem();
  await seed(memory);
  await failure(mounted(memory, fs).copyFile("/left/source", "/right/target"), "ENOTSUP");
  clone = false;
  assert.deepEqual(await contents(fs), original());
  assert.deepEqual(await contents(memory), original());
  observe("07", { files: await contents(fs), clone: "no provider-owned cross-protocol authority" });
});

test("08 late metadata denial and buffered body failure propagate EACCES without target effects", options, async () => {
  for (const stage of ["metadata", "body"] as const) {
    const store = new MockS3Client({ buckets: ["bucket"] });
    let armed = false;
    const transport = createS3Transport(store, { ...store.capabilities, streamingRead: false });
    const head = transport.headObject;
    const get = transport.getObject;
    transport.headObject = async (input, settings) => {
      if (armed && stage === "metadata" && input.Key === "source") throw new S3ServiceError("AccessDenied", 403);
      return head(input, settings);
    };
    transport.getObject = async (input, settings) => {
      if (armed && stage === "body") throw new S3ServiceError("AccessDenied", 403);
      return get(input, settings);
    };
    const fs = s3(store, transport).fs;
    const target = createMemoryFileSystem();
    await seed(fs);
    await seed(target);
    assert.equal(await compareEntries(fs, "/source", target, "/target"), "distinct");
    armed = true;
    await failure(mounted(fs, target).copyFile("/left/source", "/right/target"), "EACCES");
    armed = false;
    assert.deepEqual(await contents(fs), original());
    assert.deepEqual(await contents(target), original());
    observe("08", { stage, source: await contents(fs), target: await contents(target) });
  }
});

test("09 pending metadata cancellation preserves files and handles late rejection", options, async () => {
  const store = new MockS3Client({ buckets: ["bucket"] });
  const entered = deferred<void>();
  const pending = deferred<S3HeadOutput>();
  let armed = false;
  let suppliedSignal: AbortSignal | undefined;
  const transport = opaque(store, { headObject: async (input, settings) => {
    if (armed && input.Key === "source") { suppliedSignal = settings?.abortSignal; entered.resolve(); return pending.promise; }
    return store.headObject(input, settings);
  } });
  const fs = s3(store, transport).fs;
  const target = createMemoryFileSystem();
  await seed(fs);
  await seed(target);
  armed = true;
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "caller cancellation, not missing source" });
  const operation = mounted(fs, target).copyFile("/left/source", "/right/target", { signal: controller.signal });
  const rejection = failure(operation, "ECANCELED");
  await entered.promise;
  controller.abort(reason);
  await rejection;
  assert.ok(suppliedSignal?.aborted);
  pending.reject(new Error("late HEAD rejection"));
  await nextTurn();
  armed = false;
  assert.deepEqual(await contents(fs), original());
  assert.deepEqual(await contents(target), original());
  observe("09", { error: "ECANCELED", callerReasonCode: reason.code, source: await contents(fs), target: await contents(target) });
});

test("10 pending streamed body cancellation preserves source but permits already-truncated destination", options, async () => {
  const store = new MockS3Client({ buckets: ["bucket"] });
  const entered = deferred<void>();
  const pending = deferred<IteratorResult<Uint8Array>>();
  let armed = false;
  let returned = 0;
  let suppliedSignal: AbortSignal | undefined;
  const transport = opaque(store, { getObjectStream: async (input, settings) => {
    if (!armed) return store.getObjectStream(input, settings);
    suppliedSignal = settings?.abortSignal;
    return { Body: { [Symbol.asyncIterator]() { return {
      next() { entered.resolve(); return pending.promise; },
      async return() { returned++; return { done: true as const, value: undefined }; },
    }; } } };
  } });
  const fs = s3(store, transport).fs;
  const target = createMemoryFileSystem();
  await seed(fs);
  await seed(target);
  armed = true;
  const controller = new AbortController();
  const reason = new Error("body cancelled");
  const operation = mounted(fs, target).copyFile("/left/source", "/right/target", { signal: controller.signal });
  const rejection = assert.rejects(operation, error => error === reason);
  await entered.promise;
  controller.abort(reason);
  await rejection;
  pending.reject(new Error("late body rejection"));
  await nextTurn();
  assert.ok(suppliedSignal?.aborted);
  assert.equal(returned, 1);
  armed = false;
  assert.deepEqual(await contents(fs), original());
  assert.deepEqual(await contents(target), { ...original(), target: [] });
  observe("10 nontransactional destination effect", { error: reason.message, returned, source: await contents(fs), target: await contents(target) });
});

test("11 conflicting or invalid authorities fail EIO before content, known aliases still dominate", options, async () => {
  const memory = createMemoryFileSystem();
  await seed(memory);
  const strip = (stat: FileStat): FileStat => {
    const { identityScope, dev, ino, ...remaining } = stat;
    return remaining;
  };
  let reads = 0;
  const queries: string[] = [];
  const wrap = (answer: "same" | "distinct") => opaque<FileSystem>(memory, {
    stat: async (path, settings) => strip(await memory.stat(path, settings)),
    lstat: async (path, settings) => strip(await memory.lstat(path, settings)),
    compareEntry: async () => { queries.push(answer); return answer; },
    readFile: async () => { reads++; throw new Error("content must not be acquired"); },
  });
  await failure(mounted(wrap("same"), wrap("distinct")).copyFile("/left/source", "/right/target"), "EIO");
  assert.deepEqual(queries, ["same", "distinct"]);
  const invalid = opaque<FileSystem>(wrap("same"), { compareEntry: async () => "invalid" as "same" });
  await failure(mounted(invalid, wrap("distinct")).copyFile("/left/source", "/right/target"), "EIO");
  const alias = opaque<FileSystem>(memory, { compareEntry: async () => { throw new Error("complete aliases require no negotiation"); } });
  await failure(mounted(alias, memory).copyFile("/left/source", "/right/source"), "EINVAL");
  assert.equal(reads, 0);
  assert.deepEqual(await contents(memory), original());
  observe("11", { queries, reads, files: await contents(memory) });
});

test("12 readonly S3 and DAV destinations reject overwrite before body acquisition", options, async () => {
  for (const make of [s3, dav]) {
    const source = createMemoryFileSystem();
    const target = make().fs;
    await seed(source);
    await seed(target);
    let reads = 0;
    const reader = opaque<FileSystem>(source, {
      readFile: async () => { reads++; throw new Error("unexpected read"); },
      readStream: async function* () { reads++; throw new Error("unexpected stream read"); },
    });
    await failure(mounted(reader, createReadOnlyFileSystem(target)).copyFile("/left/source", "/right/target"), "EROFS");
    assert.equal(reads, 0);
    assert.deepEqual(await contents(source), original());
    assert.deepEqual(await contents(target), original());
    observe("12", { backend: target.constructor.name, reads, source: await contents(source), target: await contents(target) });
  }
});
