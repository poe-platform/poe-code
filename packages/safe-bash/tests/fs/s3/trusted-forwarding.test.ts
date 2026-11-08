import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { FileSystem, FsOptions } from "../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { MountFileSystem } from "../../../src/fs/mount/index.js";
import { MockS3Client, S3FileSystem, S3ServiceError, createS3Transport } from "../../../src/fs/s3/index.js";
import type { S3Client, S3RequestOptions } from "../../../src/fs/s3/index.js";

const bytes = new Uint8Array([0, 255, 10, 128, 65]);
const previous = new Uint8Array([9, 0, 8]);

function opaque<Client extends object>(client: Client): Client {
  return new Proxy(client, { get(target, property) {
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

function forward(client: MockS3Client): S3Client {
  return {
    headObject: (input, options) => client.headObject(input, options),
    getObject: (input, options) => client.getObject(input, options),
    putObject: (input, options) => client.putObject(input, options),
    deleteObject: (input, options) => client.deleteObject(input, options),
    copyObject: (input, options) => client.copyObject(input, options),
    listObjectsV2: (input, options) => client.listObjectsV2(input, options),
    getObjectStream: (input, options) => client.getObjectStream(input, options),
    putObjectStream: (input, options) => client.putObjectStream(input, options),
  };
}

function mounted(first: FileSystem, second: FileSystem) {
  return new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": first, "/second": second } });
}

for (const route of ["proxy", "manual", "factory-proxy", "factory-manual"] as const) {
  test(`trusted ${route} forwarding preserves shared-map aliases and distinct existing-key copies`, async () => {
    const service = new MockS3Client({ buckets: ["bucket"] });
    const make = (prefix: string) => {
      const client = route.endsWith("proxy") ? opaque(service) : forward(service);
      return new S3FileSystem({ bucket: "bucket", prefix,
        transport: route.startsWith("factory") ? createS3Transport(client, service.capabilities) : client });
    };
    const first = make("root");
    const second = make("root/nested");
    await first.mkdir("/nested");
    await first.writeFile("/nested/source", bytes);
    await second.writeFile("/target", previous);
    const filesystem = mounted(first, second);
    const offset = service.requests.length;
    assert.equal(await first.compareEntry("/nested/source", second, "/source"), "same");
    assert.equal(await first.compareEntry("/nested/source", second, "/target"), "distinct");
    await assert.rejects(filesystem.copyFile("/first/nested/source", "/second/source"), { code: "EINVAL" });
    assert.ok(service.requests.slice(offset).every(request => request.operation === "headObject" || request.operation === "listObjectsV2"));
    assert.deepEqual(await first.readFile("/nested/source"), bytes);
    assert.deepEqual(await second.readFile("/target"), previous);
    await filesystem.copyFile("/first/nested/source", "/second/target");
    assert.deepEqual(await first.readFile("/nested/source"), bytes);
    assert.deepEqual(await second.readFile("/target"), bytes);
    assert.deepEqual(await second.readdir("/"), [{ name: "source", type: "file" }, { name: "target", type: "file" }]);
  });
}

test("HEAD returned outside a current provider query cannot bind an opaque client", async () => {
  const service = new MockS3Client({ buckets: ["bucket"] });
  await service.putObject({ Bucket: "bucket", Key: "source", Body: bytes });
  await service.putObject({ Bucket: "bucket", Key: "target", Body: previous });
  const unbound = await service.headObject({ Bucket: "bucket", Key: "target" });
  const client = forward(service);
  client.headObject = async input => input.Key === "target" ? unbound : service.headObject(input);
  const first = new S3FileSystem({ bucket: "bucket", transport: opaque(service) });
  const second = new S3FileSystem({ bucket: "bucket", transport: client });
  const offset = service.requests.length;
  assert.equal(await first.compareEntry("/source", second, "/target"), "unknown");
  await assert.rejects(mounted(first, second).copyFile("/first/source", "/second/target"), { code: "ENOTSUP" });
  assert.ok(service.requests.slice(offset).every(request => request.operation === "headObject" || request.operation === "listObjectsV2"));
  assert.deepEqual(await first.readFile("/source"), bytes);
  assert.deepEqual(await first.readFile("/target"), previous);
});

function memoryGateway(memory: MemoryFileSystem) {
  const effects: string[] = [];
  const fsOptions = (options?: S3RequestOptions): FsOptions => options?.abortSignal ? { signal: options.abortSignal } : {};
  const client: S3Client = {
    async headObject(input, options) {
      if (input.Key.endsWith("/")) throw new S3ServiceError("NoSuchKey", 404);
      const stat = await memory.stat(`/${input.Key}`, fsOptions(options));
      return { ContentLength: stat.size, LastModified: new Date(stat.mtimeMs) };
    },
    async getObject(input, options) {
      effects.push("GET");
      const body = await memory.readFile(`/${input.Key}`, fsOptions(options));
      return { Body: body, ContentLength: body.length };
    },
    async putObject(input, options) {
      if (input.IfMatch !== undefined) throw new S3ServiceError("NotImplemented", 501);
      effects.push("PUT");
      await memory.writeFile(`/${input.Key}`, input.Body, { ...fsOptions(options), flag: input.IfNoneMatch === "*" ? "wx" : "w" });
      return {};
    },
    async deleteObject(input, options) {
      if (input.IfMatch !== undefined) throw new S3ServiceError("NotImplemented", 501);
      effects.push("DELETE");
      await memory.rm(`/${input.Key}`, fsOptions(options));
      return {};
    },
    async copyObject() { throw new S3ServiceError("NotImplemented", 501); },
    async listObjectsV2(input, options) {
      const entries = await memory.readdir("/", fsOptions(options));
      return { IsTruncated: false, Contents: await Promise.all(entries.filter(entry => entry.name.startsWith(input.Prefix ?? ""))
        .map(async entry => ({ Key: entry.name, Size: (await memory.stat(`/${entry.name}`, fsOptions(options))).size }))) };
    },
  };
  return { filesystem: new S3FileSystem({ bucket: "memory", transport: client }), effects };
}

for (const identity of ["actual-memory-tuples", "unbound-metadata"] as const) {
  test(`legitimate Memory gateway ${identity} preserves aliases and only copies proven distinct entries`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/source", bytes);
    await memory.writeFile("/target", previous);
    const { filesystem: gateway, effects } = memoryGateway(memory);
    if (identity === "actual-memory-tuples") gateway.stat = (path, options) => memory.stat(path, options);
    const filesystem = mounted(memory, gateway);
    assert.equal(await gateway.compareEntry("/source", memory, "/source"), identity === "actual-memory-tuples" ? "same" : "unknown");
    await assert.rejects(filesystem.copyFile("/first/source", "/second/source"), { code: identity === "actual-memory-tuples" ? "EINVAL" : "ENOTSUP" });
    assert.deepEqual(effects, []);
    assert.deepEqual(await memory.readFile("/source"), bytes);
    if (identity === "actual-memory-tuples") {
      await filesystem.copyFile("/first/source", "/second/target");
      assert.deepEqual(effects, ["PUT"]);
      assert.deepEqual(await memory.readFile("/target"), bytes);
    } else {
      await assert.rejects(filesystem.copyFile("/first/source", "/second/target"), (error: unknown) => error instanceof FsError && error.code === "ENOTSUP");
      assert.deepEqual(effects, []);
      assert.deepEqual(await memory.readFile("/target"), previous);
    }
    assert.deepEqual(await memory.readFile("/source"), bytes);
    assert.deepEqual(await memory.readdir("/"), [{ name: "source", type: "file" }, { name: "target", type: "file" }]);
  });
}
