import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate as turn } from "node:timers/promises";
import test from "node:test";
import { FsError } from "../../../../../src/contracts/errors.js";
import { MockS3Client, S3FileSystem, S3ServiceError, createS3Transport } from "../../../../../src/fs/s3/index.js";
import type { S3ListOutput, S3Transport } from "../../../../../src/fs/s3/index.js";

const marker = { Key: "mount/empty/", Size: 0 };
const complete: S3ListOutput = { Contents: [marker], IsTruncated: false };

async function fixture(overrides: (base: S3Transport, client: MockS3Client) => Partial<S3Transport> = () => ({}), limits = {}) {
  const client = new MockS3Client({ buckets: ["bucket"], pageSize: 1 });
  await client.putObject({ Bucket: "bucket", Key: marker.Key, Body: new Uint8Array() });
  const base = createS3Transport(client, {});
  const fs = new S3FileSystem({ transport: { ...base, ...overrides(base, client) }, bucket: "bucket", prefix: "mount", pageSize: 1, ...limits });
  const deletes = () => client.requests.filter(request => request.operation === "deleteObject");
  const present = async () => { await client.headObject({ Bucket: "bucket", Key: marker.Key }); };
  return { client, fs, deletes, present };
}

function rejected(code: string, path = "/empty"): (error: unknown) => boolean {
  return error => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, code);
    assert.equal(error.syscall, "rmdir");
    assert.equal(error.path, path);
    return true;
  };
}

test("snapshot capability is frozen and does not enable atomic rename or conditional DELETE", async () => {
  const { fs, deletes } = await fixture();
  assert.equal(fs.capabilities.snapshotRmdir, true);
  assert.equal(fs.capabilities.atomicRename, false);
  assert.equal(Object.isFrozen(fs.capabilities), true);
  await fs.rmdir("/empty");
  assert.deepEqual(deletes().map(request => request.input), [{ Bucket: "bucket", Key: marker.Key }]);
  await assert.rejects(fs.stat("/empty"), { code: "ENOENT" });
});

for (const pageSize of [1, 2, 1000]) {
  test(`removal requests at least two keys and paginates with configured pageSize=${pageSize}`, async () => {
    const requests: { maxKeys: number | undefined; token: string | undefined }[] = [];
    const { fs, client, deletes, present } = await fixture(base => ({
      listObjectsV2: (input, options) => {
        if (input.Prefix === marker.Key && input.Delimiter === "/") {
          requests.push({ maxKeys: input.MaxKeys, token: input.ContinuationToken });
          if (input.MaxKeys === 1 && !input.ContinuationToken) return Promise.resolve(complete);
        }
        return base.listObjectsV2(input, options);
      },
    }), { pageSize });
    await client.putObject({ Bucket: "bucket", Key: `${marker.Key}child`, Body: new Uint8Array([255]) });
    await assert.rejects(fs.rmdir("/empty"), rejected("ENOTEMPTY"));
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => request.maxKeys === Math.max(2, pageSize)));
    assert.equal(requests[0]!.token, undefined);
    assert.equal(typeof requests[1]!.token, "string");
    assert.equal(deletes().length, 0);
    await present();
    assert.deepEqual(await fs.readFile("/empty/child"), new Uint8Array([255]));
  });
}

test("an empty intermediate page is not completion; deletion waits for the marker and final page", async () => {
  const events: string[] = [];
  const { fs, deletes } = await fixture(base => ({
    listObjectsV2: (input, options) => {
      if (input.Prefix !== marker.Key || input.Delimiter !== "/") return base.listObjectsV2(input, options);
      events.push(input.ContinuationToken ? "final" : "intermediate");
      return Promise.resolve(input.ContinuationToken ? complete : { Contents: [], IsTruncated: true, NextContinuationToken: "next" });
    },
    deleteObject: (input, options) => { events.push("delete"); return base.deleteObject(input, options); },
  }));
  await fs.rmdir("/empty");
  assert.deepEqual(events, ["intermediate", "final", "delete"]);
  assert.equal(deletes().length, 1);
});

for (const [name, pages, code] of [
  ["missing completeness flag", [{ Contents: [marker] }], "EIO"],
  ["missing continuation token", [{ Contents: [marker], IsTruncated: true }], "EIO"],
  ["repeated continuation token", [{ Contents: [marker], IsTruncated: true, NextContinuationToken: "same" },
    { Contents: [], IsTruncated: true, NextContinuationToken: "same" }], "EIO"],
  ["out of prefix entry", [{ Contents: [{ Key: "other/", Size: 0 }], IsTruncated: false }], "EIO"],
  ["unrepresentable entry", [{ Contents: [{ Key: "mount/empty//child", Size: 0 }], IsTruncated: false }], "ENOTSUP"],
  ["disappeared marker", [{ Contents: [], IsTruncated: false }], "ENOENT"],
] as const) {
  test(`${name} refuses before deletion`, async () => {
    let index = 0;
    const { fs, deletes, present } = await fixture(base => ({ listObjectsV2: (input, options) =>
      input.Prefix === marker.Key && input.Delimiter === "/" ? Promise.resolve(pages[index++]!) : base.listObjectsV2(input, options) }));
    await assert.rejects(fs.rmdir("/empty"), rejected(code));
    assert.equal(deletes().length, 0);
    await present();
  });
}

test("listing budget failure does not delete a marker", async () => {
  let count = 0;
  const { fs, deletes, present } = await fixture(base => ({ listObjectsV2: (input, options) =>
    input.Prefix === marker.Key && input.Delimiter === "/"
      ? Promise.resolve({ Contents: [], IsTruncated: true, NextContinuationToken: String(++count) }) : base.listObjectsV2(input, options) }), { maxListEntries: 1 });
  await assert.rejects(fs.rmdir("/empty"), rejected("EFBIG"));
  assert.equal(deletes().length, 0);
  await present();
});

for (const representation of ["file-prefix", "nonempty-marker"]) {
  test(`${representation} ambiguity is unchanged and not deleted`, async () => {
    const { fs, client, deletes } = await fixture();
    const key = representation === "file-prefix" ? "mount/empty" : marker.Key;
    await client.putObject({ Bucket: "bucket", Key: key, Body: new Uint8Array([1]) });
    await assert.rejects(fs.rmdir("/empty"), rejected("ENOTSUP"));
    assert.equal(deletes().length, 0);
    await client.headObject({ Bucket: "bucket", Key: key });
  });
}

test("an implicit directory losing its final child does not authorize marker deletion", async () => {
  const { fs, client } = await fixture((base, backend) => ({ listObjectsV2: async (input, options) => {
    if (input.Prefix === "mount/implicit/" && input.Delimiter === "/") {
      await backend.deleteObject({ Bucket: "bucket", Key: "mount/implicit/child" });
    }
    return base.listObjectsV2(input, options);
  } }));
  await client.putObject({ Bucket: "bucket", Key: "mount/implicit/child", Body: new Uint8Array([1]) });
  await assert.rejects(fs.rmdir("/implicit"), rejected("ENOTSUP", "/implicit"));
  assert.deepEqual(client.requests.filter(request => request.operation === "deleteObject").map(request => request.input),
    [{ Bucket: "bucket", Key: "mount/implicit/child" }]);
});

test("late byte child, nested marker and nested bytes survive; no rollback or ENOTEMPTY after delete", async () => {
  const { fs, client, deletes } = await fixture((base, backend) => ({ listObjectsV2: async (input, options) => {
    const page = await base.listObjectsV2(input, options);
    if (input.Prefix === marker.Key && input.Delimiter === "/" && !page.IsTruncated) {
      await backend.putObject({ Bucket: "bucket", Key: `${marker.Key}child`, Body: new Uint8Array([0, 255]) });
      await backend.putObject({ Bucket: "bucket", Key: `${marker.Key}nested/`, Body: new Uint8Array() });
      await backend.putObject({ Bucket: "bucket", Key: `${marker.Key}nested/child`, Body: new Uint8Array([128]) });
    }
    return page;
  } }));
  await fs.rmdir("/empty");
  assert.deepEqual(deletes().map(request => request.input), [{ Bucket: "bucket", Key: marker.Key }]);
  await assert.rejects(client.headObject({ Bucket: "bucket", Key: marker.Key }), { code: "NoSuchKey" });
  await client.headObject({ Bucket: "bucket", Key: `${marker.Key}nested/` });
  assert.deepEqual(await fs.readFile("/empty/child"), new Uint8Array([0, 255]));
  assert.deepEqual(await fs.readFile("/empty/nested/child"), new Uint8Array([128]));
  assert.equal((await fs.stat("/empty")).type, "directory");
});

test("unconditional exact-marker deletion can affect a replacement with the same ETag", async () => {
  const { fs, client, deletes } = await fixture((base, backend) => ({ deleteObject: async (input, options) => {
    const before = await backend.headObject(input);
    const replaced = await backend.putObject({ ...input, Body: new Uint8Array(), Metadata: { generation: "new" } });
    assert.equal(replaced.ETag, before.ETag);
    assert.equal(input.IfMatch, undefined);
    return base.deleteObject(input, options);
  } }));
  await fs.rmdir("/empty");
  assert.equal(deletes().length, 1);
  await assert.rejects(client.headObject({ Bucket: "bucket", Key: marker.Key }), { code: "NoSuchKey" });
});

for (const [serviceCode, status, code] of [["AccessDenied", 403, "EACCES"], ["SlowDown", 503, "EAGAIN"], ["InternalError", 500, "EIO"]] as const) {
  test(`delete ${serviceCode} preserves typed requested error and does not retry`, async () => {
    let attempts = 0;
    const cause = new S3ServiceError(serviceCode, status);
    const { fs, present } = await fixture(() => ({ deleteObject: async () => { attempts++; throw cause; } }));
    await assert.rejects(fs.rmdir("/empty/"), error => {
      rejected(code, "/empty/")(error);
      assert.ok(error instanceof FsError && error.cause instanceof FsError);
      assert.equal(error.cause.cause, cause);
      return true;
    });
    assert.equal(attempts, 1);
    await present();
  });
}

test("delete response loss retains the error without reinserting the removed marker", async () => {
  const { fs, deletes, client } = await fixture(base => ({ deleteObject: async (input, options) => {
    await base.deleteObject(input, options);
    throw new S3ServiceError("InternalError", 500);
  } }));
  await assert.rejects(fs.rmdir("/empty"), rejected("EIO"));
  assert.equal(deletes().length, 1);
  await assert.rejects(client.headObject({ Bucket: "bucket", Key: marker.Key }), { code: "NoSuchKey" });
});

for (const effect of [false, true]) {
  test(`in-flight delete abort observes late rejection; host removal already performed=${effect}`, { timeout: 2000 }, async () => {
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    let rejectPending!: (error: Error) => void;
    const pending = new Promise<never>((_resolve, reject) => { rejectPending = reject; });
    const controller = new AbortController();
    const { fs, client } = await fixture(base => ({ deleteObject: async (input, options) => {
      assert.equal(options?.abortSignal, controller.signal);
      if (effect) await base.deleteObject(input, options);
      enter();
      return pending;
    } }));
    const checking = assert.rejects(fs.rmdir("/empty", { signal: controller.signal }), rejected("ECANCELED"));
    await entered;
    controller.abort(new FsError("ENOENT"));
    try { await checking; } finally { rejectPending(new Error("late host error")); }
    await turn();
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    if (effect) await assert.rejects(client.headObject({ Bucket: "bucket", Key: marker.Key }), { code: "NoSuchKey" });
    else await client.headObject({ Bucket: "bucket", Key: marker.Key });
  });
}

test("abort at completed inspection prevents DELETE", async () => {
  const controller = new AbortController();
  const { fs, deletes, present } = await fixture(base => ({ listObjectsV2: async (input, options) => {
    const page = await base.listObjectsV2(input, options);
    if (input.Prefix === marker.Key && input.Delimiter === "/") controller.abort(new FsError("ENOENT"));
    return page;
  } }));
  await assert.rejects(fs.rmdir("/empty", { signal: controller.signal }), rejected("ECANCELED"));
  assert.equal(deletes().length, 0);
  await present();
});

test("uncooperative issued delete may finish after cancellation without rollback", { timeout: 2000 }, async () => {
  let enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let completeHost!: () => void;
  const completedHost = new Promise<void>(resolve => { completeHost = resolve; });
  const controller = new AbortController();
  const { fs, client, present } = await fixture(base => ({ deleteObject: async input => {
    enter();
    await released;
    await base.deleteObject(input);
    completeHost();
    return {};
  } }));
  const checking = assert.rejects(fs.rmdir("/empty", { signal: controller.signal }), rejected("ECANCELED"));
  await entered;
  controller.abort(new FsError("ENOENT"));
  try { await checking; await present(); } finally { release(); }
  await completedHost;
  await turn();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await assert.rejects(client.headObject({ Bucket: "bucket", Key: marker.Key }), { code: "NoSuchKey" });
});
