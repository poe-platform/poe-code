import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate as turn } from "node:timers/promises";
import test from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import { MockS3Client, S3FileSystem, S3ServiceError, createS3Transport } from "../../../src/fs/s3/index.js";

function rejected(code: ErrnoCode, path: string): (error: unknown) => boolean {
  return error => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, code);
    assert.equal(error.syscall, "rmdir");
    assert.equal(error.path, path);
    return true;
  };
}

function fixture() {
  const client = new MockS3Client({ buckets: ["bucket"], pageSize: 1 });
  const fs = new S3FileSystem({ transport: client, bucket: "bucket", prefix: "mount", pageSize: 1 });
  const seed = (key: string, body = new Uint8Array()) => client.putObject({ Bucket: "bucket", Key: key, Body: body });
  return { client, fs, seed };
}

function noMutations(client: MockS3Client, start: number): void {
  assert.ok(client.requests.slice(start).every(request => ["headObject", "listObjectsV2"].includes(request.operation)));
}

for (const path of ["/file", "/file/", "/file/child"]) {
  test(`rmdir rejects file path ${path} without effects`, async () => {
    const { client, fs, seed } = fixture();
    const body = new Uint8Array([0, 255, 1]);
    await seed("mount/file", body);
    const start = client.requests.length;
    await assert.rejects(fs.rmdir(path), rejected("ENOTDIR", path));
    noMutations(client, start);
    assert.deepEqual(await fs.readFile("/file"), body);
  });
}

for (const path of ["/missing", "/missing/child"]) {
  test(`rmdir preserves requested missing path ${path}`, async () => {
    const { client, fs } = fixture();
    await assert.rejects(fs.rmdir(path), rejected("ENOENT", path));
    noMutations(client, 0);
  });
}

for (const child of ["file", "nested/file", "child/"]) {
  for (const explicit of [false, true]) {
    test(`rmdir rejects ${explicit ? "explicit" : "implicit"} directory containing ${child}`, async () => {
      const { client, fs, seed } = fixture();
      if (explicit) await seed("mount/dir/");
      await seed(`mount/dir/${child}`);
      const start = client.requests.length;
      await assert.rejects(fs.rmdir("/dir"), rejected("ENOTEMPTY", "/dir"));
      noMutations(client, start);
      await client.headObject({ Bucket: "bucket", Key: `mount/dir/${child}` });
      if (explicit) await client.headObject({ Bucket: "bucket", Key: "mount/dir/" });
    });
  }
}

for (const conditional of [false, true]) {
  test(`snapshot rmdir deletes only the empty marker with conditionalDelete=${conditional}`, async () => {
    const { client, seed } = fixture();
    await seed("mount/empty/");
    await seed("mount/empty-neighbor/file", new Uint8Array([7]));
    await seed("mount-other/empty/file", new Uint8Array([8]));
    const transport = createS3Transport(client, conditional ? client.capabilities : {});
    const fs = new S3FileSystem({ transport, bucket: "bucket", prefix: "mount" });
    const path = "/other/../empty/";
    const start = client.requests.length;
    await fs.rmdir(path);
    assert.deepEqual(client.requests.slice(start).filter(request => request.operation === "deleteObject").map(request => request.input),
      [{ Bucket: "bucket", Key: "mount/empty/" }]);
    await assert.rejects(client.headObject({ Bucket: "bucket", Key: "mount/empty/" }), { code: "NoSuchKey" });
    await client.headObject({ Bucket: "bucket", Key: "mount/empty-neighbor/file" });
    await client.headObject({ Bucket: "bucket", Key: "mount-other/empty/file" });
    assert.equal(fs.capabilities.snapshotRmdir, true);
    assert.equal(fs.capabilities.atomicRename, false);
  });
}

test("a child created after the empty listing survives successful marker removal", async () => {
  const { client, seed } = fixture();
  await seed("mount/empty/");
  const requests: string[] = [];
  const base = createS3Transport(client, client.capabilities);
  let created = false;
  const fs = new S3FileSystem({ bucket: "bucket", prefix: "mount", transport: {
    ...base,
    headObject: (input, options) => { requests.push("head"); return base.headObject(input, options); },
    listObjectsV2: async (input, options) => {
      requests.push("list");
      const snapshot = await base.listObjectsV2(input, options);
      if (input.Prefix === "mount/empty/" && input.Delimiter === "/") {
        assert.equal(created, false);
        await seed("mount/empty/new-child", new Uint8Array([9]));
        created = true;
      }
      return snapshot;
    },
    deleteObject: (input, options) => { requests.push("delete"); return base.deleteObject(input, options); },
    putObject: (input, options) => { requests.push("put"); return base.putObject(input, options); },
    copyObject: (input, options) => { requests.push("copy"); return base.copyObject(input, options); },
  } });
  await fs.rmdir("/empty");
  assert.equal(created, true);
  assert.equal(requests.filter(operation => operation === "delete").length, 1);
  assert.ok(requests.every(operation => operation === "head" || operation === "list" || operation === "delete"));
  assert.deepEqual(await fs.readFile("/empty/new-child"), new Uint8Array([9]));
  await assert.rejects(client.headObject({ Bucket: "bucket", Key: "mount/empty/" }), { code: "NoSuchKey" });
  assert.equal((await fs.stat("/empty")).type, "directory");
});

test("pre-abort, read-only mode, and root protection make no requests", async () => {
  const { client, fs } = fixture();
  const signal = AbortSignal.abort(new Error("stop"));
  await assert.rejects(fs.rmdir("/empty", { signal }), rejected("ECANCELED", "/empty"));
  await assert.rejects(fs.rmdir("/", { signal }), rejected("ECANCELED", "/"));
  await assert.rejects(fs.rmdir("/"), rejected("EBUSY", "/"));
  const readOnly = new S3FileSystem({ transport: client, bucket: "bucket", readOnly: true });
  await assert.rejects(readOnly.rmdir("/empty"), rejected("EROFS", "/empty"));
  assert.equal(client.requests.length, 0);
});

for (const phase of ["head", "list"] as const) {
  test(`rmdir cancels an uncooperative ${phase} and observes late rejection`, { timeout: 2000 }, async () => {
    const { client, seed } = fixture();
    await seed("mount/empty/");
    const start = client.requests.length;
    const controller = new AbortController();
    let enter!: (signal: AbortSignal | undefined) => void;
    const entered = new Promise<AbortSignal | undefined>(resolve => { enter = resolve; });
    let rejectPending!: (error: Error) => void;
    const pending = new Promise<never>((_resolve, reject) => { rejectPending = reject; });
    const base = createS3Transport(client, client.capabilities);
    const fs = new S3FileSystem({ bucket: "bucket", prefix: "mount", transport: {
      ...base,
      headObject: (input, options) => {
        if (phase === "head" && input.Key === "mount/empty") { enter(options?.abortSignal); return pending; }
        return base.headObject(input, options);
      },
      listObjectsV2: (input, options) => {
        if (phase === "list" && input.Prefix === "mount/empty/" && input.Delimiter === "/") {
          enter(options?.abortSignal); return pending;
        }
        return base.listObjectsV2(input, options);
      },
    } });
    const checking = assert.rejects(fs.rmdir("/empty", { signal: controller.signal }), rejected("ECANCELED", "/empty"));
    assert.equal(await entered, controller.signal);
    controller.abort(new Error("stop pending inspection"));
    try { await checking; }
    finally { rejectPending(new Error("late host failure")); }
    await turn();
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    noMutations(client, start);
    await client.headObject({ Bucket: "bucket", Key: "mount/empty/" });
  });
}

test("rmdir propagates listing authorization errors with the requested path and cause", async () => {
  const { client, seed } = fixture();
  await seed("mount/empty/");
  const cause = new S3ServiceError("AccessDenied", 403);
  const base = createS3Transport(client, client.capabilities);
  const fs = new S3FileSystem({ bucket: "bucket", prefix: "mount", transport: {
    ...base,
    listObjectsV2: (input, options) => input.Prefix === "mount/empty/"
      ? Promise.reject(cause) : base.listObjectsV2(input, options),
  } });
  const start = client.requests.length;
  await assert.rejects(fs.rmdir("/empty/"), error => {
    rejected("EACCES", "/empty/")(error);
    assert.ok(error instanceof FsError && error.cause instanceof FsError);
    assert.equal(error.cause.cause, cause);
    return true;
  });
  noMutations(client, start);
});

test("legacy nonrecursive rm still removes a file and an empty marker", async () => {
  const { fs, seed } = fixture();
  await seed("mount/file", new Uint8Array([1]));
  await seed("mount/empty/");
  await fs.rm("/file", { recursive: false });
  await fs.rm("/empty", { recursive: false });
  await assert.rejects(fs.stat("/file"), { code: "ENOENT" });
  await assert.rejects(fs.stat("/empty"), { code: "ENOENT" });
});
