import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { EntryComparison, FileSystem } from "../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { compareEntries, compareResolvedEntries, resolveEntryView } from "../../../src/fs/mount/comparison.js";
import { MountFileSystem } from "../../../src/fs/mount/index.js";
import { MockS3Client, S3FileSystem, createS3Transport } from "../../../src/fs/s3/index.js";

const sourceBytes = new Uint8Array([0, 255, 128, 17, 10]);
const targetBytes = new Uint8Array([33, 0, 34]);

async function fixture(streaming = true) {
  const client = new MockS3Client({ buckets: ["bucket"] });
  await client.putObject({ Bucket: "bucket", Key: "source", Body: sourceBytes });
  await client.putObject({ Bucket: "bucket", Key: "target", Body: targetBytes });
  const transport = createS3Transport(client, { ...client.capabilities, streamingRead: streaming, streamingWrite: streaming });
  return { client, filesystem: new S3FileSystem({ bucket: "bucket", transport }) };
}

function mount(first: FileSystem, second: FileSystem) {
  return new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": first, "/second": second } });
}

async function outcome(action: () => Promise<unknown>) {
  try { return { value: await action(), error: undefined }; }
  catch (error) { return { value: undefined, error }; }
}

function assertDenial(error: unknown, cause: FsError, syscall: string) {
  assert.ok(error instanceof FsError);
  assert.equal(error.code, "EACCES");
  assert.equal(error.cause, cause);
  assert.equal(error.syscall, syscall);
  assert.equal(error.path, "/first/source");
  assert.equal(error.dest, "/second/target");
}

for (const streaming of [false, true]) for (const side of ["source", "target"] as const) {
  for (const answer of ["same", "distinct", "unknown", "denied", "invalid", "cancel"] as const) {
    test(`late S3 ${side} ${answer} preserves ${streaming ? "streamed" : "buffered"} comparison and copy semantics`, async () => {
      const first = await fixture(streaming);
      const second = await fixture(streaming);
      const filesystem = mount(first.filesystem, second.filesystem);
      const changed = side === "source" ? first.filesystem : second.filesystem;
      const peer = side === "source" ? second.filesystem : first.filesystem;
      const path = side === "source" ? "/source" : "/target";
      const peerPath = side === "source" ? "/target" : "/source";
      const denied = new FsError("EACCES", { message: "late S3 authority denied" });
      const cancelled = new FsError("ECANCELED", { message: "late S3 authority cancelled" });
      let controller = new AbortController();
      let calls = 0;
      changed.compareEntry = async function (ownPath, other, otherPath, options = {}) {
        calls++;
        assert.equal(this, changed);
        assert.equal(ownPath, path);
        assert.equal(other, peer);
        assert.equal(otherPath, peerPath);
        assert.equal(options.signal, controller.signal);
        if (answer === "denied") throw denied;
        if (answer === "cancel") { controller.abort(cancelled); return "distinct"; }
        return answer as EntryComparison;
      };
      const offsets = [first.client.requests.length, second.client.requests.length];
      const comparison = await outcome(() => filesystem.compareEntry("/first/source", filesystem, "/second/target", { signal: controller.signal }));
      const comparisonCalls = calls;
      const metadataRequests = [first, second].flatMap((entry, index) => entry.client.requests.slice(offsets[index]!).map(request => request.operation));
      calls = 0;
      controller = new AbortController();
      const copy = await outcome(() => filesystem.copyFile("/first/source", "/second/target", { signal: controller.signal }));
      const requests = [first, second].flatMap((entry, index) => entry.client.requests.slice(offsets[index]!).map(request => request.operation));
      const sourceAfter = (await first.client.getObject({ Bucket: "bucket", Key: "source" })).Body;
      const targetAfter = (await second.client.getObject({ Bucket: "bucket", Key: "target" })).Body;
      assert.ok(sourceAfter instanceof Uint8Array);
      assert.ok(targetAfter instanceof Uint8Array);
      console.log(`S3_LATE_AUTHORITY ${JSON.stringify({ streaming, side, answer, comparison: comparison.value,
        comparisonError: (comparison.error as FsError | undefined)?.code, comparisonCalls,
        copyError: (copy.error as FsError | undefined)?.code, copyCalls: calls,
        source: [...sourceAfter], target: [...targetAfter], requests })}`);
      assert.equal(comparisonCalls, 1);
      assert.equal(calls, 1);
      assert.ok(metadataRequests.every(operation => operation === "headObject" || operation === "listObjectsV2"));
      if (answer === "denied") {
        assertDenial(comparison.error, denied, "compareEntry");
        assertDenial(copy.error, denied, "copyFile");
      } else if (answer === "cancel") {
        assert.equal(comparison.error, cancelled);
        assert.equal(copy.error, cancelled);
      } else if (answer === "invalid") {
        assert.ok(comparison.error instanceof FsError && comparison.error.code === "EIO");
        assert.ok(copy.error instanceof FsError && copy.error.code === "EIO");
      } else {
        assert.equal(comparison.error, undefined);
        assert.equal(comparison.value, answer);
        if (answer === "distinct") assert.equal(copy.error, undefined);
        else assert.ok(copy.error instanceof FsError && copy.error.code === (answer === "same" ? "EINVAL" : "ENOTSUP"));
      }
      assert.deepEqual(sourceAfter, sourceBytes);
      assert.deepEqual(targetAfter, answer === "distinct" ? sourceBytes : targetBytes);
      if (answer !== "distinct") assert.ok(requests.every(operation => operation === "headObject" || operation === "listObjectsV2"));
      else {
        const uploads = second.client.requests.slice(offsets[1]!).filter(request => request.operation === "putObject");
        assert.equal(uploads.length, 1);
        const input = uploads[0]!.input;
        assert.ok("Body" in input);
        assert.equal(input.Body.byteLength, streaming ? 0 : sourceBytes.byteLength);
      }
      assert.deepEqual(await first.filesystem.readdir("/"), [{ name: "source", type: "file" }, { name: "target", type: "file" }]);
      assert.deepEqual(await second.filesystem.readdir("/"), [{ name: "source", type: "file" }, { name: "target", type: "file" }]);
    });
  }
}

for (const streaming of [false, true]) test(`late S3 denial preserves mixed Memory target bytes (${streaming ? "streamed" : "buffered"})`, async () => {
  const first = await fixture(streaming);
  const second = new MemoryFileSystem();
  await second.writeFile("/target", targetBytes);
  const denied = new FsError("EACCES");
  let calls = 0;
  first.filesystem.compareEntry = async () => { calls++; throw denied; };
  const filesystem = mount(first.filesystem, second);
  const offset = first.client.requests.length;
  const result = await outcome(() => filesystem.copyFile("/first/source", "/second/target"));
  const target = await second.readFile("/target");
  console.log(`S3_LATE_MIXED ${JSON.stringify({ streaming, calls, code: (result.error as FsError | undefined)?.code, target: [...target] })}`);
  assertDenial(result.error, denied, "copyFile");
  assert.equal(calls, 1);
  assert.deepEqual(target, targetBytes);
  assert.ok(first.client.requests.slice(offset).every(request => request.operation === "headObject" || request.operation === "listObjectsV2"));
  assert.deepEqual(await first.filesystem.readFile("/source"), sourceBytes);
});

test("late S3 conflicting callbacks execute once per operand and preserve both files", async () => {
  const first = await fixture();
  const second = await fixture();
  const calls = [0, 0];
  first.filesystem.compareEntry = async () => { calls[0]!++; return "same"; };
  second.filesystem.compareEntry = async () => { calls[1]!++; return "distinct"; };
  const result = await outcome(() => mount(first.filesystem, second.filesystem).copyFile("/first/source", "/second/target"));
  assert.ok(result.error instanceof FsError && result.error.code === "EIO");
  assert.deepEqual(calls, [1, 1]);
  assert.deepEqual(await first.filesystem.readFile("/source"), sourceBytes);
  assert.deepEqual(await second.filesystem.readFile("/target"), targetBytes);
});

test("late S3 cancellation stops the peer callback before effects", async () => {
  const first = await fixture();
  const second = await fixture();
  const controller = new AbortController();
  const cancelled = new FsError("EACCES", { message: "caller abort reason" });
  const calls = [0, 0];
  first.filesystem.compareEntry = async () => { calls[0]!++; controller.abort(cancelled); return "distinct"; };
  second.filesystem.compareEntry = async () => { calls[1]!++; return "distinct"; };
  const result = await outcome(() => mount(first.filesystem, second.filesystem).copyFile("/first/source", "/second/target", { signal: controller.signal }));
  assert.equal(result.error, cancelled);
  assert.deepEqual(calls, [1, 0]);
  assert.deepEqual(await first.filesystem.readFile("/source"), sourceBytes);
  assert.deepEqual(await second.filesystem.readFile("/target"), targetBytes);
});

test("one late callback shared by two S3 operands is called once for each operand", async () => {
  const first = await fixture();
  const second = await fixture();
  const calls: FileSystem[] = [];
  async function comparison(this: FileSystem): Promise<EntryComparison> { calls.push(this); return "distinct"; }
  first.filesystem.compareEntry = comparison;
  second.filesystem.compareEntry = comparison;
  await mount(first.filesystem, second.filesystem).copyFile("/first/source", "/second/target");
  assert.deepEqual(calls, [first.filesystem, second.filesystem]);
  assert.deepEqual(await first.filesystem.readFile("/source"), sourceBytes);
  assert.deepEqual(await second.filesystem.readFile("/target"), sourceBytes);
});

test("same S3 operand callback executes once and recursive comparison stays unknown", async () => {
  const { filesystem } = await fixture();
  let calls = 0;
  filesystem.compareEntry = async function (path, peer, peerPath, options) {
    calls++;
    return compareEntries(this, path, peer, peerPath, options);
  };
  const wrapper = mount(filesystem, filesystem);
  const result = await outcome(() => wrapper.copyFile("/first/source", "/second/target"));
  assert.ok(result.error instanceof FsError && result.error.code === "ENOTSUP");
  assert.equal(calls, 1);
  assert.deepEqual(await filesystem.readFile("/source"), sourceBytes);
  assert.deepEqual(await filesystem.readFile("/target"), targetBytes);
});

test("complete known identities precede late S3 callbacks", async () => {
  const first = await fixture();
  const second = await fixture();
  const own = await resolveEntryView(first.filesystem, "/source");
  const peer = await resolveEntryView(second.filesystem, "/target");
  const scope = {};
  let calls = 0;
  first.filesystem.compareEntry = async () => { calls++; throw new FsError("EACCES"); };
  second.filesystem.compareEntry = first.filesystem.compareEntry;
  const left = { ...own, stat: { ...own.stat, identityScope: scope, dev: 0, ino: 1 } };
  for (const inode of [1, 2]) {
    const right = { ...peer, stat: { ...peer.stat, identityScope: scope, dev: 0, ino: inode } };
    assert.equal(await compareResolvedEntries(left, right), inode === 1 ? "same" : "distinct");
  }
  assert.equal(calls, 0);
  assert.deepEqual(await first.filesystem.readFile("/source"), sourceBytes);
  assert.deepEqual(await second.filesystem.readFile("/target"), targetBytes);
});

test("late S3 prototype authority is observed and removal remains unknown", async () => {
  const first = await fixture();
  const second = await fixture();
  const descriptor = Object.getOwnPropertyDescriptor(S3FileSystem.prototype, "compareEntry")!;
  let calls = 0;
  try {
    S3FileSystem.prototype.compareEntry = async () => { calls++; throw new FsError("EACCES"); };
    const wrapper = mount(first.filesystem, second.filesystem);
    const denied = await outcome(() => wrapper.copyFile("/first/source", "/second/target"));
    assert.ok(denied.error instanceof FsError && denied.error.code === "EACCES");
    assert.equal(calls, 1);
    Reflect.deleteProperty(S3FileSystem.prototype, "compareEntry");
    const unknown = await outcome(() => wrapper.copyFile("/first/source", "/second/target"));
    assert.ok(unknown.error instanceof FsError && unknown.error.code === "ENOTSUP");
    assert.deepEqual(await first.filesystem.readFile("/source"), sourceBytes);
    assert.deepEqual(await second.filesystem.readFile("/target"), targetBytes);
  } finally { Object.defineProperty(S3FileSystem.prototype, "compareEntry", descriptor); }
});

test("unchanged capable S3 authority still copies distinct existing entries", async () => {
  const first = await fixture();
  const second = await fixture();
  await mount(first.filesystem, second.filesystem).copyFile("/first/source", "/second/target");
  assert.deepEqual(await first.filesystem.readFile("/source"), sourceBytes);
  assert.deepEqual(await second.filesystem.readFile("/target"), sourceBytes);
});
