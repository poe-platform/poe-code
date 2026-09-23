import { expect, test } from "vitest";
import { MockS3Client } from "../../../../src/fs/s3/mock.js";
import { S3FileSystem } from "../../../../src/fs/s3/filesystem.ts";

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
