import assert from "node:assert/strict";
import test from "node:test";
import { createS3Transport, encodeCopySource, MockS3Client, S3ServiceError } from "../../../src/fs/s3/index.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

test("mock objects are flat keys and binary bodies are copied at storage and retrieval boundaries", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const body = new Uint8Array([0, 255, 128, 10]);
  await client.putObject({ Bucket: "bucket", Key: "implicit/child", Body: body });
  body.fill(1);
  const object = await client.getObject({ Bucket: "bucket", Key: "implicit/child" });
  assert.deepEqual(object.Body, new Uint8Array([0, 255, 128, 10]));
  (object.Body as Uint8Array).fill(2);
  assert.deepEqual((await client.getObject({ Bucket: "bucket", Key: "implicit/child" })).Body, new Uint8Array([0, 255, 128, 10]));
  await assert.rejects(client.headObject({ Bucket: "bucket", Key: "implicit" }), { name: "NoSuchKey" });
});

test("mock empty objects and mutable metadata have independent snapshots", async () => {
  const client = new MockS3Client({ buckets: ["bucket"], now: () => new Date(12345) });
  const metadata = { custom: "value" };
  await client.putObject({ Bucket: "bucket", Key: "empty", Body: new Uint8Array(), Metadata: metadata });
  metadata.custom = "changed";
  const head = await client.headObject({ Bucket: "bucket", Key: "empty" });
  assert.equal(head.ContentLength, 0);
  assert.equal(head.LastModified?.getTime(), 12345);
  assert.deepEqual(head.Metadata, { custom: "value" });
  head.LastModified?.setTime(0);
  head.Metadata!.custom = "changed again";
  assert.equal((await client.headObject({ Bucket: "bucket", Key: "empty" })).LastModified?.getTime(), 12345);
  assert.deepEqual((await client.headObject({ Bucket: "bucket", Key: "empty" })).Metadata, { custom: "value" });
});

test("mock pagination counts common prefixes as single entries and uses scoped opaque tokens", async () => {
  const client = new MockS3Client({ buckets: ["bucket"], pageSize: 2 });
  for (const key of ["root/", "root/a", "root/b/one", "root/b/two", "root/c", "outside"]) {
    await client.putObject({ Bucket: "bucket", Key: key, Body: new Uint8Array() });
  }
  const first = await client.listObjectsV2({ Bucket: "bucket", Prefix: "root/", Delimiter: "/", MaxKeys: 2 });
  assert.deepEqual(first.Contents?.map((item) => item.Key), ["root/", "root/a"]);
  assert.equal(first.KeyCount, 2);
  assert.equal(first.IsTruncated, true);
  assert.ok(first.NextContinuationToken);
  assert.notEqual(first.NextContinuationToken, "root/a");
  const second = await client.listObjectsV2({ Bucket: "bucket", Prefix: "root/", Delimiter: "/", ContinuationToken: first.NextContinuationToken });
  assert.deepEqual(second.CommonPrefixes, [{ Prefix: "root/b/" }]);
  assert.deepEqual(second.Contents?.map((item) => item.Key), ["root/c"]);
  assert.equal(second.KeyCount, 2);
  assert.equal(second.IsTruncated, false);
  await assert.rejects(client.listObjectsV2({ Bucket: "bucket", Prefix: "elsewhere/", ContinuationToken: first.NextContinuationToken }), { name: "InvalidArgument" });
  await assert.rejects(client.listObjectsV2({ Bucket: "bucket", ContinuationToken: "invented" }), { name: "InvalidArgument" });
});

test("mock continuation does not skip keys when an earlier page is deleted", async () => {
  const client = new MockS3Client({ buckets: ["bucket"], pageSize: 1 });
  for (const key of ["a", "b", "c"]) await client.putObject({ Bucket: "bucket", Key: key, Body: bytes(key) });
  const first = await client.listObjectsV2({ Bucket: "bucket" });
  await client.deleteObject({ Bucket: "bucket", Key: "a" });
  const second = await client.listObjectsV2({ Bucket: "bucket", ContinuationToken: first.NextContinuationToken! });
  assert.equal(second.Contents?.[0]?.Key, "b");
});

test("mock list ordering follows UTF-8 bytes, not UTF-16 code units", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  for (const key of ["😀", "\ue000", "é", "a"]) await client.putObject({ Bucket: "bucket", Key: key, Body: new Uint8Array() });
  assert.deepEqual((await client.listObjectsV2({ Bucket: "bucket" })).Contents?.map((item) => item.Key), ["a", "é", "\ue000", "😀"]);
});

test("mock enforces conditional put, source copy, destination copy, and delete", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const first = await client.putObject({ Bucket: "bucket", Key: "source", Body: bytes("one"), IfNoneMatch: "*" });
  await assert.rejects(client.putObject({ Bucket: "bucket", Key: "source", Body: bytes("two"), IfNoneMatch: "*" }), { name: "PreconditionFailed" });
  await assert.rejects(client.putObject({ Bucket: "bucket", Key: "source", Body: bytes("two"), IfMatch: '"wrong"' }), { name: "PreconditionFailed" });
  const second = await client.putObject({ Bucket: "bucket", Key: "source", Body: bytes("two"), IfMatch: first.ETag });
  await assert.rejects(client.copyObject({ Bucket: "bucket", Key: "copy", CopySource: "bucket/source", CopySourceIfMatch: first.ETag }), { name: "PreconditionFailed" });
  await client.copyObject({ Bucket: "bucket", Key: "copy", CopySource: "bucket/source", CopySourceIfMatch: second.ETag, IfNoneMatch: "*" });
  await assert.rejects(client.copyObject({ Bucket: "bucket", Key: "copy", CopySource: "bucket/source", IfNoneMatch: "*" }), { name: "PreconditionFailed" });
  await assert.rejects(client.deleteObject({ Bucket: "bucket", Key: "source", IfMatch: first.ETag }), { name: "PreconditionFailed" });
  await client.deleteObject({ Bucket: "bucket", Key: "source", IfMatch: second.ETag });
  await assert.rejects(client.deleteObject({ Bucket: "bucket", Key: "source", IfMatch: second.ETag }), { name: "NoSuchKey" });
  await client.deleteObject({ Bucket: "bucket", Key: "source" });
  await client.deleteObject({ Bucket: "bucket", Key: "copy", IfMatch: "*" });
  await assert.rejects(client.deleteObject({ Bucket: "bucket", Key: "copy", IfMatch: "*" }), { name: "NoSuchKey" });
  await assert.rejects(client.putObject({ Bucket: "bucket", Key: "missing", Body: bytes("value"), IfMatch: first.ETag }), { name: "NoSuchKey" });
});

test("mock server-side copy decodes CopySource exactly once and preserves bytes and user metadata", async () => {
  const client = new MockS3Client({ buckets: ["bucket", "other"] });
  const key = "space + # ? %2F/é!'()*";
  await client.putObject({ Bucket: "bucket", Key: key, Body: new Uint8Array([0, 255]), Metadata: { original: "yes" } });
  const encoded = encodeCopySource("bucket", key);
  assert.equal(encoded, "bucket/space%20%2B%20%23%20%3F%20%252F/%C3%A9%21%27%28%29%2A");
  await client.copyObject({ Bucket: "other", Key: "copy", CopySource: encoded, MetadataDirective: "COPY" });
  const result = await client.getObject({ Bucket: "other", Key: "copy" });
  assert.deepEqual(result.Body, new Uint8Array([0, 255]));
  assert.deepEqual(result.Metadata, { original: "yes" });
});

test("mock authorization is explicit and failures cannot mutate stored data", async () => {
  const client = new MockS3Client({ buckets: ["bucket"], authorize(request) {
    if (request.operation !== "listObjectsV2") throw new S3ServiceError("AccessDenied", 403);
  } });
  await assert.rejects(client.putObject({ Bucket: "bucket", Key: "denied", Body: bytes("secret") }), { name: "AccessDenied" });
  assert.deepEqual((await client.listObjectsV2({ Bucket: "bucket" })).Contents, []);
  assert.equal(client.requests.length, 2);
});

test("mock pre-aborted requests do not call authorization or mutate data", async () => {
  let authorizations = 0;
  const client = new MockS3Client({ buckets: ["bucket"], authorize() { authorizations++; } });
  await assert.rejects(client.putObject({ Bucket: "bucket", Key: "key", Body: bytes("value") }, { abortSignal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(authorizations, 0);
  assert.equal(client.requests.length, 0);
});

test("mock does not create buckets implicitly, rejects malformed requests, and supports MaxKeys zero", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  await assert.rejects(client.putObject({ Bucket: "missing", Key: "key", Body: bytes("value") }), { name: "NoSuchBucket" });
  await assert.rejects(client.putObject({ Bucket: "bucket", Key: "", Body: bytes("value") }), { name: "InvalidArgument" });
  await assert.rejects(client.listObjectsV2({ Bucket: "bucket", MaxKeys: 1001 }), { name: "InvalidArgument" });
  await client.putObject({ Bucket: "bucket", Key: "key", Body: bytes("value") });
  assert.equal((await client.listObjectsV2({ Bucket: "bucket", MaxKeys: 0 })).KeyCount, 0);
});

test("transport wrapper preserves client method binding and performs no requests at construction", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const transport = createS3Transport(client, { conditionalPut: true });
  assert.equal(client.requests.length, 0);
  assert.equal(transport.capabilities?.conditionalPut, true);
  assert.equal(transport.capabilities?.conditionalDelete, undefined);
  await transport.putObject({ Bucket: "bucket", Key: "key", Body: bytes("value") });
  assert.deepEqual((await transport.getObject({ Bucket: "bucket", Key: "key" })).Body, bytes("value"));
});
