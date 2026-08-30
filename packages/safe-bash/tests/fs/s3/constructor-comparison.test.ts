import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCommands } from "../../../src/commands/index.js";
import { FsError } from "../../../src/contracts/errors.js";
import type { EntryComparison, FileSystem, FsOptions } from "../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { MountFileSystem } from "../../../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { MockS3Client, S3FileSystem, createS3Transport } from "../../../src/fs/s3/index.js";
import type { S3FileSystemOptions, S3HeadOutput } from "../../../src/fs/s3/index.js";
import { Shell } from "../../../src/shell/index.js";

type Comparison = NonNullable<S3FileSystemOptions["compareEntry"]>;
const sourceBytes = new Uint8Array([0, 255, 128, 10, 17]);
const oldBytes = new Uint8Array([7, 0, 8]);

function serialized(output: S3HeadOutput): S3HeadOutput {
  const decoded = JSON.parse(JSON.stringify(output)) as Omit<S3HeadOutput, "LastModified"> & { LastModified?: string };
  const { LastModified, ...rest } = decoded;
  return { ...rest, ...(LastModified === undefined ? {} : { LastModified: new Date(LastModified) }) };
}

async function fixture(marked = false) {
  const service = new MockS3Client({ buckets: ["bucket"] });
  await service.putObject({ Bucket: "bucket", Key: "root/nested/source", Body: sourceBytes });
  await service.putObject({ Bucket: "bucket", Key: "root/nested/target", Body: oldBytes });
  await service.putObject({ Bucket: "bucket", Key: "root/nested/keep", Body: oldBytes });
  const bindings = new WeakMap<FileSystem, { store: object; prefix: string }>();
  const store = (service as unknown as { buckets: Map<string, object> }).buckets.get("bucket")!;
  const calls: { receiver: FileSystem; path: string; peer: FileSystem; peerPath: string; signal: AbortSignal | undefined }[] = [];
  const resolve = async (filesystem: FileSystem, path: string, options: FsOptions) => {
    options.signal?.throwIfAborted();
    const binding = bindings.get(filesystem);
    if (!binding) return undefined;
    const key = binding.prefix + path.slice(1);
    await service.headObject({ Bucket: "bucket", Key: key }, options.signal ? { abortSignal: options.signal } : {});
    options.signal?.throwIfAborted();
    return { store: binding.store, key };
  };
  const comparison: Comparison = async function (path, peer, peerPath, options = {}) {
    calls.push({ receiver: this, path, peer, peerPath, signal: options.signal });
    const own = await resolve(this, path, options);
    options.signal?.throwIfAborted();
    const other = await resolve(peer, peerPath, options);
    if (!own || !other) return "unknown";
    return own.store === other.store && own.key === other.key ? "same" : "distinct";
  };
  const make = (prefix: string, compareEntry?: Comparison) => {
    const transport = createS3Transport(service, { ...service.capabilities, streamingRead: false, streamingWrite: false });
    if (!marked) transport.headObject = async (input, options) => serialized(await service.headObject(input, options));
    const filesystem = new S3FileSystem({ bucket: "bucket", prefix, transport, ...(compareEntry ? { compareEntry } : {}) });
    bindings.set(filesystem, { store, prefix: `${prefix}/` });
    return filesystem;
  };
  const bytes = async (name: string) => (await service.getObject({ Bucket: "bucket", Key: `root/nested/${name}` })).Body;
  return { service, make, comparison, calls, bytes };
}

function mount(first: FileSystem, second: FileSystem) {
  return new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": first, "/second": second } });
}

function metadataOnly(service: MockS3Client, offset: number) {
  assert.ok(service.requests.slice(offset).every(request => request.operation === "headObject" || request.operation === "listObjectsV2"));
}

for (const command of ["cp", "mv"] as const) test(`constructor authority enables serialized SDK ${command} over an existing distinct entry`, async () => {
  const example = await fixture();
  const first = example.make("root", example.comparison);
  const second = example.make("root/nested", example.comparison);
  const filesystem = mount(first, second);
  const offset = example.service.requests.length;
  const controller = new AbortController();
  assert.equal(await filesystem.compareEntry("/first/nested/./source", filesystem, "/second/target", { signal: controller.signal }), "distinct");
  assert.deepEqual(example.calls, [
    { receiver: first, path: "/nested/source", peer: second, peerPath: "/target", signal: controller.signal },
    { receiver: second, path: "/target", peer: first, peerPath: "/nested/source", signal: controller.signal },
  ]);
  metadataOnly(example.service, offset);
  const result = await new Shell({ fs: filesystem }).use(standardCommands()).exec(`${command} /first/nested/source /second/target`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await example.bytes("target"), sourceBytes);
  assert.deepEqual(await example.bytes("keep"), oldBytes);
  if (command === "cp") assert.deepEqual(await example.bytes("source"), sourceBytes);
  else await assert.rejects(first.stat("/nested/source"), { code: "ENOENT" });
});

for (const authority of ["present", "absent", "unknown"] as const) test(`serialized SDK alias and existing target with ${authority} authority`, async () => {
  const example = await fixture();
  const comparison = authority === "present" ? example.comparison : authority === "unknown" ? async () => "unknown" as const : undefined;
  const first = example.make("root", comparison);
  const second = example.make("root/nested", comparison);
  const filesystem = mount(first, second);
  const offset = example.service.requests.length;
  assert.equal(await filesystem.compareEntry("/first/nested/source", filesystem, "/second/source"), authority === "present" ? "same" : "unknown");
  await assert.rejects(filesystem.copyFile("/first/nested/source", "/second/source"), { code: authority === "present" ? "EINVAL" : "ENOTSUP" });
  if (authority !== "present") await assert.rejects(filesystem.copyFile("/first/nested/source", "/second/target"), { code: "ENOTSUP" });
  metadataOnly(example.service, offset);
  assert.deepEqual(await example.bytes("source"), sourceBytes);
  assert.deepEqual(await example.bytes("target"), oldBytes);
});

for (const response of ["same", "distinct", "unknown", "denied", "invalid", "abort"] as const) {
  test(`built-in same composes with constructor ${response} without hiding errors or overwriting aliases`, async () => {
    const example = await fixture(true);
    const controller = new AbortController();
    const reason = new FsError("EACCES", { message: "resolver denied or aborted" });
    let calls = 0;
    const callback: Comparison = async () => {
      calls++;
      if (response === "denied") throw reason;
      if (response === "abort") { controller.abort(reason); return "distinct"; }
      return response as EntryComparison;
    };
    const first = example.make("root", callback);
    const second = example.make("root/nested");
    const filesystem = mount(first, second);
    const offset = example.service.requests.length;
    const error: unknown = await filesystem.copyFile("/first/nested/source", "/second/source", { signal: controller.signal })
      .then(() => undefined, failure => failure);
    assert.equal(calls, 1);
    assert.ok(error instanceof FsError);
    assert.equal(error.code, response === "denied" || response === "abort" ? "EACCES" : response === "distinct" || response === "invalid" ? "EIO" : "EINVAL");
    if (response === "abort") assert.equal(error, reason);
    if (response === "denied") assert.equal(error.cause, reason);
    metadataOnly(example.service, offset);
    assert.deepEqual(await example.bytes("source"), sourceBytes);
    assert.deepEqual(await example.bytes("target"), oldBytes);
  });
}

test("explicit unknown does not revive built-in distinctness", async () => {
  const example = await fixture(true);
  const first = example.make("root", async () => "unknown");
  const second = example.make("root/nested");
  const filesystem = mount(first, second);
  assert.equal(await filesystem.compareEntry("/first/nested/source", filesystem, "/second/target"), "unknown");
  await assert.rejects(filesystem.copyFile("/first/nested/source", "/second/target"), { code: "ENOTSUP" });
  assert.deepEqual(await example.bytes("source"), sourceBytes);
  assert.deepEqual(await example.bytes("target"), oldBytes);
});

test("late explicit denial replaces configured callback without bypassing known alias protection", async () => {
  const example = await fixture(true);
  let configured = 0;
  let late = 0;
  const reason = new FsError("EACCES");
  const first = example.make("root", async () => { configured++; return "distinct"; });
  const second = example.make("root/nested");
  first.compareEntry = async () => { late++; throw reason; };
  const filesystem = mount(first, second);
  await assert.rejects(filesystem.copyFile("/first/nested/source", "/second/source"), (error: unknown) => error instanceof FsError && error.code === "EACCES" && error.cause === reason);
  assert.equal(configured, 0);
  assert.equal(late, 1);
  first.compareEntry = async () => { late++; return "distinct"; };
  await assert.rejects(filesystem.copyFile("/first/nested/source", "/second/source"), { code: "EIO" });
  assert.equal(configured, 0);
  assert.equal(late, 2);
  assert.deepEqual(await example.bytes("source"), sourceBytes);
});

test("constructor operand conflicts are EIO and cancellation stops the next callback", async () => {
  for (const cancel of [false, true]) {
    const example = await fixture();
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { message: "caller cancellation" });
    const calls = [0, 0];
    const first = example.make("root", async () => { calls[0]!++; if (cancel) controller.abort(reason); return "same"; });
    const second = example.make("root/nested", async () => { calls[1]!++; return "distinct"; });
    const error: unknown = await mount(first, second).copyFile("/first/nested/source", "/second/target", { signal: controller.signal }).then(() => undefined, failure => failure);
    assert.ok(error instanceof FsError && error.code === (cancel ? "ENOENT" : "EIO"));
    if (cancel) assert.equal(error, reason);
    assert.deepEqual(calls, cancel ? [1, 0] : [1, 1]);
    assert.deepEqual(await example.bytes("source"), sourceBytes);
    assert.deepEqual(await example.bytes("target"), oldBytes);
  }
});

test("constructor authority cannot bypass readonly, exclusive creation or metadata denial", async () => {
  const example = await fixture();
  const first = example.make("root", example.comparison);
  const second = example.make("root/nested", example.comparison);
  const filesystem = mount(first, new ReadOnlyFileSystem(second));
  await assert.rejects(filesystem.copyFile("/first/nested/source", "/second/target"), { code: "EROFS" });
  await assert.rejects(mount(first, second).copyFile("/first/nested/source", "/second/target", { exclusive: true }), { code: "EEXIST" });
  assert.equal(example.calls.length, 0);
  const reason = new FsError("EACCES");
  first.stat = async () => { throw reason; };
  await assert.rejects(first.compareEntry("/nested/source", second, "/target"), error => error === reason);
  assert.equal(example.calls.length, 0);
  assert.deepEqual(await example.bytes("target"), oldBytes);
});

test("invalid constructor callback fails EINVAL before provider requests", () => {
  const service = new MockS3Client({ buckets: ["bucket"] });
  assert.throws(() => new S3FileSystem({ bucket: "bucket", transport: service, compareEntry: 42 as unknown as Comparison }), { code: "EINVAL" });
  assert.equal(service.requests.length, 0);
});

test("constructor callback leaves public negotiation intact and runs once for one operand", async () => {
  const example = await fixture();
  const filesystem = example.make("root", example.comparison);
  assert.equal(filesystem.compareEntry, S3FileSystem.prototype.compareEntry);
  assert.equal(await filesystem.compareEntry("/nested/source", filesystem, "/nested/target"), "distinct");
  assert.equal(example.calls.length, 1);
  assert.equal(example.calls[0]!.receiver, filesystem);
});

test("recursive constructor forwarding stays unknown rather than negotiating again", async () => {
  const example = await fixture();
  let calls = 0;
  const callback: Comparison = async function (path, peer, peerPath, options) {
    calls++;
    return this.compareEntry!(path, peer, peerPath, options);
  };
  const first = example.make("root", callback);
  const second = example.make("root/nested");
  assert.equal(await first.compareEntry("/nested/source", second, "/target"), "unknown");
  assert.equal(calls, 1);
  assert.deepEqual(await example.bytes("source"), sourceBytes);
  assert.deepEqual(await example.bytes("target"), oldBytes);
});
