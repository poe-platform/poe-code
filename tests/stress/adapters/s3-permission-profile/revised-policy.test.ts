import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError } from "../../../../src/contracts/errors.js";
import { MockS3Client, S3FileSystem, S3ServiceError } from "../../../../src/fs/s3/index.js";
import type { MockS3Operation } from "../../../../src/fs/s3/index.js";

const bytes = new Uint8Array([0, 255, 17, 128]);
const replacement = new Uint8Array([33, 0]);
const errno = (code: string, path?: string) => (error: unknown) => {
  assert.ok(error instanceof FsError);
  assert.equal(error.code, code);
  if (path !== undefined) assert.equal(error.path, path);
  return true;
};
function fixture() {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const options = { bucket: "bucket", prefix: "profile", transport: client };
  return { client, fs: new S3FileSystem(options), fresh: new S3FileSystem(options) };
}

for (const mode of [0, 0o600, 0o755]) test(`approved advisory mode ${mode.toString(8)} is not privacy or execute authorization`, async () => {
  const { client, fs, fresh } = fixture();
  assert.equal(fs.capabilities.permissions, false);
  await fs.writeFile("/file", bytes, { mode, flag: "wx" });
  assert.equal(client.requests.length, 5);
  const put = client.requests.at(-1)!;
  assert.equal(put.operation, "putObject");
  assert.ok("IfNoneMatch" in put.input);
  assert.equal(put.input.IfNoneMatch, "*");
  assert.equal((await fresh.stat("/file")).mode & 0o7777, mode);
  assert.deepEqual(await fresh.readFile("/file", { maxBytes: 32 }), bytes);
  const raw = await client.getObject({ Bucket: "bucket", Key: "profile/file" });
  assert.deepEqual(raw.Body, bytes);
  assert.equal(raw.Metadata?.["virtual-bash-mode"], String(mode));
  for (const access of [0, 2, 4, 6]) await fs.access("/file", access);
  for (const access of [1, 3, 5, 7]) await assert.rejects(fs.access("/file", access), errno("EACCES", "/file"));
  await fs.writeFile("/file", replacement, { mode: 0o777 });
  assert.equal((await fresh.stat("/file")).mode & 0o7777, mode);
  assert.deepEqual(await fresh.readFile("/file", { maxBytes: 32 }), replacement);
});

test("approved mode0000 directory permits traversal and exact child namespace", async () => {
  const { fs, fresh } = fixture();
  await fs.mkdir("/dir", { mode: 0 });
  assert.equal((await fresh.stat("/dir")).mode & 0o7777, 0);
  assert.deepEqual(await fresh.readdir("/dir"), []);
  for (const access of [0, 1, 2, 3, 4, 5, 6, 7]) await fresh.access("/dir", access);
  await fresh.writeFile("/dir/child", bytes);
  assert.deepEqual(await fs.readdir("/dir"), [{ name: "child", type: "file" }]);
  assert.deepEqual(await fs.readFile("/dir/child", { maxBytes: 32 }), bytes);
});

test("chmod and invalid modes reject before requests; exclusivity preserves exact bytes", async () => {
  const { client, fs } = fixture();
  await fs.writeFile("/file", bytes, { mode: 0o600 });
  for (const path of ["/file", "/missing"]) {
    const start = client.requests.length;
    await assert.rejects(fs.chmod(path, 0), errno("ENOTSUP", path));
    assert.equal(client.requests.length, start);
  }
  for (const mode of [-1, 0o10000, NaN, 0.5]) {
    const start = client.requests.length;
    await assert.rejects(fs.writeFile("/invalid", replacement, { mode }), errno("EINVAL"));
    await assert.rejects(fs.mkdir("/invalid-dir", { mode }), errno("EINVAL"));
    assert.equal(client.requests.length, start);
  }
  for (const flag of ["wx", "ax"] as const) {
    const start = client.requests.length;
    await assert.rejects(fs.writeFile("/file", replacement, { flag, mode: 0 }), errno("EEXIST", "/file"));
    assert.ok(client.requests.slice(start).every(request => request.operation !== "putObject"));
    assert.deepEqual(await fs.readFile("/file", { maxBytes: 32 }), bytes);
  }
  for (const mode of [-1, 8, NaN, 1.5]) {
    const start = client.requests.length;
    await assert.rejects(fs.access("/file", mode), errno("EINVAL", "/file"));
    assert.equal(client.requests.length, start);
  }
  for (const mode of [0, 1, 2, 4]) await assert.rejects(fs.access("/missing", mode), errno("ENOENT", "/missing"));
  assert.deepEqual(await fs.readdir("/"), [{ name: "file", type: "file" }]);
});

test("readonly policy and provider denials remain errors, access is not GET/PUT authorization", async () => {
  let denied: MockS3Operation | undefined;
  const client = new MockS3Client({ buckets: ["bucket"], authorize(request) {
    if (request.operation === denied) throw new S3ServiceError("AccessDenied", 403);
  } });
  const fs = new S3FileSystem({ bucket: "bucket", transport: client });
  const readonly = new S3FileSystem({ bucket: "bucket", transport: client, readOnly: true });
  await fs.writeFile("/file", bytes, { mode: 0 });
  const start = client.requests.length;
  await assert.rejects(readonly.writeFile("/file", replacement, { mode: 0o600 }), errno("EROFS", "/file"));
  assert.equal(client.requests.length, start);
  await assert.rejects(readonly.access("/file", 2), errno("EROFS", "/file"));
  await readonly.access("/file", 4);
  denied = "getObject";
  await fs.access("/file", 4);
  await assert.rejects(fs.readFile("/file", { maxBytes: 32 }), errno("EACCES", "/file"));
  denied = "putObject";
  await fs.access("/file", 2);
  await assert.rejects(fs.writeFile("/file", replacement), errno("EACCES", "/file"));
  denied = "headObject";
  await assert.rejects(fs.access("/file", 4), errno("EACCES", "/file"));
  denied = undefined;
  assert.deepEqual(await fs.readFile("/file", { maxBytes: 32 }), bytes);
});

test("pre-aborted supported operations preserve cancellation without requests or mutation", async () => {
  const { client, fs } = fixture();
  await fs.writeFile("/file", bytes, { mode: 0 });
  for (const reason of [new Error("abort"), new FsError("ENOENT"), new FsError("EACCES")]) {
    const signal = AbortSignal.abort(reason);
    const start = client.requests.length;
    for (const mode of [0, 1, 2, 4]) await assert.rejects(fs.access("/file", mode, { signal }), errno("ECANCELED", "/"));
    await assert.rejects(fs.writeFile("/file", replacement, { mode: 0o600, signal }), errno("ECANCELED", "/"));
    await assert.rejects(fs.mkdir("/cancelled", { mode: 0, signal }), errno("ECANCELED", "/"));
    assert.equal(client.requests.length, start);
  }
  assert.deepEqual(await fs.readFile("/file", { maxBytes: 32 }), bytes);
  assert.deepEqual(await fs.readdir("/"), [{ name: "file", type: "file" }]);
});
