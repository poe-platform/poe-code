import assert from "node:assert/strict";
import test from "node:test";
import { isFsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import { toByteSource } from "../../../src/contracts/io.js";
import { MockS3Client, S3FileSystem, S3RenameError, S3ServiceError, createS3Transport } from "../../../src/fs/s3/index.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const errno = (code: ErrnoCode) => (error: unknown) => isFsError(error, code);

for (const existing of [false, true]) {
  test(`rename guards a destination ${existing ? "replacement" : "creation"} after preflight`, async () => {
    let armed = false;
    const client = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
      if (armed && request.operation === "copyObject") {
        armed = false;
        await client.putObject({ Bucket: "bucket", Key: "destination", Body: bytes("concurrent winner") });
      }
    } });
    const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
    await fs.writeFile("/source", bytes("source"));
    if (existing) await fs.writeFile("/destination", bytes("old destination"));
    armed = true;
    await assert.rejects(fs.rename("/source", "/destination"), error => {
      assert.ok(error instanceof S3RenameError);
      assert.equal(error.code, "EAGAIN");
      assert.equal(error.phase, "copy");
      assert.deepEqual(error.copiedKeys, []);
      assert.deepEqual(error.deletedKeys, []);
      return true;
    });
    assert.deepEqual(await fs.readFile("/source"), bytes("source"));
    assert.deepEqual(await fs.readFile("/destination"), bytes("concurrent winner"));
  });
}

test("metadata replacement rejects a concurrent content update and never rewrites new bytes", async () => {
  let armed = false;
  const client = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
    if (armed && request.operation === "copyObject") {
      armed = false;
      await client.putObject({ Bucket: "bucket", Key: "input", Body: bytes("winner"), Metadata: { owner: "new" } });
    }
  } });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
  await fs.writeFile("/input", bytes("original"));
  armed = true;
  await assert.rejects(fs.utimes("/input", 1, 2), errno("EAGAIN"));
  assert.deepEqual(await fs.readFile("/input"), bytes("winner"));
  assert.deepEqual((await client.headObject({ Bucket: "bucket", Key: "input" })).Metadata, { owner: "new" });
});

test("truncate guards the exact bytes read against a concurrent replacement", async () => {
  let armed = false;
  const client = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
    if (armed && request.operation === "putObject") {
      armed = false;
      await client.putObject({ Bucket: "bucket", Key: "input", Body: bytes("winner") });
    }
  } });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
  await fs.writeFile("/input", bytes("original"));
  armed = true;
  await assert.rejects(fs.truncate("/input", 2), errno("EAGAIN"));
  assert.deepEqual(await fs.readFile("/input"), bytes("winner"));
});

test("truncate shrinks a large object using only a bounded range and truncates to zero without GET", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket", maxReadBytes: 2 });
  await fs.writeFile("/input", bytes("0123456789"));
  await fs.truncate("/input", 2);
  assert.deepEqual(await fs.readFile("/input"), bytes("01"));
  const request = client.requests.find(request => request.operation === "getObject" && "Range" in request.input);
  assert.ok(request && "Range" in request.input);
  assert.equal(request.input.Range, "bytes=0-1");
  await fs.writeFile("/input", bytes("0123456789"));
  const start = client.requests.length;
  await fs.truncate("/input");
  assert.equal(client.requests.slice(start).some(request => request.operation === "getObject"), false);
  assert.deepEqual(await fs.readFile("/input"), new Uint8Array());
});

test("file, directory, implicit directory and prefixed-root timestamps survive adapter reconstruction", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket", prefix: "scope" });
  await fs.mkdir("/explicit");
  await client.putObject({ Bucket: "bucket", Key: "scope/implicit/child", Body: bytes("child") });
  await fs.writeFile("/file", bytes("original"));
  for (const path of ["/file", "/explicit", "/implicit", "/"]) await fs.utimes(path, -123.5, 456.25);
  const reopened = new S3FileSystem({ transport: client, bucket: "bucket", prefix: "scope" });
  for (const path of ["/file", "/explicit", "/implicit", "/"]) {
    const stat = await reopened.stat(path);
    assert.equal(stat.atimeMs, -123.5, path);
    assert.equal(stat.mtimeMs, 456.25, path);
  }
  assert.deepEqual(await reopened.readFile("/file"), bytes("original"));
});

test("conditional-PUT-only transports provide bounded timestamp updates without pretending server-side copy", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const fs = new S3FileSystem({ transport: createS3Transport(client, { conditionalPut: true }), bucket: "bucket", maxReadBytes: 4 });
  await fs.writeFile("/input", bytes("abcd"));
  await fs.utimes("/input", 12, 34);
  assert.equal((await fs.stat("/input")).mtimeMs, 34);
  assert.deepEqual(await fs.readFile("/input"), bytes("abcd"));
  await fs.mkdir("/directory");
  await fs.utimes("/directory", 56, 78);
  assert.equal((await fs.stat("/directory")).mtimeMs, 78);
  assert.equal(client.requests.some(request => request.operation === "copyObject"), false);
  await fs.writeFile("/large", bytes("abcde"));
  await assert.rejects(fs.utimes("/large", 1, 2), errno("EFBIG"));
});

test("append, truncate and stream replacement preserve mode and custom metadata, not stale mtime", async () => {
  const client = new MockS3Client({ buckets: ["bucket"], now: () => new Date(1000) });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
  await client.putObject({ Bucket: "bucket", Key: "input", Body: bytes("abc"), Metadata: {
    custom: "retained", "virtual-bash-mode": String(0o600), "virtual-bash-mtime": "1", "virtual-bash-atime": "2",
  } });
  await fs.appendFile("/input", bytes("d"));
  await fs.truncate("/input", 3);
  assert.ok(fs.writeStream);
  await fs.writeStream("/input", toByteSource(bytes("new")), { mode: 0o644 });
  const stat = await fs.stat("/input");
  assert.equal(stat.mode & 0o7777, 0o600);
  assert.equal(stat.mtimeMs, 1000);
  assert.equal(stat.atimeMs, 2);
  assert.equal((await client.headObject({ Bucket: "bucket", Key: "input" })).Metadata?.custom, "retained");
  assert.deepEqual(await fs.readFile("/input"), bytes("new"));
});

test("access distinguishes missing paths, virtual traversal, readonly policy and actual service denial", async () => {
  let deny = false;
  const client = new MockS3Client({ buckets: ["bucket"], authorize(request) {
    if (deny && request.operation === "headObject") throw new S3ServiceError("AccessDenied", 403);
  } });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
  const readonly = new S3FileSystem({ transport: client, bucket: "bucket", readOnly: true });
  await fs.writeFile("/file", bytes("data"));
  await fs.mkdir("/directory");
  await fs.access("/directory", 7);
  await fs.access("/file", 6);
  await assert.rejects(fs.access("/file", 1), errno("EACCES"));
  await assert.rejects(readonly.access("/file", 2), errno("EROFS"));
  await assert.rejects(readonly.access("/missing", 2), errno("ENOENT"));
  deny = true;
  await assert.rejects(fs.access("/missing", 0), errno("EACCES"));
});

test("metadata and truncate failures preserve filesystem error fidelity", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket", maxReadBytes: 4 });
  await fs.mkdir("/directory");
  await fs.writeFile("/file", bytes("data"));
  await assert.rejects(fs.utimes("/missing", 1, 2), errno("ENOENT"));
  await assert.rejects(fs.utimes("/file/", 1, 2), errno("ENOTDIR"));
  await assert.rejects(fs.utimes("/file", NaN, 0), errno("EINVAL"));
  await assert.rejects(fs.truncate("/missing", 0), errno("ENOENT"));
  await assert.rejects(fs.truncate("/file/", 0), errno("ENOTDIR"));
  await assert.rejects(fs.truncate("/directory", 0), errno("EISDIR"));
  await assert.rejects(fs.truncate("/file", -1), errno("EINVAL"));
  await assert.rejects(fs.truncate("/file", 5), errno("EFBIG"));
  assert.deepEqual(await fs.readFile("/file"), bytes("data"));
});

test("readonly and pre-aborted timestamp/truncate mutations dispatch no requests", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
  const readonly = new S3FileSystem({ transport: client, bucket: "bucket", readOnly: true });
  const signal = AbortSignal.abort();
  await assert.rejects(fs.utimes("/file", 1, 2, { signal }), errno("ECANCELED"));
  await assert.rejects(fs.truncate("/file", 0, { signal }), errno("ECANCELED"));
  await assert.rejects(readonly.utimes("/file", 1, 2), errno("EROFS"));
  await assert.rejects(readonly.truncate("/file", 0), errno("EROFS"));
  assert.equal(client.requests.length, 0);
});

test("buffered mock snapshots input bytes and metadata before asynchronous authorization", async () => {
  let released!: () => void;
  const gate = new Promise<void>(resolve => { released = resolve; });
  const client = new MockS3Client({ buckets: ["bucket"], authorize: () => gate });
  const payload = bytes("original");
  const metadata = { custom: "original" };
  const writing = client.putObject({ Bucket: "bucket", Key: "input", Body: payload, Metadata: metadata });
  payload.fill(255);
  metadata.custom = "changed";
  released();
  await writing;
  const output = await client.getObject({ Bucket: "bucket", Key: "input" });
  assert.deepEqual(output.Body, bytes("original"));
  assert.deepEqual(output.Metadata, { custom: "original" });
});

test("mock enforces the provider metadata budget without altering the object", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
  await client.putObject({ Bucket: "bucket", Key: "input", Body: bytes("data"), Metadata: { custom: "x".repeat(2040) } });
  await assert.rejects(fs.utimes("/input", 1, 2), errno("EINVAL"));
  assert.deepEqual(await fs.readFile("/input"), bytes("data"));
});

test("metadata-only changes can share an ETag: copy conditions do not claim a distributed metadata lock", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const first = await client.putObject({ Bucket: "bucket", Key: "input", Body: bytes("data"), Metadata: { custom: "first" } });
  const second = await client.putObject({ Bucket: "bucket", Key: "input", Body: bytes("data"), Metadata: { custom: "second" } });
  assert.equal(first.ETag, second.ETag);
  await client.copyObject({ Bucket: "bucket", Key: "input", CopySource: "bucket/input", CopySourceIfMatch: first.ETag,
    IfMatch: first.ETag, MetadataDirective: "REPLACE", Metadata: { custom: "last writer" } });
  assert.equal((await client.headObject({ Bucket: "bucket", Key: "input" })).Metadata?.custom, "last writer");
});
