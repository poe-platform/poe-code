import assert from "node:assert/strict";
import { test } from "node:test";
import { MockS3Client, S3FileSystem, S3RenameError, S3ServiceError, createS3Transport } from "../../../src/fs/s3/index.js";
import type { MockS3Operation, S3ListOutput } from "../../../src/fs/s3/index.js";
import { binary, deferred, errno } from "../../fs/conformance/fixtures.js";

const bucket = "independent-stress";

test("s3: 1203 files paginate without omissions across a subtree rename and recursive delete", async () => {
  const mock = new MockS3Client({ buckets: [bucket], pageSize: 19 });
  const fs = new S3FileSystem({ transport: mock, bucket, prefix: "scope", pageSize: 23, allowNonAtomicRename: true });
  await fs.mkdir("/tree");
  const names = Array.from({ length: 1203 }, (_, index) => `file-${String(index).padStart(4, "0")}`);
  for (const name of names) await mock.putObject({ Bucket: bucket, Key: `scope/tree/${name}`, Body: binary.slice(0, 3) });
  await mock.putObject({ Bucket: bucket, Key: "scope/tree-sibling", Body: binary });
  assert.deepEqual((await fs.readdir("/tree")).map((entry) => entry.name).sort(), names);
  assert.ok(mock.requests.filter((request) => request.operation === "listObjectsV2" && "ContinuationToken" in request.input).length >= 63);
  await fs.rename("/tree", "/moved");
  assert.deepEqual((await fs.readdir("/moved")).map((entry) => entry.name).sort(), names);
  assert.deepEqual(await fs.readFile("/moved/file-1202"), binary.slice(0, 3));
  await assert.rejects(fs.stat("/tree"), errno("ENOENT"));
  await fs.rm("/moved", { recursive: true });
  assert.deepEqual(await fs.readdir("/"), [{ name: "tree-sibling", type: "file" }]);
  assert.deepEqual(await fs.readFile("/tree-sibling"), binary);
});

for (const [name, page] of Object.entries({
  "out-of-prefix key": { Contents: [{ Key: "elsewhere/leak", Size: 1 }], IsTruncated: false },
  "missing continuation token": { Contents: [], IsTruncated: true },
  "cyclic continuation token": { Contents: [], IsTruncated: true, NextContinuationToken: "same" },
  "invalid object size": { Contents: [{ Key: "scope/file", Size: -1 }], IsTruncated: false },
  "nested non-direct child": { Contents: [{ Key: "scope/nested/file", Size: 1 }], IsTruncated: false },
} satisfies Record<string, S3ListOutput>)) {
  test(`s3: malformed listing ${name} fails closed`, async () => {
    const mock = new MockS3Client({ buckets: [bucket] });
    const transport = createS3Transport(mock, mock.capabilities);
    let calls = 0;
    transport.listObjectsV2 = async (input) => {
      if (input.Delimiter === undefined) return { Contents: [], IsTruncated: false };
      calls++;
      assert.ok(calls <= 3, "pagination must terminate");
      return page;
    };
    const fs = new S3FileSystem({ transport, bucket, prefix: "scope" });
    await assert.rejects(fs.readdir("/"), errno("EIO"));
    assert.equal(calls, name === "cyclic continuation token" ? 2 : 1, "adapter must reject before the transport guard can mask a pagination loop");
    assert.equal(mock.requests.length, 0);
  });
}

test("s3: maxListEntries rejects rather than returning a truncated listing", async () => {
  const mock = new MockS3Client({ buckets: [bucket], pageSize: 2 });
  for (let index = 0; index < 6; index++) await mock.putObject({ Bucket: bucket, Key: `scope/file-${index}`, Body: binary });
  const fs = new S3FileSystem({ transport: mock, bucket, prefix: "scope", maxListEntries: 5 });
  await assert.rejects(fs.readdir("/"), errno("EFBIG"));
});

test("s3: exclusive copy rejects a destination created during copy authorization", async () => {
  const competing = new Uint8Array([255, 0, 73]);
  let raced = false;
  const mock = new MockS3Client({ buckets: [bucket], authorize: async (request) => {
    if (request.operation === "copyObject" && !raced) {
      raced = true;
      await mock.putObject({ Bucket: bucket, Key: "dest", Body: competing });
    }
  } });
  const fs = new S3FileSystem({ transport: mock, bucket });
  await fs.writeFile("/source", binary);
  await assert.rejects(fs.copyFile("/source", "/dest", { exclusive: true }), errno("EEXIST"));
  assert.equal(raced, true);
  assert.deepEqual(await fs.readFile("/source"), binary);
  assert.deepEqual(await fs.readFile("/dest"), competing);
});

for (const operation of ["getObject", "putObject", "listObjectsV2"] satisfies MockS3Operation[]) {
  test(`s3: cancellation during ${operation} reaches the repository mock`, { timeout: 3000 }, async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let active = false;
    const mock = new MockS3Client({ buckets: [bucket], authorize: async (request) => {
      if (active && request.operation === operation) { entered.resolve(); await release.promise; }
    } });
    const fs = new S3FileSystem({ transport: mock, bucket, prefix: "scope" });
    await fs.writeFile("/file", binary);
    const controller = new AbortController();
    active = true;
    const pending = operation === "getObject" ? fs.readFile("/file", { signal: controller.signal })
      : operation === "putObject" ? fs.writeFile("/file", new Uint8Array([9]), { signal: controller.signal })
        : fs.readdir("/", { signal: controller.signal });
    const rejected = assert.rejects(pending, errno("ECANCELED"));
    try {
      await entered.promise;
      controller.abort();
    } finally { release.resolve(); }
    await rejected;
    active = false;
    assert.deepEqual(await fs.readFile("/file"), binary);
  });
}

test("s3: explicit non-atomic rename opt-out rejects before host effects", async (context) => {
  const mock = new MockS3Client({ buckets: [bucket] });
  const fs = new S3FileSystem({ transport: mock, bucket, allowNonAtomicRename: false });
  await fs.writeFile("/source", binary);
  const count = mock.requests.length;
  await assert.rejects(fs.rename("/source", "/dest"), errno("ENOTSUP"));
  assert.equal(mock.requests.length, count);
  assert.deepEqual(await fs.readFile("/source"), binary);
  await assert.rejects(fs.stat("/dest"), errno("ENOENT"));
  assert.equal(fs.capabilities.atomicRename, false);
  context.diagnostic("PROFILE: explicit opt-out rejects; default guarded rename remains non-atomic copy/delete");
});

for (const failurePhase of ["copy", "delete"] as const) {
  test(`s3: non-atomic rename reports exact ${failurePhase}-phase partial state`, async () => {
    let enabled = false;
    let attempts = 0;
    const mock = new MockS3Client({ buckets: [bucket], authorize: (request) => {
      if (enabled && request.operation === (failurePhase === "copy" ? "copyObject" : "deleteObject") && ++attempts === 2) {
        throw new S3ServiceError("AccessDenied", 403);
      }
    } });
    const fs = new S3FileSystem({ transport: mock, bucket, allowNonAtomicRename: true });
    await fs.mkdir("/source");
    await fs.writeFile("/source/one", binary);
    await fs.writeFile("/source/two", binary);
    enabled = true;
    let failure!: S3RenameError;
    await assert.rejects(fs.rename("/source", "/dest"), (error: unknown) => {
      assert.ok(error instanceof S3RenameError);
      assert.equal(error.phase, failurePhase);
      assert.equal(error.code, "EACCES");
      assert.equal(error.path, "/source");
      assert.equal(error.dest, "/dest");
      failure = error;
      return true;
    });
    enabled = false;
    assert.deepEqual(failure.copiedKeys, failurePhase === "copy" ? ["dest/"] : ["dest/", "dest/one", "dest/two"]);
    assert.deepEqual(failure.deletedKeys, failurePhase === "copy" ? [] : ["source/"]);
    const keys = (await mock.listObjectsV2({ Bucket: bucket })).Contents!.map(entry => entry.Key!);
    assert.deepEqual(keys, failurePhase === "copy"
      ? ["dest/", "source/", "source/one", "source/two"]
      : ["dest/", "dest/one", "dest/two", "source/one", "source/two"]);
    for (const key of keys) {
      assert.deepEqual((await mock.getObject({ Bucket: bucket, Key: key })).Body, key.endsWith("/") ? new Uint8Array() : binary);
    }
    assert.deepEqual(await fs.readFile("/source/one"), binary);
    assert.deepEqual(await fs.readFile("/source/two"), binary);
  });
}

test("s3: unrepresentable object keys and file-prefix collisions remain explicit", async () => {
  for (const key of ["scope/../escape", "scope/double//child", "scope/dot/./child"]) {
    const mock = new MockS3Client({ buckets: [bucket] });
    await mock.putObject({ Bucket: bucket, Key: key, Body: binary });
    const fs = new S3FileSystem({ transport: mock, bucket, prefix: "scope" });
    await assert.rejects(fs.rm("/", { recursive: true }), errno("EBUSY"));
    await assert.rejects(fs.readdir(key.includes("double") ? "/double" : key.includes("dot") ? "/dot" : "/"), errno("ENOTSUP"));
    assert.equal((await mock.headObject({ Bucket: bucket, Key: key })).ContentLength, binary.length);
  }
  const mock = new MockS3Client({ buckets: [bucket] });
  await mock.putObject({ Bucket: bucket, Key: "scope/file", Body: binary });
  await mock.putObject({ Bucket: bucket, Key: "scope/file/child", Body: binary });
  await assert.rejects(new S3FileSystem({ transport: mock, bucket, prefix: "scope" }).readdir("/"), errno("ENOTSUP"));
});

for (const flag of ["a", "wx"] as const) {
  test(`s3: concurrent ${flag} writes enforce transport preconditions without lost updates`, { timeout: 3000 }, async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let active = false;
    let arrivals = 0;
    const mock = new MockS3Client({ buckets: [bucket], authorize: async (request) => {
      if (active && request.operation === "putObject") {
        if (++arrivals === 2) entered.resolve();
        await release.promise;
      }
    } });
    const fs = new S3FileSystem({ transport: mock, bucket });
    if (flag === "a") await fs.writeFile("/file", binary);
    active = true;
    const results = Promise.allSettled([
      fs.writeFile("/file", new Uint8Array([17]), { flag }),
      fs.writeFile("/file", new Uint8Array([18]), { flag }),
    ]);
    try { await entered.promise; }
    finally { release.resolve(); }
    const settled = await results;
    active = false;
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = settled.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    errno(flag === "a" ? "EAGAIN" : "EEXIST")(rejected.reason);
    const winner = settled.findIndex((result) => result.status === "fulfilled");
    const actual = await fs.readFile("/file");
    assert.deepEqual(actual, flag === "a" ? new Uint8Array([...binary, 17 + winner]) : new Uint8Array([17 + winner]));
  });
}

test("s3: read-only capability rejects every mutating required operation", async () => {
  const mock = new MockS3Client({ buckets: [bucket] });
  await mock.putObject({ Bucket: bucket, Key: "file", Body: binary });
  const fs = new S3FileSystem({ transport: mock, bucket, readOnly: true, allowNonAtomicRename: true });
  const before = mock.requests.length;
  for (const operation of [
    () => fs.writeFile("/file", new Uint8Array()), () => fs.appendFile("/file", binary),
    () => fs.mkdir("/dir"), () => fs.rm("/file"), () => fs.rename("/file", "/dest"),
    () => fs.copyFile("/file", "/copy"),
  ]) await assert.rejects(operation(), errno("EROFS"));
  assert.equal(mock.requests.length, before);
  assert.equal(fs.capabilities.readOnly, true);
  assert.deepEqual(await fs.readFile("/file"), binary);
});

test("s3: false body lengths reject exact-byte corruption", async () => {
  const mock = new MockS3Client({ buckets: [bucket] });
  await mock.putObject({ Bucket: bucket, Key: "file", Body: binary });
  const transport = createS3Transport(mock, mock.capabilities);
  transport.getObject = async (input, options) => ({ ...await mock.getObject(input, options), ContentLength: binary.length + 1 });
  const fs = new S3FileSystem({ transport, bucket });
  await assert.rejects(fs.readFile("/file"), errno("EIO"));
});
