import assert from "node:assert/strict";
import { test } from "node:test";
import { MockS3Client, S3FileSystem, createS3Transport } from "../../../src/fs/s3/index.js";
import { binary, errno } from "../../fs/conformance/fixtures.js";

const bucket = "truncate-profile";

test("s3: truncate without conditional PUT preserves exact bytes and sends no mutation", async () => {
  const mock = new MockS3Client({ buckets: [bucket] });
  await mock.putObject({ Bucket: bucket, Key: "file", Body: binary, Metadata: { owner: "original" } });
  const fs = new S3FileSystem({ bucket, transport: createS3Transport(mock, {}) });
  const before = mock.requests.length;
  await assert.rejects(fs.truncate("/file", 8), errno("ENOTSUP"));
  assert.ok(mock.requests.slice(before).every(request => request.operation === "headObject" || request.operation === "listObjectsV2"));
  assert.deepEqual(await fs.readFile("/file"), binary);
  assert.deepEqual((await mock.headObject({ Bucket: bucket, Key: "file" })).Metadata, { owner: "original" });
});

test("s3: truncate condition conflicts preserve competing bytes and metadata", async () => {
  let armed = false;
  const winner = new Uint8Array([255, 0, 128]);
  const mock = new MockS3Client({ buckets: [bucket], async authorize(request) {
    if (armed && request.operation === "putObject") {
      armed = false;
      assert.ok("IfMatch" in request.input && request.input.IfMatch);
      await mock.putObject({ Bucket: bucket, Key: "file", Body: winner, Metadata: { owner: "winner" } });
    }
  } });
  const fs = new S3FileSystem({ bucket, transport: mock });
  await fs.writeFile("/file", binary);
  armed = true;
  await assert.rejects(fs.truncate("/file", 8), errno("EAGAIN"));
  assert.equal(armed, false);
  assert.deepEqual(await fs.readFile("/file"), winner);
  assert.deepEqual((await mock.headObject({ Bucket: bucket, Key: "file" })).Metadata, { owner: "winner" });
});

test("s3: bounded truncate guards publication and zero truncate never downloads old bytes", async context => {
  const mock = new MockS3Client({ buckets: [bucket] });
  const fs = new S3FileSystem({ bucket, transport: mock, maxReadBytes: 16 });
  await fs.writeFile("/file", binary.slice(0, 16));
  const before = mock.requests.length;
  await assert.rejects(fs.truncate("/file", 17), errno("EFBIG"));
  assert.ok(mock.requests.slice(before).every(request => request.operation === "headObject" || request.operation === "listObjectsV2"));
  assert.deepEqual(await fs.readFile("/file"), binary.slice(0, 16));
  const etag = (await mock.headObject({ Bucket: bucket, Key: "file" })).ETag;
  const streamReads = context.mock.method(mock, "getObjectStream");
  const start = mock.requests.length;
  await fs.truncate("/file");
  const requests = mock.requests.slice(start);
  assert.ok(requests.every(request => request.operation !== "getObject"));
  assert.equal(streamReads.mock.callCount(), 0);
  const writes = requests.filter(request => request.operation === "putObject");
  assert.equal(writes.length, 1);
  assert.ok("IfMatch" in writes[0]!.input);
  assert.equal(writes[0]!.input.IfMatch, etag);
  assert.deepEqual(await fs.readFile("/file"), new Uint8Array());
  assert.equal((await fs.stat("/file")).size, 0);
});
