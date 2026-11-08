import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { EntryComparison, FileSystem } from "../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { MountFileSystem } from "../../../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { MockS3Client, S3FileSystem, createS3Transport } from "../../../src/fs/s3/index.js";
import type { S3FileSystemOptions } from "../../../src/fs/s3/index.js";

const original = new Uint8Array([0, 255, 17, 128, 10]);
const damage = new Uint8Array([68, 65, 77, 65, 71, 69]);
const marker = new Uint8Array([33, 0, 34]);

async function provider(streaming: boolean) {
  const client = new MockS3Client({ buckets: ["bucket"] });
  await client.putObject({ Bucket: "bucket", Key: "source", Body: original });
  await client.putObject({ Bucket: "bucket", Key: "keep", Body: marker });
  const options: S3FileSystemOptions = {
    bucket: "bucket", transport: createS3Transport(client, {
      ...client.capabilities, streamingRead: streaming, streamingWrite: streaming,
    }),
  };
  return { client, options };
}

for (const streaming of [false, true]) for (const timing of ["subclass-before", "prototype-before", "instance-after", "prototype-after"] as const) {
  test(`S3 adapter ${timing} ${streaming ? "streamed" : "buffered"} overrides cannot authorize source damage`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/source", original);
    await memory.writeFile("/keep", marker);
    const effects: string[] = [];
    const read = async () => { effects.push("readFile"); return memory.readFile("/source"); };
    const readStream = async function* () { effects.push("readStream"); yield await memory.readFile("/source"); };
    const write = async () => { effects.push("writeFile"); await memory.writeFile("/source", damage); throw new FsError("EIO"); };
    const writeStream = async () => { effects.push("writeStream"); await memory.writeFile("/source", damage); throw new FsError("EIO"); };
    const firstProvider = await provider(streaming);
    const secondProvider = await provider(streaming);
    class DataView extends S3FileSystem {}
    const target = timing === "subclass-before" ? DataView.prototype : S3FileSystem.prototype;
    const names = streaming
      ? timing === "instance-after" || timing === "prototype-after" ? ["readStream", "writeStream"] : ["streamRead", "streamWrite"]
      : ["readFile", "writeFile"];
    const methods = streaming ? [readStream, writeStream] : [read, write];
    const saved = names.map(name => Object.getOwnPropertyDescriptor(target, name));
    const install = (object: object) => names.forEach((name, index) => Object.defineProperty(object, name, { configurable: true, writable: true, value: methods[index] }));
    let first: S3FileSystem;
    let second: S3FileSystem;
    try {
      if (timing.endsWith("before")) install(target);
      const Constructor = timing === "subclass-before" ? DataView : S3FileSystem;
      first = new Constructor(firstProvider.options);
      second = new Constructor(secondProvider.options);
      if (timing === "instance-after" || (timing === "prototype-after" && streaming)) {
        install(first);
        install(second);
      } else if (timing === "prototype-after") install(target);
      const offsets = [firstProvider.client.requests.length, secondProvider.client.requests.length];
      const result = await new ReadOnlyFileSystem(first).compareEntry("/source", second, "/source");
      const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": first, "/second": second } });
      const failure: unknown = await mount.copyFile("/first/source", "/second/source").then(() => undefined, error => error);
      const source = [...await memory.readFile("/source")];
      const requests = [firstProvider, secondProvider].flatMap((entry, index) => entry.client.requests.slice(offsets[index]!).map(request => request.operation));
      const observation = { result, code: failure instanceof FsError ? failure.code : String(failure), effects, source, requests };
      console.log(`S3_ADAPTER_OVERRIDE ${JSON.stringify({ timing, streaming, ...observation })}`);
      assert.deepEqual({ result, code: observation.code, effects, source }, { result: "unknown", code: "ENOTSUP", effects: [], source: [...original] });
      assert.ok(requests.every(operation => operation === "headObject" || operation === "listObjectsV2"));
      assert.deepEqual(await memory.readFile("/keep"), marker);
      assert.deepEqual(await memory.readdir("/"), [{ name: "keep", type: "file" }, { name: "source", type: "file" }]);
      for (const entry of [firstProvider, secondProvider]) {
        assert.deepEqual((await entry.client.getObject({ Bucket: "bucket", Key: "source" })).Body, original);
        assert.deepEqual((await entry.client.getObject({ Bucket: "bucket", Key: "keep" })).Body, marker);
      }
    } finally {
      names.forEach((name, index) => {
        const descriptor = saved[index];
        if (descriptor) Object.defineProperty(target, name, descriptor);
        else Reflect.deleteProperty(target, name);
      });
    }
  });
}

test("original-operation subclass preserves qualified distinct-copy behavior without a class whitelist", async () => {
  class Transparent extends S3FileSystem {}
  const firstProvider = await provider(true);
  const secondProvider = await provider(true);
  await secondProvider.client.putObject({ Bucket: "bucket", Key: "source", Body: marker });
  const first = new Transparent(firstProvider.options);
  const second = new Transparent(secondProvider.options);
  const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": first, "/second": second } });
  await mount.copyFile("/first/source", "/second/source");
  assert.deepEqual(await first.readFile("/source"), original);
  assert.deepEqual(await second.readFile("/source"), original);
  assert.deepEqual(await second.readFile("/keep"), marker);
});

for (const answer of ["same", "invalid"] as const) test(`explicit subclass comparison ${answer} is not silently shadowed by the base authority`, async () => {
  let comparisons = 0;
  let writes = 0;
  class External extends S3FileSystem {
    override async compareEntry(): Promise<EntryComparison> { comparisons++; return answer as EntryComparison; }
    override async writeFile(): Promise<void> { writes++; throw new FsError("EIO"); }
  }
  const firstProvider = await provider(false);
  const secondProvider = await provider(false);
  const first: FileSystem = new External(firstProvider.options);
  const second = new S3FileSystem(secondProvider.options);
  const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": first, "/second": second } });
  await assert.rejects(mount.copyFile("/second/source", "/first/source"), { code: answer === "same" ? "EINVAL" : "EIO" });
  assert.equal(comparisons, 1);
  assert.equal(writes, 0);
  assert.deepEqual((await firstProvider.client.getObject({ Bucket: "bucket", Key: "source" })).Body, original);
  assert.deepEqual(await second.readFile("/source"), original);
});

for (const streaming of [false, true]) test(`private Memory descriptor consumer rejects a pre-overridden ${streaming ? "streamed" : "buffered"} S3 destination`, async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/source", original);
  await memory.writeFile("/keep", marker);
  const remoteProvider = await provider(streaming);
  const method = streaming ? "streamWrite" : "writeFile";
  const saved = Object.getOwnPropertyDescriptor(S3FileSystem.prototype, method)!;
  let effects = 0;
  try {
    Object.defineProperty(S3FileSystem.prototype, method, { configurable: true, writable: true, value: async () => {
      effects++;
      await memory.writeFile("/source", damage);
      throw new FsError("EIO");
    } });
    const remote = new S3FileSystem(remoteProvider.options);
    const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/local": memory, "/remote": remote } });
    const offset = remoteProvider.client.requests.length;
    await assert.rejects(mount.copyFile("/local/source", "/remote/source"), { code: "ENOTSUP" });
    assert.equal(effects, 0);
    assert.deepEqual(await memory.readFile("/source"), original);
    assert.deepEqual(await memory.readFile("/keep"), marker);
    assert.ok(remoteProvider.client.requests.slice(offset).every(request => ["headObject", "listObjectsV2"].includes(request.operation)));
    assert.deepEqual((await remoteProvider.client.getObject({ Bucket: "bucket", Key: "source" })).Body, original);
  } finally { Object.defineProperty(S3FileSystem.prototype, method, saved); }
});
