import assert from "node:assert/strict";
import { test } from "vitest";

import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { MountFileSystem } from "../../../../src/fs/mount/index.js";
import { getOwnedS3Entry } from "../../../../src/fs/s3/authority.js";
import type { S3Client } from "../../../../src/fs/s3/index.js";
import { MockS3Client,S3FileSystem,createS3Transport } from "../../../../src/fs/s3/index.js";


const bytes = new Uint8Array([0, 255, 128, 10, 65]);
function opaque<Client extends object>(client: Client): Client {
  return new Proxy(client, { get(target, property) {
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
function adapter(client: S3Client, prefix = "root", bucket = "bucket") {
  return new S3FileSystem({ bucket, prefix, transport: client, allowNonAtomicRename: false });
}
function mounted(left: FileSystem, right: FileSystem) {
  return new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/left": left, "/right": right } });
}
function metadataOnly(client: MockS3Client, start: number) {
  const requests = client.requests.slice(start);
  assert.ok(requests.length > 0);
  assert.ok(requests.every(request => ["headObject", "listObjectsV2"].includes(request.operation)));
  return requests;
}

test("cache drops stale stat binding; copied stat and path or filesystem poisoning remain unqualified", async () => {
  const service = new MockS3Client({ buckets: ["bucket"] });
  const fs = adapter(service);
  await fs.writeFile("/file", bytes);
  const stat = await fs.stat("/file");
  assert.ok(getOwnedS3Entry({ filesystem: fs, path: "/file", stat, readOnly: false }));
  assert.equal(getOwnedS3Entry({ filesystem: fs, path: "/other", stat, readOnly: false }), undefined);
  assert.equal(getOwnedS3Entry({ filesystem: adapter(service), path: "/file", stat, readOnly: false }), undefined);
  assert.equal(getOwnedS3Entry({ filesystem: fs, path: "/file", stat: { ...stat }, readOnly: false }), undefined);
  fs.stat = async () => ({ ...stat });
  assert.equal(getOwnedS3Entry({ filesystem: fs, path: "/file", stat: await fs.stat("/file"), readOnly: false }), undefined);
  assert.equal(await fs.compareEntry("/file", adapter(service), "/file"), "unknown");
});

test("faithful opaque forwarding preserves genuine fresh HEAD entry bindings", async () => {
  const service = new MockS3Client({ buckets: ["bucket"] });
  const known = adapter(service);
  await known.writeFile("/file", bytes);
  for (const client of [opaque(service), createS3Transport(opaque(service), service.capabilities)]) {
    const forwarded = adapter(client);
    const stat = await forwarded.stat("/file");
    assert.ok(getOwnedS3Entry({ filesystem: forwarded, path: "/file", stat, readOnly: false }));
    assert.equal(await known.compareEntry("/file", forwarded, "/file"), "same");
  }
});

test("remapped Memory content drops the unrelated Mock HEAD binding before comparison", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/source", bytes);
  const service = new MockS3Client({ buckets: ["bucket"] });
  await service.putObject({ Bucket: "bucket", Key: "root/source", Body: bytes });
  let reads = 0;
  let writes = 0;
  const mixed = createS3Transport(service, service.capabilities);
  mixed.headObject = async (input, options) => ({ ...await service.headObject(input, options) });
  mixed.getObject = async () => { reads++; return { Body: await memory.readFile("/source"), ContentLength: bytes.length }; };
  mixed.putObject = async input => { writes++; await memory.writeFile("/source", input.Body); };
  mixed.getObjectStream = async () => { reads++; return { Body: memory.readStream("/source"), ContentLength: bytes.length }; };
  mixed.putObjectStream = async input => { writes++; await memory.writeStream("/source", input.Body); };
  const remote = adapter(createS3Transport(mixed, service.capabilities));
  const stat = await remote.stat("/source");
  assert.equal(getOwnedS3Entry({ filesystem: remote, path: "/source", stat, readOnly: false }), undefined);
  assert.equal(await remote.compareEntry("/source", memory, "/source"), "unknown");
  const start = service.requests.length;
  await assert.rejects(mounted(memory, remote).copyFile("/left/source", "/right/source"), { code: "ENOTSUP" });
  metadataOnly(service, start);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.deepEqual(await memory.readFile("/source"), bytes);
  assert.deepEqual(await memory.readdir("/"), [{ name: "source", type: "file" }]);
});

test("faithful provider forwarding before construction retains observed storage authority", async () => {
  const original = MockS3Client.prototype.getObject;
  try {
    MockS3Client.prototype.getObject = async function (input, options) { return original.call(this, input, options); };
    const service = new MockS3Client({ buckets: ["bucket"] });
    const fs = adapter(service);
    await fs.writeFile("/file", bytes);
    const stat = await fs.stat("/file");
    assert.ok(getOwnedS3Entry({ filesystem: fs, path: "/file", stat, readOnly: false }));
    assert.equal(await fs.compareEntry("/file", fs, "/file"), "same");
  } finally { MockS3Client.prototype.getObject = original; }
});
