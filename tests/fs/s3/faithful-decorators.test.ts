import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { MountFileSystem } from "../../../src/fs/mount/index.js";
import { S3FileSystem, MockS3Client, createS3Transport } from "../../../src/fs/s3/index.js";

const sourceBytes = new Uint8Array([0, 255, 128, 10, 17]);
const targetBytes = new Uint8Array([7, 0, 8]);

for (const decorator of ["readFile-bind", "buffer-forward", "stream-bind", "stream-forward", "metadata-forward", "subclass-buffer"] as const) {
  test(`faithful S3 ${decorator} preserves observed aliases and existing-target copy`, async () => {
    const provider = new MockS3Client({ buckets: ["bucket"] });
    await provider.putObject({ Bucket: "bucket", Key: "source", Body: sourceBytes });
    await provider.putObject({ Bucket: "bucket", Key: "target", Body: targetBytes });
    class Forwarded extends S3FileSystem {
      override readFile: S3FileSystem["readFile"] = (path, options) => super.readFile(path, options);
      override writeFile: S3FileSystem["writeFile"] = (path, bytes, options) => super.writeFile(path, bytes, options);
    }
    const make = () => {
      const Constructor = decorator === "subclass-buffer" ? Forwarded : S3FileSystem;
      const filesystem = new Constructor({ bucket: "bucket", transport: createS3Transport(provider, {
        ...provider.capabilities, streamingRead: decorator.startsWith("stream"), streamingWrite: decorator.startsWith("stream"),
      }) });
      if (decorator === "readFile-bind") filesystem.readFile = filesystem.readFile.bind(filesystem);
      if (decorator === "buffer-forward") {
        const read = filesystem.readFile.bind(filesystem);
        const write = filesystem.writeFile.bind(filesystem);
        filesystem.readFile = (path, options) => read(path, options);
        filesystem.writeFile = (path, bytes, options) => write(path, bytes, options);
      }
      if (decorator.startsWith("stream")) {
        const read = filesystem.readStream!.bind(filesystem);
        const write = filesystem.writeStream!.bind(filesystem);
        Object.defineProperty(filesystem, "readStream", { value: decorator === "stream-bind" ? read
          : ((path, options) => read(path, options)) satisfies NonNullable<S3FileSystem["readStream"]> });
        Object.defineProperty(filesystem, "writeStream", { value: decorator === "stream-bind" ? write
          : ((path, bytes, options) => write(path, bytes, options)) satisfies NonNullable<S3FileSystem["writeStream"]> });
      }
      if (decorator === "metadata-forward") {
        const stat = filesystem.stat.bind(filesystem);
        const lstat = filesystem.lstat.bind(filesystem);
        const realpath = filesystem.realpath.bind(filesystem);
        filesystem.stat = (path, options) => stat(path, options);
        filesystem.lstat = (path, options) => lstat(path, options);
        filesystem.realpath = (path, options) => realpath(path, options);
      }
      return filesystem;
    };
    const first = make();
    const second = make();
    const filesystem = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": first, "/second": second } });
    const offset = provider.requests.length;
    const relation = await filesystem.compareEntry("/first/source", filesystem, "/second/target");
    const metadata = provider.requests.slice(offset);
    const failure: unknown = await filesystem.copyFile("/first/source", "/second/target").then(() => undefined, error => error);
    const source = (await provider.getObject({ Bucket: "bucket", Key: "source" })).Body;
    const target = (await provider.getObject({ Bucket: "bucket", Key: "target" })).Body;
    assert.ok(source instanceof Uint8Array && target instanceof Uint8Array);
    console.log(`S3_FAITHFUL_DECORATOR ${JSON.stringify({ decorator, relation, code: failure instanceof FsError ? failure.code : null,
      source: [...source], target: [...target] })}`);
    assert.equal(relation, "distinct");
    assert.equal(failure, undefined);
    assert.deepEqual(source, sourceBytes);
    assert.deepEqual(target, sourceBytes);
    assert.ok(metadata.length > 0 && metadata.every(request => request.operation === "headObject" || request.operation === "listObjectsV2"));
    const aliasOffset = provider.requests.length;
    assert.equal(await filesystem.compareEntry("/first/source", filesystem, "/second/source"), "same");
    await assert.rejects(filesystem.copyFile("/first/source", "/second/source"), { code: "EINVAL" });
    await assert.rejects(filesystem.copyFile("/first/source", "/second/target", { exclusive: true }), { code: "EEXIST" });
    assert.ok(provider.requests.slice(aliasOffset).every(request => request.operation === "headObject" || request.operation === "listObjectsV2"));
    assert.deepEqual(await first.readFile("/source"), sourceBytes);
    assert.deepEqual(await second.readFile("/target"), sourceBytes);
  });
}

for (const field of ["transport", "bucket", "prefix"] as const) {
  test(`S3 ${field} routing substitution does not reuse the old stat binding`, async () => {
    const provider = new MockS3Client({ buckets: ["bucket", "other"] });
    await provider.putObject({ Bucket: "bucket", Key: "source", Body: sourceBytes });
    const filesystem = new S3FileSystem({ bucket: "bucket", transport: provider });
    const stat = await filesystem.stat("/source");
    const { getOwnedS3Entry } = await import("../../../src/fs/s3/authority.js");
    assert.ok(getOwnedS3Entry({ filesystem, path: "/source", stat, readOnly: false }));
    Object.defineProperty(filesystem, field, { value: field === "transport" ? createS3Transport(provider) : field === "bucket" ? "other" : "other/" });
    assert.equal(getOwnedS3Entry({ filesystem, path: "/source", stat, readOnly: false }), undefined);
    assert.deepEqual((await provider.getObject({ Bucket: "bucket", Key: "source" })).Body, sourceBytes);
  });
}
