import { expect, test } from "vitest";
import { collectBytes } from "../src/contracts/io.js";
import { MemoryFileSystem, tryReadMemoryFileViewSync } from "../src/fs/memory/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { MockS3Client, S3FileSystem } from "../src/fs/s3/index.js";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { createS3NamespaceFileSystem } from "../src/fs/s3/namespace.js";
import { parseXml } from "../src/fs/webdav/xml.js";
import { MockDav } from "./migration/fs/webdav/mock.js";

const bytes = Uint8Array.of(1, 2, 3);

test("S3 accepts explicit unlimited read, stream, listing, request and removal limits", async () => {
  const transport = new MockS3Client({ buckets: ["bucket"], pageSize: 1 });
  const fs = new S3FileSystem({ transport, bucket: "bucket", maxReadBytes: Infinity,
    maxStreamBytes: Infinity, maxListEntries: Infinity, maxRequests: Infinity,
    removalLimits: { maxRequests: Infinity, maxListEntries: Infinity, maxDeleteObjects: Infinity } });
  await fs.mkdir("/dir");
  for (let i = 0; i < 40; i++) await fs.writeFile(`/dir/${i}`, bytes);
  expect(await fs.readFile("/dir/0", { maxBytes: Infinity })).toEqual(bytes);
  expect(await collectBytes(fs.readStream!("/dir/0"), {})).toEqual(bytes);
  expect(await fs.readdir("/dir")).toHaveLength(40);
  await fs.rm("/dir", { recursive: true });
  await expect(fs.stat("/dir")).rejects.toMatchObject({ code: "ENOENT" });
});

test("overlay accepts unlimited buffering and per-read bytes", async () => {
  const lower = new MemoryFileSystem();
  await lower.writeFile("/f", bytes);
  const fs = new OverlayFileSystem({ upper: new MemoryFileSystem(), lower, maxBufferBytes: Infinity });
  expect(await fs.readFile("/f", { maxBytes: Infinity })).toEqual(bytes);
  await fs.appendFile("/f", bytes);
  expect(await fs.readFile("/f", { maxBytes: Infinity })).toEqual(Uint8Array.of(...bytes, ...bytes));
});

test("WebDAV accepts unlimited response, XML, listing and per-read bytes", async () => {
  const mock = new MockDav();
  mock.files.set("/f", bytes);
  const fs = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: mock.fetch,
    maxEntries: Infinity, maxResponseBytes: Infinity, maxXmlBytes: Infinity });
  expect(await fs.readdir("/")).toHaveLength(1);
  expect(await fs.readFile("/f", { maxBytes: Infinity })).toEqual(bytes);
});

test("quota accepts unlimited storage, scan entries and scan depth", async () => {
  const fs = withFileSystemQuota(new MemoryFileSystem(), {
    maxBytes: Infinity, maxScanEntries: Infinity, maxScanDepth: Infinity,
  });
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/f", bytes);
  await fs.appendFile("/dir/f", bytes);
  expect(await fs.readFile("/dir/f")).toEqual(Uint8Array.of(...bytes, ...bytes));
});

test("collectBytes accepts explicit unlimited memory", async () => {
  const source = (async function* () { yield bytes; yield bytes; })();
  expect(await collectBytes(source, { maxBytes: Infinity, maxMemoryBytes: Infinity }))
    .toEqual(Uint8Array.of(...bytes, ...bytes));
});

test.each([NaN, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("resource limits still reject invalid value %s", async value => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/f", bytes);
  await expect(memory.readFile("/f", { maxBytes: value })).rejects.toMatchObject({ code: "EINVAL" });
  expect(() => tryReadMemoryFileViewSync(memory, "/f", value)).toThrow(expect.objectContaining({ code: "EINVAL" }));
  await expect(new DeviceFileSystem(memory).readFile("/dev/null", { maxBytes: value })).rejects.toMatchObject({ code: "EINVAL" });
  expect(() => new OverlayFileSystem({ upper: memory, lower: memory, maxBufferBytes: value })).toThrow();
  expect(() => withFileSystemQuota(memory, { maxBytes: value })).toThrow();
  for (const key of ["maxScanEntries", "maxScanDepth"]) {
    expect(() => withFileSystemQuota(memory, { maxBytes: Infinity, [key]: value })).toThrow();
  }
  const transport = new MockS3Client({ buckets: ["bucket"] });
  for (const key of ["maxReadBytes", "maxStreamBytes", "maxListEntries", "maxRequests"]) {
    expect(() => new S3FileSystem({ transport, bucket: "bucket", [key]: value })).toThrow();
  }
  for (const key of ["maxResponseBytes", "maxXmlBytes", "maxEntries"]) {
    expect(() => new WebDavFileSystem({ baseUrl: "https://example.invalid/", fetch: new MockDav().fetch, [key]: value })).toThrow();
  }
  await expect(collectBytes((async function* () { yield bytes; })(), { maxMemoryBytes: value })).rejects.toThrow(RangeError);
});

test("Infinity does not become a valid mode, page size, offset, chunk size or truncate length", async () => {
  const transport = new MockS3Client({ buckets: ["bucket"] });
  expect(() => new S3FileSystem({ transport, bucket: "bucket", pageSize: Infinity })).toThrow();
  const s3 = new S3FileSystem({ transport, bucket: "bucket" });
  const overlay = new OverlayFileSystem({ upper: new MemoryFileSystem(), lower: new MemoryFileSystem() });
  const dav = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: new MockDav().fetch });
  await expect(s3.writeFile("/f", bytes, { mode: Infinity })).rejects.toMatchObject({ code: "EINVAL" });
  for (const fs of [s3, overlay, dav]) {
    await fs.writeFile("/f", bytes);
    await expect(fs.truncate("/f", Infinity)).rejects.toThrow();
    for (const options of [{ start: Infinity }, { chunkSize: Infinity }]) {
      await expect(collectBytes(fs.readStream!("/f", options), {})).rejects.toThrow();
    }
  }
});

for (const adapter of ["memory", "overlay", "mount", "device", "readonly", "quota", "s3", "webdav", "namespace"] as const) {
  test(`${adapter} accepts unlimited per-operation reads and directory listings`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/f", bytes);
    const dav = new MockDav();
    dav.files.set("/f", bytes);
    const transport = new MockS3Client({ buckets: ["bucket"] });
    const fs = adapter === "memory" ? memory
      : adapter === "overlay" ? new OverlayFileSystem({ upper: new MemoryFileSystem(), lower: memory })
      : adapter === "mount" ? new MountFileSystem({ root: memory })
      : adapter === "device" ? new DeviceFileSystem(memory)
      : adapter === "readonly" ? new ReadOnlyFileSystem(memory)
      : adapter === "quota" ? withFileSystemQuota(memory, { maxBytes: Infinity })
      : adapter === "s3" ? new S3FileSystem({ transport, bucket: "bucket" })
      : adapter === "webdav" ? new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: dav.fetch })
      : await createS3NamespaceFileSystem({ client: transport, bucket: "bucket", key: "manifest",
        maxBytes: Infinity, maxEntries: Infinity, maxManifestBytes: Infinity, maxAttempts: Infinity,
        maxStagedBytes: Infinity, maxStagedPages: Infinity, maxFileBytes: Infinity, maxOpenFiles: Infinity });
    if (adapter === "s3" || adapter === "namespace") await fs.writeFile("/f", bytes);
    expect(await fs.readFile("/f", { maxBytes: Infinity })).toEqual(bytes);
    expect(await fs.readdir("/", { maxEntries: Infinity })).toEqual(await fs.readdir("/"));
    await expect(fs.readFile("/f", { maxBytes: 2 })).rejects.toMatchObject({ code: "EFBIG" });
    await expect(fs.readdir("/", { maxEntries: 0 })).rejects.toMatchObject({ code: "EFBIG" });
  });
}

test("memory synchronous views accept unlimited bytes while enforcing finite caps", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/f", bytes);
  expect(tryReadMemoryFileViewSync(fs, "/f", Infinity)).toEqual(bytes);
  expect(() => tryReadMemoryFileViewSync(fs, "/f", 2)).toThrow(expect.objectContaining({ code: "EFBIG" }));
});

test("null device accepts unlimited reads without allowing infinite stream sizes", async () => {
  const fs = new DeviceFileSystem(new MemoryFileSystem());
  expect(await fs.readFile("/dev/null", { maxBytes: Infinity })).toEqual(new Uint8Array());
  expect(await fs.readFile("/dev/null", { maxBytes: 0 })).toEqual(new Uint8Array());
  await expect(collectBytes(fs.readStream("/dev/null", { chunkSize: Infinity }), {})).rejects.toMatchObject({ code: "EINVAL" });
});

test("WebDAV XML accepts unlimited response counts and still enforces finite limits", () => {
  const xml = '<multistatus xmlns="DAV:"><response/><response/></multistatus>';
  expect(parseXml(xml, { maxResponses: Infinity }).children).toHaveLength(2);
  expect(() => parseXml(xml, { maxResponses: 1 })).toThrow("response limit exceeded");
  for (const maxResponses of [NaN, -Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => parseXml(xml, { maxResponses })).toThrow(RangeError);
  }
});
