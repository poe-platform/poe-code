import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCommands } from "../../../src/commands/index.js";
import { FsError } from "../../../src/contracts/errors.js";
import type { FileSystem } from "../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { MountFileSystem } from "../../../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { getOwnedS3Entry } from "../../../src/fs/s3/authority.js";
import { MockS3Client, S3FileSystem, S3ServiceError, createS3Transport } from "../../../src/fs/s3/index.js";
import type { S3Client, S3HeadOutput, S3RequestOptions } from "../../../src/fs/s3/index.js";
import { Shell } from "../../../src/shell/index.js";

const bytes = new Uint8Array([0, 255, 128, 10, 65]);
const oldBytes = new Uint8Array([9, 0, 8]);
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

for (const route of ["direct", "transport", "transport-chain"] as const) test(`full mapping authority survives ${route} clients and overlapping prefixes`, async () => {
  const service = new MockS3Client({ buckets: ["bucket"] });
  const client = () => route === "direct" ? service : route === "transport" ? createS3Transport(service, service.capabilities)
    : createS3Transport(createS3Transport(service, service.capabilities), service.capabilities);
  const left = adapter(client());
  const right = adapter(client(), "root/nested");
  await left.mkdir("/nested");
  await left.writeFile("/nested/file", bytes);
  await right.writeFile("/other", bytes);
  const start = service.requests.length;
  assert.equal(await left.compareEntry("/nested/file", right, "/file"), "same");
  assert.equal(await left.compareEntry("/nested/./file", right, "/other"), "distinct");
  assert.equal(await right.compareEntry("/other", left, "/nested/file"), "distinct");
  metadataOnly(service, start);
  assert.equal((await left.stat("/nested/file")).identityScope, undefined);
  assert.deepEqual(await right.readFile("/file", { maxBytes: 64 }), bytes);
});

test("distinct actual private stores and buckets are disjoint even with equal labels/content", async () => {
  const service = new MockS3Client({ buckets: ["bucket", "other"] });
  const second = new MockS3Client({ buckets: ["bucket"] });
  const left = adapter(createS3Transport(service, service.capabilities));
  const otherBucket = adapter(createS3Transport(service, service.capabilities), "root", "other");
  const otherStore = adapter(createS3Transport(second, second.capabilities));
  for (const fs of [left, otherBucket, otherStore]) await fs.writeFile("/file", bytes);
  const start = service.requests.length;
  const secondStart = second.requests.length;
  assert.equal(await left.compareEntry("/file", otherBucket, "/file"), "distinct");
  assert.equal(await left.compareEntry("/file", otherStore, "/file"), "distinct");
  metadataOnly(service, start);
  metadataOnly(second, secondStart);
});

for (const mode of ["clone", "manufacture", "replay", "wrong-key"] as const) test(`unqualified ${mode} metadata stays unknown without mutation`, async () => {
  const service = new MockS3Client({ buckets: ["bucket"] });
  const left = adapter(service);
  await left.writeFile("/source", bytes);
  await left.writeFile("/target", oldBytes);
  let replay: S3HeadOutput | undefined;
  const transport = createS3Transport(service, service.capabilities);
  transport.headObject = async (input, options) => {
    if (!input.Key.endsWith("target")) return service.headObject(input, options);
    if (mode === "replay" && replay) return replay;
    const output = await service.headObject(mode === "wrong-key" ? { ...input, Key: "root/source" } : input, options);
    if (mode === "clone") return { ...output };
    if (mode === "manufacture") return { ContentLength: oldBytes.length, ETag: '"manufactured"' };
    if (mode === "replay") replay = output;
    return output;
  };
  const right = adapter(transport);
  if (mode === "replay") await right.stat("/target");
  const start = service.requests.length;
  assert.equal(await left.compareEntry("/source", right, "/target"), "unknown");
  metadataOnly(service, start);
  await assert.rejects(mounted(left, right).copyFile("/left/source", "/right/target"), { code: "ENOTSUP" });
  assert.deepEqual(await left.readFile("/source", { maxBytes: 64 }), bytes);
  assert.deepEqual(await left.readFile("/target", { maxBytes: 64 }), oldBytes);
});

test("cached stat, copied stat and path poisoning cannot manufacture provider proof", async () => {
  const service = new MockS3Client({ buckets: ["bucket"] });
  const fs = adapter(service);
  await fs.writeFile("/file", bytes);
  const stat = await fs.stat("/file");
  assert.ok(getOwnedS3Entry({ filesystem: fs, path: "/file", stat, readOnly: false }));
  assert.equal(getOwnedS3Entry({ filesystem: fs, path: "/other", stat, readOnly: false }), undefined);
  assert.equal(getOwnedS3Entry({ filesystem: fs, path: "/file", stat: { ...stat }, readOnly: false }), undefined);
  fs.stat = async () => stat;
  assert.equal(getOwnedS3Entry({ filesystem: fs, path: "/file", stat, readOnly: false }), undefined);
  assert.equal(await fs.compareEntry("/file", adapter(service), "/file"), "unknown");
});

for (const code of ["AccessDenied", "InternalError", "NoSuchKey"] as const) test(`provider ${code} propagates before querying peer`, async () => {
  let fail = false;
  const service = new MockS3Client({ buckets: ["bucket"], authorize(request) {
    if (fail && request.operation === "headObject" && "Key" in request.input && request.input.Key === "root/file") {
      throw new S3ServiceError(code, code === "AccessDenied" ? 403 : code === "NoSuchKey" ? 404 : 500);
    }
  } });
  const peerService = new MockS3Client({ buckets: ["bucket"] });
  const fs = adapter(opaque(service));
  const peer = adapter(opaque(peerService));
  await fs.writeFile("/file", bytes);
  await peer.writeFile("/file", oldBytes);
  fail = true;
  const start = peerService.requests.length;
  await assert.rejects(fs.compareEntry("/file", peer, "/file"), { code: code === "AccessDenied" ? "EACCES" : code === "NoSuchKey" ? "ENOENT" : "EIO" });
  assert.equal(peerService.requests.length, start);
});

test("comparison forwards signal, propagates abort reasons and never starts peer after abort", async () => {
  const controller = new AbortController();
  const reason = new FsError("ENOENT");
  let abort = false;
  const service = new MockS3Client({ buckets: ["bucket"], authorize(request) {
    if (abort && request.operation === "headObject") controller.abort(reason);
  } });
  const peerService = new MockS3Client({ buckets: ["bucket"] });
  const seen: S3RequestOptions[] = [];
  const transport = createS3Transport(service, service.capabilities);
  transport.headObject = (input, options) => { if (options) seen.push(options); return service.headObject(input, options); };
  const fs = adapter(transport);
  const peer = adapter(peerService);
  await fs.writeFile("/file", bytes);
  await peer.writeFile("/file", bytes);
  seen.length = 0;
  await fs.compareEntry("/file", peer, "/file", { signal: controller.signal });
  assert.ok(seen.length > 0);
  assert.ok(seen.every(options => options.abortSignal === controller.signal));
  abort = true;
  const start = peerService.requests.length;
  await assert.rejects(fs.compareEntry("/file", peer, "/file", { signal: controller.signal }), error => error === reason);
  assert.equal(peerService.requests.length, start);
  const all = service.requests.length;
  await assert.rejects(fs.compareEntry("/file", peer, "/file", { signal: controller.signal }), error => error === reason);
  assert.equal(service.requests.length, all);
});

for (const action of ["copy", "mv"] as const) test(`qualified shared-service existing-target ${action} preserves source semantics and sentinel`, async () => {
  const service = new MockS3Client({ buckets: ["bucket"] });
  const left = adapter(createS3Transport(service, service.capabilities));
  const right = adapter(createS3Transport(service, service.capabilities));
  await left.writeFile("/source", bytes);
  await right.writeFile("/target", oldBytes);
  await left.writeFile("/keep", oldBytes);
  const fs = mounted(left, right);
  if (action === "copy") await fs.copyFile("/left/source", "/right/target");
  else {
    const result = await new Shell({ fs }).use(standardCommands()).exec("mv /left/source /right/target");
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.deepEqual(await right.readFile("/target", { maxBytes: 64 }), bytes);
  assert.deepEqual(await left.readFile("/keep", { maxBytes: 64 }), oldBytes);
  if (action === "copy") assert.deepEqual(await left.readFile("/source", { maxBytes: 64 }), bytes);
  else await assert.rejects(left.stat("/source"), { code: "ENOENT" });
});

test("recognized aliases reject before GET/mutation; readonly destination remains readonly", async () => {
  const service = new MockS3Client({ buckets: ["bucket"] });
  const left = adapter(createS3Transport(service, service.capabilities));
  const right = adapter(createS3Transport(service, service.capabilities));
  await left.writeFile("/source", bytes);
  await right.writeFile("/target", oldBytes);
  const start = service.requests.length;
  await assert.rejects(mounted(left, right).copyFile("/left/source", "/right/source"), { code: "EINVAL" });
  metadataOnly(service, start);
  await assert.rejects(mounted(left, new ReadOnlyFileSystem(right)).copyFile("/left/source", "/right/target"), { code: "EROFS" });
  assert.deepEqual(await left.readFile("/source", { maxBytes: 64 }), bytes);
  assert.deepEqual(await right.readFile("/target", { maxBytes: 64 }), oldBytes);
});

test("manual opaque forwarding clients are unqualified even when genuine HEAD objects survive", async () => {
  const service = new MockS3Client({ buckets: ["bucket"] });
  const known = adapter(service);
  await known.writeFile("/file", bytes);
  for (const client of [opaque(service), createS3Transport(opaque(service), service.capabilities)]) {
    const unqualified = adapter(client);
    const stat = await unqualified.stat("/file");
    assert.equal(getOwnedS3Entry({ filesystem: unqualified, path: "/file", stat, readOnly: false }), undefined);
    assert.equal(await known.compareEntry("/file", unqualified, "/file"), "unknown");
  }
});

for (const operation of ["headObject", "getObject", "putObject", "deleteObject", "copyObject", "listObjectsV2", "getObjectStream", "putObjectStream"] as const) {
  test(`changing ${operation} invalidates the complete forwarding mapping`, async () => {
    const service = new MockS3Client({ buckets: ["bucket"] });
    const known = adapter(service);
    await known.writeFile("/file", bytes);
    const transport = createS3Transport(service, service.capabilities);
    const forwarded = createS3Transport(transport, service.capabilities);
    const peer = adapter(forwarded);
    assert.equal(await known.compareEntry("/file", peer, "/file"), "same");
    Object.defineProperty(transport, operation, { value: service[operation]!.bind(service), configurable: true });
    assert.equal(await known.compareEntry("/file", peer, "/file"), "unknown");
  });
}

test("genuine Mock HEAD with local Memory GET/PUT never proves a disjoint closed store", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/source", bytes);
  const service = new MockS3Client({ buckets: ["bucket"] });
  await service.putObject({ Bucket: "bucket", Key: "root/source", Body: bytes });
  let reads = 0;
  let writes = 0;
  const mixed = createS3Transport(service, service.capabilities);
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

test("provider method substitution before construction is not registered as trusted implementation", async () => {
  const original = MockS3Client.prototype.getObject;
  try {
    MockS3Client.prototype.getObject = async function (input, options) { return original.call(this, input, options); };
    const service = new MockS3Client({ buckets: ["bucket"] });
    const fs = adapter(service);
    await fs.writeFile("/file", bytes);
    const stat = await fs.stat("/file");
    assert.equal(getOwnedS3Entry({ filesystem: fs, path: "/file", stat, readOnly: false }), undefined);
    assert.equal(await fs.compareEntry("/file", fs, "/file"), "unknown");
  } finally { MockS3Client.prototype.getObject = original; }
});

test("operation binding is checked again after peer metadata work", async () => {
  const service = new MockS3Client({ buckets: ["bucket"] });
  const transport = createS3Transport(service, service.capabilities);
  let change = false;
  const peerService = new MockS3Client({ buckets: ["bucket"], authorize(request) {
    if (change && request.operation === "headObject") transport.getObject = service.getObject.bind(service);
  } });
  const fs = adapter(transport);
  const peer = adapter(peerService);
  await fs.writeFile("/file", bytes);
  await peer.writeFile("/file", bytes);
  assert.equal(await fs.compareEntry("/file", peer, "/file"), "distinct");
  change = true;
  assert.equal(await fs.compareEntry("/file", peer, "/file"), "unknown");
});

test("unqualified alias copy remains ENOTSUP and exact-byte preserving before body work", async () => {
  const service = new MockS3Client({ buckets: ["bucket"] });
  const left = adapter(opaque(service));
  const right = adapter(opaque(service));
  await left.writeFile("/source", bytes);
  const start = service.requests.length;
  await assert.rejects(mounted(left, right).copyFile("/left/source", "/right/source"), { code: "ENOTSUP" });
  metadataOnly(service, start);
  assert.deepEqual(await left.readFile("/source", { maxBytes: 64 }), bytes);
  assert.deepEqual(await left.readdir("/"), [{ name: "source", type: "file" }]);
});
