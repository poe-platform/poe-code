import assert from "node:assert/strict";
import test from "node:test";
import { isFsError } from "../../../src/contracts/errors.js";
import { MockS3Client, S3FileSystem, S3ServiceError } from "../../../src/fs/s3/index.js";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

test("exclusive copy reports EEXIST when authorization concurrently creates the destination", async () => {
  const client = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
    if (request.operation === "copyObject") {
      await client.putObject({ Bucket: "bucket", Key: "mount/target", Body: bytes("winner") });
    }
  } });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket", prefix: "mount" });
  await fs.writeFile("/source", bytes("source"));
  await assert.rejects(fs.copyFile("/source", "/target", { exclusive: true }), (error: unknown) => {
    assert.ok(isFsError(error, "EEXIST"));
    assert.equal(error.syscall, "copyFile");
    assert.equal(error.path, "/source");
    assert.equal(error.dest, "/target");
    assert.ok(isFsError(error.cause, "EAGAIN"));
    return true;
  });
  assert.deepEqual(await fs.readFile("/target"), bytes("winner"));
  assert.deepEqual(await fs.readFile("/source"), bytes("source"));
  assert.equal(client.requests.filter((request) => request.operation === "copyObject").length, 1);
});

for (const createDestination of [false, true]) {
  test(`exclusive copy retains EAGAIN for changed source ETag; concurrent destination: ${createDestination}`, async () => {
    const client = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
      if (request.operation === "copyObject") {
        await client.putObject({ Bucket: "bucket", Key: "source", Body: bytes("changed source") });
        if (createDestination) await client.putObject({ Bucket: "bucket", Key: "target", Body: bytes("winner") });
      }
    } });
    const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
    await fs.writeFile("/source", bytes("original"));
    await assert.rejects(fs.copyFile("/source", "/target", { exclusive: true }), (error) => isFsError(error, "EAGAIN"));
    assert.deepEqual(await fs.readFile("/source"), bytes("changed source"));
    if (createDestination) assert.deepEqual(await fs.readFile("/target"), bytes("winner"));
    else await assert.rejects(fs.stat("/target"), (error) => isFsError(error, "ENOENT"));
  });
}

test("exclusive copy recognizes HTTP-only 412 failures without an AWS error name", async () => {
  const client = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
    if (request.operation === "copyObject") {
      await client.putObject({ Bucket: "bucket", Key: "target", Body: bytes("winner") });
      throw { $metadata: { httpStatusCode: 412 } };
    }
  } });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
  await fs.writeFile("/source", bytes("original"));
  await assert.rejects(fs.copyFile("/source", "/target", { exclusive: true }), (error) => isFsError(error, "EEXIST"));
});

for (const diagnostic of ["source-missing", "source-denied", "target-denied", "target-missing"] as const) {
  test(`exclusive copy retains original failure when diagnosis is inconclusive: ${diagnostic}`, async () => {
    let copyAttempted = false;
    const client = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
      if (request.operation === "copyObject") {
        copyAttempted = true;
        if (diagnostic === "source-missing") await client.deleteObject({ Bucket: "bucket", Key: "source" });
        if (diagnostic !== "target-missing") await client.putObject({ Bucket: "bucket", Key: "target", Body: bytes("winner") });
        throw new S3ServiceError("PreconditionFailed", 412);
      }
      if (copyAttempted && request.operation === "headObject" && "Key" in request.input
        && ((diagnostic === "source-denied" && request.input.Key === "source")
          || (diagnostic === "target-denied" && request.input.Key === "target"))) {
        throw new S3ServiceError("AccessDenied", 403);
      }
    } });
    const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
    await fs.writeFile("/source", bytes("original"));
    await assert.rejects(fs.copyFile("/source", "/target", { exclusive: true }), (error: unknown) => {
      assert.ok(isFsError(error, "EAGAIN"));
      assert.ok(error.cause instanceof S3ServiceError);
      assert.equal(error.cause.name, "PreconditionFailed");
      return true;
    });
  });
}

test("exclusive copy diagnostic requests propagate cancellation", async () => {
  const controller = new AbortController();
  let copyAttempted = false;
  const client = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
    if (request.operation === "copyObject") {
      copyAttempted = true;
      await client.putObject({ Bucket: "bucket", Key: "target", Body: bytes("winner") });
    } else if (copyAttempted && request.operation === "headObject") controller.abort();
  } });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
  await fs.writeFile("/source", bytes("original"));
  await assert.rejects(fs.copyFile("/source", "/target", { exclusive: true, signal: controller.signal }), (error) => isFsError(error, "ECANCELED"));
});

test("exclusive copy does not reclassify or diagnose a 409 as destination existence", async () => {
  let copyAttempted = false;
  const client = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
    if (request.operation === "copyObject") {
      await client.putObject({ Bucket: "bucket", Key: "target", Body: bytes("winner") });
      copyAttempted = true;
      throw new S3ServiceError("ConditionalRequestConflict", 409);
    }
    if (copyAttempted && request.operation === "headObject") assert.fail("409 must not trigger diagnostic HEAD requests");
  } });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
  await fs.writeFile("/source", bytes("original"));
  await assert.rejects(fs.copyFile("/source", "/target", { exclusive: true }), (error) => isFsError(error, "EAGAIN"));
});

test("nonexclusive copy leaves source-precondition errors unchanged even with an existing destination", async () => {
  const client = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
    if (request.operation === "copyObject") await client.putObject({ Bucket: "bucket", Key: "source", Body: bytes("changed") });
  } });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
  await fs.writeFile("/source", bytes("original"));
  await fs.writeFile("/target", bytes("retained"));
  await assert.rejects(fs.copyFile("/source", "/target"), (error) => isFsError(error, "EAGAIN"));
  assert.deepEqual(await fs.readFile("/target"), bytes("retained"));
});

test("exclusive copy guards only the target key, not concurrent target/child creation", async () => {
  const client = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
    if (request.operation === "copyObject") {
      await client.putObject({ Bucket: "bucket", Key: "mount/target/child", Body: bytes("concurrent child") });
    }
  } });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket", prefix: "mount" });
  await fs.writeFile("/source", bytes("original"));
  await fs.copyFile("/source", "/target", { exclusive: true });
  assert.deepEqual((await client.getObject({ Bucket: "bucket", Key: "mount/target" })).Body, bytes("original"));
  assert.deepEqual((await client.getObject({ Bucket: "bucket", Key: "mount/target/child" })).Body, bytes("concurrent child"));
  await assert.rejects(fs.stat("/target"), (error) => isFsError(error, "ENOTSUP"));
  await assert.rejects(fs.rm("/target", { recursive: true }), (error) => isFsError(error, "ENOTSUP"));
  assert.equal(client.requests.some((request) => request.operation === "deleteObject"), false);
});

test("exclusive creation also has no namespace-wide isolation", async () => {
  let injecting = false;
  const client = new MockS3Client({ buckets: ["bucket"], async authorize(request) {
    if (!injecting && request.operation === "putObject" && "Key" in request.input && request.input.Key === "target") {
      injecting = true;
      await client.putObject({ Bucket: "bucket", Key: "target/child", Body: bytes("concurrent child") });
    }
  } });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket" });
  await fs.writeFile("/target", bytes("new file"), { flag: "wx" });
  await assert.rejects(fs.stat("/target"), (error) => isFsError(error, "ENOTSUP"));
  assert.deepEqual((await client.getObject({ Bucket: "bucket", Key: "target" })).Body, bytes("new file"));
  assert.deepEqual((await client.getObject({ Bucket: "bucket", Key: "target/child" })).Body, bytes("concurrent child"));
});
