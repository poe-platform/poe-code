import assert from "node:assert/strict";
import { test } from "vitest";
import type { FileSystem,ReadFileOptions } from "../../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { compareResolvedEntries,resolveEntryView } from "../../../../src/fs/mount/comparison.js";
import { createMountFileSystem } from "../../../../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../../../../src/fs/readonly/index.js";
import { createS3Transport,MockS3Client,S3FileSystem } from "../../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";
import { wrapped } from "../overlay/helpers.js";
import { MockDav } from "../webdav/mock.js";

const payload = new Uint8Array([1, 0, 255]);
const previous = new Uint8Array([9, 8]);

class FaithfulMemory extends MemoryFileSystem {
  override readFile(path: string, options?: ReadFileOptions) { return super.readFile(path, options); }
}

function decorate(memory: MemoryFileSystem, style: "bound" | "decorator" | "subclass") {
  if (style === "bound") {
    memory.readFile = memory.readFile.bind(memory);
    memory.writeFile = memory.writeFile.bind(memory);
    memory.readStream = memory.readStream.bind(memory);
    memory.writeStream = memory.writeStream.bind(memory);
    memory.copyFile = memory.copyFile.bind(memory);
    memory.rename = memory.rename.bind(memory);
    memory.stat = memory.stat.bind(memory);
    memory.lstat = memory.lstat.bind(memory);
  } else if (style === "decorator") {
    const readFile = memory.readFile.bind(memory);
    const writeFile = memory.writeFile.bind(memory);
    const readStream = memory.readStream.bind(memory);
    const writeStream = memory.writeStream.bind(memory);
    memory.readFile = (path, options) => readFile(path, options);
    memory.writeFile = (path, bytes, options) => writeFile(path, bytes, options);
    memory.readStream = (path, options) => readStream(path, options);
    memory.writeStream = (path, bytes, options) => writeStream(path, bytes, options);
  }
}

function mounted(left: FileSystem, right: FileSystem) {
  return createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/left": left, "/right": right } });
}

function remote(kind: "s3" | "webdav") {
  if (kind === "s3") {
    const provider = new MockS3Client({ buckets: ["bucket"] });
    return new S3FileSystem({ bucket: "bucket", transport: createS3Transport(provider, provider.capabilities) });
  }
  const provider = new MockDav();
  return new WebDavFileSystem({ baseUrl: "https://faithful.invalid/dav/", fetch: provider.createFetch(), requestStreamSupport: true });
}

for (const style of ["bound", "decorator", "subclass"] as const) {
  for (const kind of ["s3", "webdav"] as const) {
    for (const direction of ["source", "target"] as const) {
      test(`faithful Memory ${style} preserves scope and ${kind} copy as ${direction}`, async _context => {
        const memory = style === "subclass" ? new FaithfulMemory() : new MemoryFileSystem();
        const peer = remote(kind);
        const source = direction === "source" ? memory : peer;
        const target = direction === "target" ? memory : peer;
        await source.writeFile("/source", payload);
        await target.writeFile("/target", previous);
        const path = direction === "source" ? "/source" : "/target";
        const before = await memory.stat(path);
        decorate(memory, style);
        const after = await memory.stat(path);
        const relation = await memory.compareEntry(path, peer, direction === "source" ? "/target" : "/source");
        const failure: unknown = await mounted(source, target).copyFile("/left/source", "/right/target").then(() => undefined, error => error);
        const sourceBytes = await source.readFile("/source");
        const targetBytes = await target.readFile("/target");
        console.info(JSON.stringify({ style, kind, direction, scopePresent: after.identityScope !== undefined,
          scopePreserved: after.identityScope === before.identityScope, relation,
          error: failure instanceof Error ? failure.message : null, source: [...sourceBytes], target: [...targetBytes] }));
        assert.notEqual(after.identityScope, undefined);
        assert.equal(after.identityScope, before.identityScope);
        assert.equal(after.dev, before.dev);
        assert.equal(after.ino, before.ino);
        assert.equal(relation, "distinct");
        assert.equal(failure, undefined);
        assert.deepEqual(sourceBytes, payload);
        assert.deepEqual(targetBytes, payload);
        assert.deepEqual(await source.readdir("/"), [{ name: "source", type: "file" }]);
        assert.deepEqual(await target.readdir("/"), [{ name: "target", type: "file" }]);
      });
    }
  }
}

test("faithful bound Memory preserves known hardlink/symlink aliases and readonly denial", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/source", payload);
  await memory.link("/source", "/hardlink");
  await memory.symlink("/source", "/symlink");
  decorate(memory, "bound");
  for (const path of ["/source", "/hardlink", "/symlink"]) {
    await assert.rejects(mounted(memory, memory).copyFile("/left/source", `/right${path}`), { code: "EINVAL" });
    assert.deepEqual(await memory.readFile("/source"), payload);
  }
  const other = new MemoryFileSystem();
  await other.writeFile("/source", previous);
  await assert.rejects(mounted(other, createReadOnlyFileSystem(memory)).copyFile("/left/source", "/right/source"), { code: "EROFS" });
  assert.deepEqual(await memory.readFile("/source"), payload);
  assert.deepEqual(await other.readFile("/source"), previous);
});

test("truthful unknown Memory-backed alias stays unknown before content effects", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/source", payload);
  await memory.link("/source", "/alias");
  decorate(memory, "decorator");
  let contentCalls = 0;
  const readStream = memory.readStream.bind(memory);
  memory.readStream = (path, options) => { contentCalls++; return readStream(path, options); };
  const unknown: FileSystem = wrapped(memory, {
    lstat: async (path, options) => {
      const { identityScope: omitted, ...stat } = await memory.lstat(path, options);
      void omitted;
      return stat;
    },
    stat: async (path, options) => {
      const { identityScope: omitted, ...stat } = await memory.stat(path, options);
      void omitted;
      return stat;
    },
    compareEntry: async () => "unknown",
  });
  await assert.rejects(mounted(memory, unknown).copyFile("/left/source", "/right/alias"), { code: "ENOTSUP" });
  assert.equal(contentCalls, 0);
  assert.deepEqual(await memory.readFile("/source"), payload);
  assert.deepEqual(await memory.readFile("/alias"), payload);
});

test("faithful Memory still requires original FS/path/stat observations", async () => {
  const memory = new MemoryFileSystem();
  const peer = remote("s3");
  await memory.writeFile("/source", payload);
  await peer.writeFile("/target", previous);
  decorate(memory, "bound");
  const own = await resolveEntryView(memory, "/source");
  const target = await resolveEntryView(peer, "/target");
  assert.equal(await compareResolvedEntries({ ...own, stat: { ...own.stat } }, target), "unknown");
  assert.equal(await compareResolvedEntries({ ...own, path: "/wrong" }, target), "unknown");
  assert.equal(await compareResolvedEntries({ ...own, filesystem: new MemoryFileSystem() }, target), "unknown");
  assert.deepEqual(await memory.readFile("/source"), payload);
  assert.deepEqual(await peer.readFile("/target"), previous);
});
