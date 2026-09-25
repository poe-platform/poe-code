import { expect, test } from "vitest";
import { MockS3Client } from "../../../../src/fs/s3/mock.js";
import { S3FileSystem } from "../../../../src/fs/s3/filesystem.ts";
import { scopeFileSystem } from "../../../../src/fs/scoped.js";
import { ReadOnlyFileSystem } from "../../../../src/fs/readonly/index.js";

async function fixture(count: number, pageSize = 1000) {
  const transport = new MockS3Client({ buckets: ["test"], pageSize });
  for (let index = 0; index < count; index++) {
    await transport.putObject({ Bucket: "test", Key: `dir/${index}`, Body: new Uint8Array([1]) });
  }
  return transport;
}

test("default removal budget rejects amplified deletion before mutation", async () => {
  const transport = await fixture(1500);
  const fs = new S3FileSystem({ transport, bucket: "test" });
  const start = transport.requests.length;
  await expect(fs.rm("/dir", { recursive: true })).rejects.toMatchObject({ code: "EFBIG" });
  const requests = transport.requests.slice(start);
  expect(requests.length).toBeLessThanOrEqual(32);
  expect(requests.filter(request => request.operation === "deleteObject")).toHaveLength(0);
});

test("nonrecursive removal inspects only a small page to detect children", async () => {
  const transport = await fixture(1500);
  const fs = new S3FileSystem({ transport, bucket: "test" });
  const start = transport.requests.length;
  await expect(fs.rm("/dir")).rejects.toMatchObject({ code: "ENOTEMPTY" });
  const requests = transport.requests.slice(start);
  expect(requests.length).toBeLessThan(10);
  expect(requests.filter(request => request.operation === "listObjectsV2")
    .every(request => "MaxKeys" in request.input && request.input.MaxKeys! <= 2)).toBe(true);
});

test("configured delete cap and aggregate request reservation reject before mutation", async () => {
  for (const limits of [{ maxDeleteObjects: 2 }, { maxRequests: 8 }]) {
    const transport = await fixture(4, 1);
    const fs = new S3FileSystem({ transport, bucket: "test", removalLimits: limits });
    const start = transport.requests.length;
    await expect(fs.rm("/dir", { recursive: true })).rejects.toMatchObject({ code: "EFBIG" });
    const requests = transport.requests.slice(start);
    expect(requests.length).toBeLessThanOrEqual(limits.maxRequests ?? 32);
    expect(requests.some(request => request.operation === "deleteObject")).toBe(false);
  }
});

test("larger configured budgets allow intentional bulk removal", async () => {
  const transport = await fixture(40, 3);
  const fs = new S3FileSystem({ transport, bucket: "test",
    removalLimits: { maxRequests: 100, maxListEntries: 100, maxDeleteObjects: 40 } });
  const start = transport.requests.length;
  await fs.rm("/dir", { recursive: true });
  expect(transport.requests.slice(start).filter(request => request.operation === "deleteObject")).toHaveLength(40);
});

test("listing entries are counted across pages and lookup before deletion", async () => {
  const transport = await fixture(10, 1);
  const fs = new S3FileSystem({ transport, bucket: "test", removalLimits: { maxListEntries: 4 } });
  const start = transport.requests.length;
  await expect(fs.rm("/dir", { recursive: true })).rejects.toMatchObject({ code: "EFBIG" });
  expect(transport.requests.slice(start).some(request => request.operation === "deleteObject")).toBe(false);
});

test("small removals and concurrent calls have independent budgets", async () => {
  const transport = await fixture(2);
  const fs = new S3FileSystem({ transport, bucket: "test", removalLimits: { maxRequests: 8 } });
  await Promise.all([fs.rm("/dir/0"), fs.rm("/dir/1")]);
  await transport.putObject({ Bucket: "test", Key: "empty/", Body: new Uint8Array() });
  await fs.rm("/empty");
  await expect(fs.stat("/empty")).rejects.toMatchObject({ code: "ENOENT" });
});

test("removal budgets reject invalid configuration", () => {
  const transport = new MockS3Client({ buckets: ["test"] });
  for (const value of [0, -1, 1.5, Infinity]) {
    for (const key of ["maxRequests", "maxListEntries", "maxDeleteObjects"]) {
      expect(() => new S3FileSystem({ transport, bucket: "test", removalLimits: { [key]: value } }))
        .toThrow(expect.objectContaining({ code: "EINVAL" }));
    }
  }
});

test("#709: S3FileSystem maxRequests and scopeFileSystem budget S3 transport calls including nested lookups", async () => {
  const transport = await fixture(6);
  for (const invalid of [0, -1, 1.5, Infinity]) {
    expect(() => new S3FileSystem({ transport, bucket: "test", maxRequests: invalid }))
      .toThrow(expect.objectContaining({ code: "EINVAL" }));
  }

  const capped = new S3FileSystem({ transport, bucket: "test", maxRequests: 4 });
  const beforeCapped = transport.requests.length;
  await expect(capped.stat("/dir/0")).resolves.toMatchObject({ type: "file" });
  await expect(capped.stat("/dir/1")).rejects.toMatchObject({ code: "EFBIG" });
  expect(transport.requests.length - beforeCapped).toBe(4);

  const raw = new S3FileSystem({ transport, bucket: "test" });
  let charges = 0;
  const controller = new AbortController();
  const scoped = scopeFileSystem(raw, () => {
    if (++charges > 5) {
      const error = new Error("maxFileSystemOperations");
      controller.abort(error);
      throw error;
    }
  }, controller.signal);
  const beforeScoped = transport.requests.length;
  await expect(scoped.stat("/dir/0")).resolves.toMatchObject({ type: "file" });
  await expect(scoped.stat("/dir/1")).rejects.toThrow("maxFileSystemOperations");
  expect(transport.requests.length - beforeScoped).toBeLessThanOrEqual(5);
});

for (const limited of ["none", "outer", "inner"]) test(`nested scoped lazy S3 reads preserve ${limited} transport budget`, async () => {
  const transport = await fixture(1);
  const raw = new S3FileSystem({ transport, bucket: "test" });
  const failure = new Error(`${limited} transport limit`);
  let outerCharges = 0;
  let innerCharges = 0;
  const signal = new AbortController().signal;
  const inner = scopeFileSystem(raw, () => {
    if (++innerCharges > 2 && limited === "inner") throw failure;
  }, signal);
  const outer = scopeFileSystem(new ReadOnlyFileSystem(inner), () => {
    if (++outerCharges > 2 && limited === "outer") throw failure;
  }, signal);
  const before = transport.requests.length;
  const source = outer.readStream!("/dir/0");
  expect(transport.requests.length).toBe(before);
  const read = async () => {
    const bytes: number[] = [];
    for await (const chunk of source) bytes.push(...chunk);
    return bytes;
  };
  if (limited === "none") {
    await expect(read()).resolves.toEqual([1]);
    const requests = transport.requests.length - before;
    expect(requests).toBeGreaterThan(2);
    expect(outerCharges).toBe(requests);
    expect(innerCharges).toBe(requests);
  } else {
    await expect(read()).rejects.toBe(failure);
    expect(transport.requests.length - before).toBe(2);
    expect(transport.requests.slice(before).some(request => request.operation === "getObject")).toBe(false);
  }
});

test("concurrent S3 scopes isolate paused request contexts", async () => {
  const transport = await fixture(2);
  const raw = new S3FileSystem({ transport, bucket: "test" });
  const head = transport.headObject.bind(transport);
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const paused = new Promise<void>(resolve => { release = resolve; });
  transport.headObject = async (input, options) => {
    if (input.Key === "dir/0") { enter(); await paused; }
    return head(input, options);
  };
  let leftCharges = 0;
  let rightCharges = 0;
  const failure = new Error("left scope limit");
  const signal = new AbortController().signal;
  const left = scopeFileSystem(raw, () => { if (++leftCharges > 3) throw failure; }, signal);
  const right = scopeFileSystem(raw, () => { rightCharges++; }, signal);
  const pending = expect(left.readFile("/dir/0")).rejects.toBe(failure);
  await entered;
  try {
    const before = transport.requests.length;
    await expect(right.stat("/dir/1")).resolves.toMatchObject({ type: "file", size: 1 });
    expect(leftCharges).toBe(3);
    expect(rightCharges).toBe(transport.requests.length - before);
    expect(rightCharges).toBeGreaterThan(3);
  } finally { release(); await pending; }
  expect(leftCharges).toBe(4);
});
