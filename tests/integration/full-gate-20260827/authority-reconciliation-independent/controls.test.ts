import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../../src/contracts/errors.js";
import type { FileStat, FileSystem } from "../../../../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../../src/fs/mount/index.js";
import { compareEntries } from "../../../../src/fs/mount/comparison.js";
import { createReadOnlyFileSystem } from "../../../../src/fs/readonly/index.js";
import { MockS3Client, S3FileSystem, createS3Transport } from "../../../../src/fs/s3/index.js";
import type { S3HeadOutput } from "../../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";
import { MockDav } from "../../../fs/webdav/mock.js";

const sourceBytes = new Uint8Array([0, 255, 195, 169, 10]);
const targetBytes = new Uint8Array([79, 76, 68]);
function backend(kind: "memory" | "s3" | "webdav"): FileSystem {
  if (kind === "memory") return createMemoryFileSystem();
  if (kind === "s3") {
    const client = new MockS3Client({ buckets: ["fixture"] });
    const transport = createS3Transport(client, client.capabilities);
    return new S3FileSystem({ bucket: "fixture", transport: { ...transport, headObject: (...args) => transport.headObject(...args) } });
  }
  const store = new MockDav();
  const fetch = store.createFetch();
  return new WebDavFileSystem({ baseUrl: "https://independent.test/dav/", fetch: (...args) => fetch(...args) });
}
function view(backing: FileSystem, omit: boolean, effects: string[]): FileSystem {
  const mapped = (path: string) => path === "/target" ? "/source" : path;
  const strip = (stat: FileStat): FileStat => {
    const { identityScope: _scope, dev: _dev, ino: _ino, ...rest } = stat;
    return rest;
  };
  const overrides: Partial<Omit<FileSystem, "compareEntry">> = {
    stat: async (path, options) => { const stat = await backing.stat(mapped(path), options); return omit ? strip(stat) : stat; },
    lstat: async (path, options) => { const stat = await backing.lstat(mapped(path), options); return omit ? strip(stat) : stat; },
    realpath: async (path, options) => { await backing.realpath(mapped(path), options); return path; },
    readFile: (path, options) => { effects.push("read"); return backing.readFile(mapped(path), options); },
    readStream: (path, options) => { effects.push("readStream"); return backing.readStream!(mapped(path), options); },
    writeFile: (path, bytes, options) => { effects.push("write"); return backing.writeFile(mapped(path), bytes, options); },
    writeStream: (path, bytes, options) => { effects.push("writeStream"); return backing.writeStream!(mapped(path), bytes, options); },
  };
  return new Proxy(backing, { get(target, key) {
    if (key === "compareEntry") return undefined;
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

for (const kind of ["memory", "s3", "webdav"] as const) {
  test(`independent ${kind}: faithful late writers copy bytes but cannot overwrite a readonly-view alias`, async () => {
    const source = backend(kind), destination = backend(kind);
    await source.writeFile("/source", sourceBytes); await destination.writeFile("/target", targetBytes);
    let writes = 0;
    const buffered = destination.writeFile.bind(destination);
    const streamed = destination.writeStream!.bind(destination);
    destination.writeFile = (...args) => { writes++; return buffered(...args); };
    destination.writeStream = (...args) => { writes++; return streamed(...args); };
    const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/source": source, "/target": destination, "/alias": createReadOnlyFileSystem(destination) } });
    await mount.copyFile("/source/source", "/target/target");
    assert.deepEqual(await source.readFile("/source"), sourceBytes);
    assert.deepEqual(await destination.readFile("/target"), sourceBytes);
    assert.ok(writes > 0);
    const before = writes;
    await assert.rejects(mount.copyFile("/alias/target", "/target/target"), { code: "EINVAL" });
    assert.equal(writes, before);
    assert.deepEqual(await destination.readFile("/target"), sourceBytes);
  });
  test(`independent ${kind}: honest opaque remapping refuses both directions before content acquisition`, async () => {
    const backing = backend(kind);
    await backing.writeFile("/source", sourceBytes); await backing.writeFile("/keep", targetBytes);
    const effects: string[] = [];
    const remapped = view(backing, true, effects);
    const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/backing": backing, "/mapped": remapped } });
    assert.equal(await compareEntries(backing, "/source", remapped, "/target"), "unknown");
    await assert.rejects(mount.copyFile("/backing/source", "/mapped/target"), { code: "ENOTSUP" });
    await assert.rejects(mount.copyFile("/mapped/target", "/backing/source"), { code: "ENOTSUP" });
    assert.deepEqual(effects, []);
    assert.deepEqual(await backing.readFile("/source"), sourceBytes);
    assert.deepEqual(await backing.readFile("/keep"), targetBytes);
  });
  for (const mode of ["error", "cancel"] as const) {
    test(`independent ${kind}: explicit ${mode} cannot become qualified publication`, async () => {
      const source = backend(kind), destination = backend(kind === "memory" ? "s3" : "memory");
      await source.writeFile("/source", sourceBytes); await destination.writeFile("/target", targetBytes);
      const controller = new AbortController();
      const marker = new FsError(mode === "error" ? "EACCES" : "ECANCELED", { message: "independent marker" });
      source.compareEntry = async () => { if (mode === "error") throw marker; controller.abort(marker); return "distinct"; };
      const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": source, "/right": destination } });
      await assert.rejects(mount.copyFile("/left/source", "/right/target", { signal: controller.signal }), error => {
        if (mode === "cancel") return error === marker;
        assert.ok(error instanceof FsError);
        assert.equal(error.code, "EACCES");
        assert.equal(error.syscall, "copyFile");
        assert.equal(error.path, "/left/source");
        assert.equal(error.dest, "/right/target");
        assert.equal(error.cause, marker);
        return true;
      });
      assert.deepEqual(await source.readFile("/source"), sourceBytes);
      assert.deepEqual(await destination.readFile("/target"), targetBytes);
    });
  }
}

test("independent truthful remapping retains actual native identity rather than making all remappers unusable", async () => {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/source", sourceBytes); await backing.writeFile("/donor", targetBytes);
  const effects: string[] = [];
  const mapped = view(backing, false, effects);
  assert.equal(await compareEntries(mapped, "/target", backing, "/source"), "same");
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/backing": backing, "/mapped": mapped } });
  await assert.rejects(mount.copyFile("/backing/source", "/mapped/target"), { code: "EINVAL" });
  assert.deepEqual(effects, []);
  await mount.copyFile("/backing/donor", "/mapped/target");
  assert.deepEqual(await backing.readFile("/source"), targetBytes);
  assert.deepEqual(await backing.readFile("/donor"), targetBytes);
});

for (const mode of ["faithful", "serialized", "replayed", "wrong-path"] as const) {
  test(`independent S3 ${mode} HEAD binds only a fresh corresponding query`, async () => {
    const store = new MockS3Client({ buckets: ["fixture"] });
    const transport = createS3Transport(store, store.capabilities);
    await store.putObject({ Bucket: "fixture", Key: "source", Body: sourceBytes });
    await store.putObject({ Bucket: "fixture", Key: "other", Body: targetBytes });
    let cached: S3HeadOutput | undefined;
    let replay = false;
    const remote = new S3FileSystem({ bucket: "fixture", transport: { ...transport, headObject: async (input, options) => {
      if (input.Key !== "source") return transport.headObject(input, options);
      if (mode === "replayed" && replay) return cached!;
      const result = await transport.headObject(mode === "wrong-path" ? { ...input, Key: "other" } : input, options);
      cached = result;
      return mode === "serialized" ? { ...result } : result;
    } } });
    const memory = createMemoryFileSystem(); await memory.writeFile("/target", targetBytes);
    if (mode === "replayed") { await remote.stat("/source"); replay = true; }
    assert.equal(await compareEntries(remote, "/source", memory, "/target"), mode === "faithful" ? "distinct" : "unknown");
    assert.deepEqual(await memory.readFile("/target"), targetBytes);
  });
}
