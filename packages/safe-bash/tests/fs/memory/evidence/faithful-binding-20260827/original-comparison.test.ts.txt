import assert from "node:assert/strict";
import test from "node:test";
import { standardCommands } from "../../../src/commands/index.js";
import { FsError } from "../../../src/contracts/errors.js";
import type { FileSystem } from "../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { compareResolvedEntries, resolveEntryView } from "../../../src/fs/mount/comparison.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { createS3Transport, MockS3Client, S3FileSystem, S3ServiceError } from "../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { Shell } from "../../../src/shell/index.js";
import { MockDav } from "../webdav/mock.js";

const payload = new Uint8Array([0, 255, 128, 13, 10, 65]);
const previous = new Uint8Array([4, 0, 253]);
const sentinel = new Uint8Array([17, 18, 19]);
const baseUrl = "https://qualified.invalid/dav/";
type Kind = "s3" | "webdav";

function qualified(kind: Kind) {
  if (kind === "s3") {
    const service = new MockS3Client({ buckets: ["bucket"] });
    const filesystem = new S3FileSystem({ bucket: "bucket", transport: createS3Transport(service, service.capabilities) });
    return { filesystem, operations: () => service.requests.map(request => request.operation) };
  }
  const service = new MockDav();
  const filesystem = new WebDavFileSystem({ baseUrl, fetch: service.createFetch() });
  return { filesystem, operations: () => service.requests.map(request => request.init.method ?? "") };
}

function mounted(memory: FileSystem, remote: FileSystem) {
  return createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/memory": memory, "/remote": remote } });
}

function metadataOnly(operations: readonly string[]) {
  assert.ok(operations.length > 0);
  assert.ok(operations.every(operation => ["headObject", "listObjectsV2", "PROPFIND"].includes(operation)), JSON.stringify(operations));
}

for (const kind of ["s3", "webdav"] as const) {
  for (const direction of ["to-remote", "from-remote"] as const) {
    for (const action of ["copyFile", "cp", "mv"] as const) {
      test(`qualified ${kind} existing-target ${action} ${direction}`, async () => {
        const memory = new MemoryFileSystem();
        const { filesystem: remote, operations } = qualified(kind);
        const source = direction === "to-remote" ? memory : remote;
        const target = direction === "to-remote" ? remote : memory;
        await source.writeFile("/source", payload);
        await target.writeFile("/target", previous);
        await source.writeFile("/sentinel", sentinel);
        await target.writeFile("/sentinel", sentinel);
        const start = operations().length;
        const before = await memory.stat(direction === "to-remote" ? "/source" : "/target");
        assert.equal(await memory.compareEntry(direction === "to-remote" ? "/source" : "/target", remote,
          direction === "to-remote" ? "/target" : "/source"), "distinct");
        assert.equal(await remote.compareEntry(direction === "to-remote" ? "/target" : "/source", memory,
          direction === "to-remote" ? "/source" : "/target"), "distinct");
        assert.deepEqual(await memory.stat(direction === "to-remote" ? "/source" : "/target"), before);
        metadataOnly(operations().slice(start));
        const filesystem = mounted(memory, remote);
        const sourcePath = direction === "to-remote" ? "/memory/source" : "/remote/source";
        const targetPath = direction === "to-remote" ? "/remote/target" : "/memory/target";
        if (action === "copyFile") await filesystem.copyFile(sourcePath, targetPath);
        else {
          const result = await new Shell({ fs: filesystem }).use(standardCommands()).exec(`${action} ${sourcePath} ${targetPath}`);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        if (action === "mv") await assert.rejects(source.stat("/source"), { code: "ENOENT" });
        else assert.deepEqual(await source.readFile("/source"), payload);
        assert.deepEqual(await target.readFile("/target"), payload);
        assert.deepEqual(await source.readFile("/sentinel"), sentinel);
        assert.deepEqual(await target.readFile("/sentinel"), sentinel);
        assert.deepEqual((await source.readdir("/")).map(entry => entry.name), action === "mv" ? ["sentinel"] : ["sentinel", "source"]);
        assert.deepEqual((await target.readdir("/")).map(entry => entry.name), ["sentinel", "target"]);
      });
    }
  }

  test(`qualified ${kind} resolves nested readonly source and overlay destination views`, async () => {
    const memory = new MemoryFileSystem();
    const { filesystem: remote } = qualified(kind);
    await memory.writeFile("/source", payload);
    await remote.writeFile("/target", previous);
    const nested = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/nested": createReadOnlyFileSystem(memory) } });
    const upper = new MemoryFileSystem();
    const overlay = createOverlayFileSystem({ lower: remote, upper });
    const filesystem = mounted(nested, overlay);
    await filesystem.copyFile("/memory/nested/source", "/remote/target");
    assert.deepEqual(await memory.readFile("/source"), payload);
    assert.deepEqual(await remote.readFile("/target"), previous);
    assert.deepEqual(await upper.readFile("/target"), payload);
    await assert.rejects(filesystem.copyFile("/remote/target", "/memory/nested/source"), { code: "EROFS" });
    assert.deepEqual(await memory.readFile("/source"), payload);
  });

  test(`qualified ${kind} cannot bless altered or copied Memory observations`, async () => {
    const memory = new MemoryFileSystem();
    const { filesystem: remote } = qualified(kind);
    await memory.writeFile("/source", payload);
    await remote.writeFile("/target", previous);
    const own = await resolveEntryView(memory, "/source");
    const peer = await resolveEntryView(remote, "/target");
    assert.equal(await compareResolvedEntries({ ...own, stat: { ...own.stat } }, peer), "unknown");
    assert.equal(await compareResolvedEntries({ ...own, path: "/different" }, peer), "unknown");
    const original = memory.readFile;
    memory.readFile = (path, options) => original.call(memory, path, options);
    assert.equal(await memory.compareEntry("/source", remote, "/target"), "unknown");
    await assert.rejects(mounted(memory, remote).copyFile("/memory/source", "/remote/target"), { code: "ENOTSUP" });
    assert.deepEqual(await memory.readFile("/source"), payload);
    assert.deepEqual(await remote.readFile("/target"), previous);
  });

  test(`unchanged inherited Memory operation mapping remains qualified with ${kind}`, async () => {
    class InheritedMemory extends MemoryFileSystem {}
    const memory = new InheritedMemory();
    const { filesystem: remote } = qualified(kind);
    await memory.writeFile("/source", payload);
    await remote.writeFile("/target", previous);
    assert.notEqual((await memory.stat("/source")).identityScope, undefined);
    assert.equal(await memory.compareEntry("/source", remote, "/target"), "distinct");
    await mounted(memory, remote).copyFile("/memory/source", "/remote/target");
    assert.deepEqual(await memory.readFile("/source"), payload);
    assert.deepEqual(await remote.readFile("/target"), payload);
  });

  for (const direction of ["to-remote", "from-remote"] as const) {
    test(`genuine ${kind} metadata with Memory-alias content mapping stays unknown ${direction}`, async () => {
      const memory = new MemoryFileSystem();
      await memory.writeFile("/source", payload);
      let contentCalls = 0;
      let remote: FileSystem;
      if (kind === "s3") {
        const service = new MockS3Client({ buckets: ["bucket"] });
        await service.putObject({ Bucket: "bucket", Key: "source", Body: payload });
        const mixed = createS3Transport(service, service.capabilities);
        mixed.getObject = async () => { contentCalls++; return { Body: await memory.readFile("/source") }; };
        mixed.putObject = async input => { contentCalls++; await memory.writeFile("/source", input.Body); };
        mixed.getObjectStream = async () => { contentCalls++; return { Body: memory.readStream("/source") }; };
        mixed.putObjectStream = async input => { contentCalls++; await memory.writeStream("/source", input.Body); };
        remote = new S3FileSystem({ bucket: "bucket", transport: createS3Transport(mixed, service.capabilities) });
      } else {
        const service = new MockDav();
        service.files.set("/source", payload);
        remote = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
          if (init.method === "GET") { contentCalls++; return new Response(await memory.readFile("/source")); }
          if (init.method === "PUT") {
            contentCalls++;
            await memory.writeFile("/source", new Uint8Array(await new Response(init.body).arrayBuffer()));
            return new Response(null, { status: 204 });
          }
          return service.fetch(url, init);
        } });
      }
      assert.equal(await memory.compareEntry("/source", remote, "/source"), "unknown");
      assert.equal(await remote.compareEntry?.("/source", memory, "/source"), "unknown");
      const filesystem = mounted(memory, remote);
      const source = direction === "to-remote" ? "/memory/source" : "/remote/source";
      const target = direction === "to-remote" ? "/remote/source" : "/memory/source";
      await assert.rejects(filesystem.copyFile(source, target), { code: "ENOTSUP", path: source, dest: target });
      const result = await new Shell({ fs: filesystem }).use(standardCommands()).exec(`mv ${source} ${target}`);
      assert.notEqual(result.exitCode, 0);
      assert.equal(contentCalls, 0);
      assert.deepEqual(await memory.readFile("/source"), payload);
      assert.deepEqual(await memory.readdir("/"), [{ name: "source", type: "file" }]);
    });
  }
}

test("qualified comparison retains known Memory hardlink and symlink identity", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/source", payload);
  await memory.link("/source", "/hardlink");
  await memory.symlink("/source", "/symlink");
  for (const path of ["/source", "/hardlink", "/symlink"]) {
    assert.equal(await memory.compareEntry("/source", memory, path), "same");
    await assert.rejects(mounted(memory, memory).copyFile("/memory/source", `/remote${path}`), { code: "EINVAL" });
  }
  assert.deepEqual(await memory.readFile("/source"), payload);
});

for (const failure of ["metadata", "cancel", "write"] as const) {
  test(`qualified S3 ${failure} failure preserves both stores`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/source", payload);
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { message: "caller cancellation" });
    let armed = false;
    const service = new MockS3Client({ buckets: ["bucket"], authorize(request) {
      if (!armed) return;
      if (failure === "cancel" && request.operation === "headObject") controller.abort(reason);
      if (failure === "metadata" && request.operation === "headObject" || failure === "write" && request.operation === "putObject") {
        throw new S3ServiceError("AccessDenied", 403);
      }
    } });
    const remote = new S3FileSystem({ bucket: "bucket", transport: createS3Transport(service, service.capabilities) });
    await remote.writeFile("/target", previous);
    const start = service.requests.length;
    armed = true;
    await assert.rejects(mounted(memory, remote).copyFile("/memory/source", "/remote/target", { signal: controller.signal }),
      { code: failure === "cancel" ? "ECANCELED" : "EACCES", path: "/memory/source", dest: "/remote/target" });
    if (failure === "cancel") assert.equal(controller.signal.reason, reason);
    if (failure !== "write") metadataOnly(service.requests.slice(start).map(request => request.operation));
    armed = false;
    assert.deepEqual(await memory.readFile("/source"), payload);
    assert.deepEqual(await remote.readFile("/target"), previous);
    assert.deepEqual(await memory.readdir("/"), [{ name: "source", type: "file" }]);
    assert.deepEqual(await remote.readdir("/"), [{ name: "target", type: "file" }]);
  });
}

test("qualified S3 missing destination race keeps exclusive creation and source bytes", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/source", payload);
  let armed = false;
  const service = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
    if (armed && request.operation === "putObject" && "Key" in request.input && request.input.Key === "target") {
      armed = false;
      await service.putObject({ Bucket: "bucket", Key: "target", Body: previous });
    }
  } });
  const remote = new S3FileSystem({ bucket: "bucket", transport: createS3Transport(service, service.capabilities) });
  armed = true;
  await assert.rejects(mounted(memory, remote).copyFile("/memory/source", "/remote/target"), { code: "EEXIST" });
  assert.deepEqual(await memory.readFile("/source"), payload);
  assert.deepEqual(await remote.readFile("/target"), previous);
});

test("Memory authority preserves exact cancellation during peer observation", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/source", payload);
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "not a missing destination" });
  let armed = false;
  const service = new MockS3Client({ buckets: ["bucket"], authorize(request) {
    if (armed && request.operation === "headObject") controller.abort(reason);
  } });
  const remote = new S3FileSystem({ bucket: "bucket", transport: createS3Transport(service, service.capabilities) });
  await remote.writeFile("/target", previous);
  const start = service.requests.length;
  armed = true;
  await assert.rejects(memory.compareEntry("/source", remote, "/target", { signal: controller.signal }), error => error === reason);
  metadataOnly(service.requests.slice(start).map(request => request.operation));
  armed = false;
  assert.deepEqual(await memory.readFile("/source"), payload);
  assert.deepEqual(await remote.readFile("/target"), previous);
});

test("explicit Memory comparison authority is not shadowed by constructor registration", async () => {
  let calls = 0;
  const denied = new FsError("EACCES", { message: "configured comparison policy" });
  class NegotiatedMemory extends MemoryFileSystem {
    override async compareEntry(): Promise<never> { calls++; throw denied; }
  }
  const memory = new NegotiatedMemory();
  const { filesystem: remote } = qualified("s3");
  await memory.writeFile("/source", payload);
  await remote.writeFile("/target", previous);
  await assert.rejects(mounted(memory, remote).copyFile("/memory/source", "/remote/target"), { code: "EACCES" });
  assert.equal(calls, 1);
  assert.deepEqual(await memory.readFile("/source"), payload);
  assert.deepEqual(await remote.readFile("/target"), previous);
});

for (const kind of ["memory", "s3", "webdav"] as const) {
  for (const phase of ["subclass", "instance", "prototype-before-construction"] as const) {
    test(`Memory ${phase} data overrides cannot certify an alias to ${kind}`, async context => {
      const source = kind === "memory" ? new MemoryFileSystem() : qualified(kind).filesystem;
      await source.writeFile("/source", payload);
      let effects = 0;
      const corrupt = async () => {
        effects++;
        await source.writeFile("/source", sentinel);
        throw new FsError("EIO", { message: "overridden operation damaged source" });
      };
      class RedirectedMemory extends MemoryFileSystem {
        override async readFile() { effects++; return source.readFile("/source"); }
        override async *readStream() { effects++; yield await source.readFile("/source"); }
        override writeFile() { return corrupt(); }
        override writeStream() { return corrupt(); }
        override copyFile() { return corrupt(); }
        override rename() { return corrupt(); }
      }
      const originalStream = MemoryFileSystem.prototype.writeStream;
      try {
        if (phase === "prototype-before-construction") MemoryFileSystem.prototype.writeStream = corrupt;
        const target = phase === "subclass" ? new RedirectedMemory() : new MemoryFileSystem();
        await MemoryFileSystem.prototype.writeFile.call(target, "/target", previous);
        if (phase === "instance") {
          target.readFile = async () => { effects++; return source.readFile("/source"); };
          target.readStream = async function* () { effects++; yield await source.readFile("/source"); };
          target.writeFile = corrupt;
          target.writeStream = corrupt;
          target.copyFile = corrupt;
          target.rename = corrupt;
        }
        const filesystem = mounted(target, source);
        const failure: unknown = await filesystem.copyFile("/remote/source", "/memory/target").then(() => undefined, error => error);
        context.diagnostic(JSON.stringify({ kind, phase, code: failure instanceof FsError ? failure.code : null, effects,
          source: [...await source.readFile("/source")], target: [...await MemoryFileSystem.prototype.readFile.call(target, "/target")] }));
        assert.ok(failure instanceof FsError);
        assert.equal(failure.code, "ENOTSUP");
        const result = await new Shell({ fs: filesystem }).use(standardCommands()).exec("mv /remote/source /memory/target");
        assert.notEqual(result.exitCode, 0);
        assert.equal(effects, 0);
        assert.deepEqual(await source.readFile("/source"), payload);
        assert.deepEqual(await MemoryFileSystem.prototype.readFile.call(target, "/target"), previous);
        assert.deepEqual(await source.readdir("/"), [{ name: "source", type: "file" }]);
        assert.deepEqual(await target.readdir("/"), [{ name: "target", type: "file" }]);
      } finally { MemoryFileSystem.prototype.writeStream = originalStream; }
    });
  }
}
