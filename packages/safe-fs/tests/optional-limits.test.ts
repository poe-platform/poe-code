import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { PythonFileSystem } from "../src/python/filesystem.js";
import { parseXml } from "../src/xml.js";
import { retainFileSystemCleanup } from "../src/fs/scoped.js";

it.each([{}, { maxMetadataUnits: 10 }, { maxRetainedBytes: 32 * 1024 * 1024 }])("omitted memory file quotas stay unlimited with %j", async options => {
  const fs = new MemoryFileSystem(options);
  const bytes = new Uint8Array(16 * 1024 * 1024 + 1);
  await fs.writeFile("/large", bytes);
  expect((await fs.stat("/large")).size).toBe(bytes.length);
});

it("omitted XML quotas stay unlimited when another limit is supplied", () => {
  const xml = "<r>".repeat(65) + "</r>".repeat(65);
  expect(parseXml(xml, { maxNodes: 100 }).localName).toBe("r");
  expect(() => parseXml(xml, { maxDepth: 64 })).toThrow("resource limit");
  const attributes = Array.from({ length: 129 }, (_, i) => ` a${i}="x"`).join("");
  expect(parseXml(`<r${attributes}/>`, { maxNodes: 1 }).attributes).toHaveLength(129);
});

it("omitted Python handle quotas stay unlimited while explicit ones are honored", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/f", new Uint8Array());
  const bridge = new PythonFileSystem(fs, { cwd: "/", maxDirectoryEntries: 1 });
  const limited = new PythonFileSystem(fs, { cwd: "/", maxOpenFiles: 1 });
  try {
    for (let i = 0; i < 257; i++) await bridge.dispatch({ op: "open", args: ["/f", { access: "read" }] });
    await limited.dispatch({ op: "open", args: ["/f", { access: "read" }] });
    await expect(limited.dispatch({ op: "open", args: ["/f", { access: "read" }] })).rejects.toMatchObject({ code: "EMFILE" });
  } finally { await bridge.close(); await limited.close(); }
});

it("cleanup has no default operation quota or ceiling on explicit quotas", async () => {
  const fs = new MemoryFileSystem();
  const rm = vi.spyOn(fs, "rm").mockResolvedValue(undefined);
  const clean = retainFileSystemCleanup(fs, async view => {
    for (let i = 0; i < 257; i++) await view.rm("/f");
  });
  await clean();
  expect(rm).toHaveBeenCalledTimes(257);
  expect(() => retainFileSystemCleanup(fs, () => {}, { maxOperations: 4097 })).not.toThrow();
});

it("overlay has no default buffered file quota", async () => {
  const upper = new MemoryFileSystem();
  const lower = new MemoryFileSystem();
  const fs = new OverlayFileSystem({ upper, lower });
  expect(Reflect.get(fs, "maxBufferBytes")).toBe(Infinity);
  const limited = new OverlayFileSystem({ upper, lower, maxBufferBytes: 1 });
  await expect(limited.writeFile("/f", Uint8Array.of(1, 2))).rejects.toMatchObject({ code: "EFBIG" });
});

it.each([{}, { maxFileBytes: 1 }])("object descriptors omit unrelated handle quotas with %j", async options => {
  const { withObjectFileDescriptors } = await import("../src/fs/object-publication/index.js");
  const storage = new MemoryFileSystem();
  await storage.writeFile("/f", new Uint8Array());
  const stat = await storage.stat("/f");
  const fs = withObjectFileDescriptors(storage, { acquire: async () => ({ revision: "v1", stat, read: async () => new Uint8Array(), close: async () => {} }) }, options);
  const handles = [];
  try {
    for (let i = 0; i < 65; i++) handles.push(await fs.open!("/f", { access: "read" }));
  } finally { await Promise.all(handles.map(handle => handle.close())); }
});

it("S3 resource quotas are unlimited and explicit settings can exceed the former ceilings", async () => {
  const { S3FileSystem, MockS3Client } = await import("../src/fs/s3/index.js");
  const transport = new MockS3Client({ buckets: ["bucket"] });
  const fs = new S3FileSystem({ transport, bucket: "bucket", maxListEntries: 1 });
  expect(Reflect.get(fs, "maxReadBytes")).toBe(Infinity);
  expect(Reflect.get(fs, "maxStreamBytes")).toBe(Infinity);
  expect(() => new S3FileSystem({ transport, bucket: "bucket", maxStreamBytes: 5_000_000_001 })).not.toThrow();
  await fs.writeFile("/f", Uint8Array.of(1, 2));
  expect(await fs.readFile("/f")).toEqual(Uint8Array.of(1, 2));
  await expect(fs.readFile("/f", { maxBytes: 1 })).rejects.toMatchObject({ code: "EFBIG" });
});

it("WebDAV response defaults are bounded while deadlines remain opt-in", async () => {
  const { WebDavFileSystem } = await import("../src/fs/webdav/webdav.js");
  const { MockDav } = await import("./migration/fs/webdav/mock.js");
  const mock = new MockDav();
  mock.files.set("/f", Uint8Array.of(1, 2));
  const fs = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: mock.fetch, maxEntries: 1 });
  expect(Reflect.get(fs, "maxResponseBytes")).toBe(16 * 1024 * 1024);
  expect(Reflect.get(fs, "maxXmlBytes")).toBe(1024 * 1024);
  expect(Reflect.get(fs, "timeoutMs")).toBeUndefined();
  expect(await fs.readFile("/f")).toEqual(Uint8Array.of(1, 2));
  await expect(fs.readFile("/f", { maxBytes: 1 })).rejects.toMatchObject({ code: "EFBIG" });
});

it("S3 HTTP accepts explicit quotas above former implicit ceilings", async () => {
  const { createS3HttpTransport } = await import("../src/fs/s3/http/transport.js");
  expect(() => createS3HttpTransport({ endpoint: "https://example.invalid", region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    maxGetBytes: 2 * 1024 * 1024 * 1024, maxPutBytes: 2 * 1024 * 1024 * 1024, maxXmlBytes: 17 * 1024 * 1024,
  })).not.toThrow();
});

it("Python directory listings do not forward an omitted quota to the backend", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a", new Uint8Array());
  await fs.writeFile("/b", new Uint8Array());
  const bridge = new PythonFileSystem(fs, { cwd: "/", maxOpenFiles: 1 });
  const limited = new PythonFileSystem(fs, { cwd: "/", maxDirectoryEntries: 1 });
  try {
    expect(await bridge.dispatch({ op: "readdir", args: ["/"] })).toHaveLength(2);
    await expect(limited.dispatch({ op: "readdir", args: ["/"] })).rejects.toMatchObject({ code: "EFBIG" });
  } finally { await bridge.close(); await limited.close(); }
});

it("S3 namespace limits are independent and no longer capped by implicit maxima", async () => {
  const { createS3NamespaceFileSystem } = await import("../src/fs/s3/namespace.js");
  const { MockS3Client } = await import("../src/fs/s3/mock.js");
  const client = new MockS3Client({ buckets: ["owned"] });
  const options = { client, bucket: "owned", key: "namespace.json" };
  const fs = await createS3NamespaceFileSystem({ ...options, maxEntries: 10 });
  const bytes = new Uint8Array(1024 * 1024 + 1);
  await fs.writeFile("/f", bytes);
  expect((await fs.stat("/f")).size).toBe(bytes.length);
  await createS3NamespaceFileSystem({ ...options, maxBytes: 67108865, maxEntries: 65537, maxManifestBytes: 268435457 });
  const limited = await createS3NamespaceFileSystem({ ...options, key: "limited.json", maxBytes: 1 });
  await expect(limited.writeFile("/f", Uint8Array.of(1, 2))).rejects.toMatchObject({ code: "ENOSPC" });
  await fs.writeFile("/f", new Uint8Array());
  const handles = [];
  try {
    for (let i = 0; i < 17; i++) handles.push(await fs.open!("/f", { access: "read" }));
  } finally { await Promise.all(handles.map(handle => handle.close())); }
});

it("mount buffered transfers do not impose a file quota", async () => {
  const { MountFileSystem } = await import("../src/fs/mount/index.js");
  const reader = new MemoryFileSystem();
  const writer = new MemoryFileSystem();
  await reader.writeFile("/f", Uint8Array.of(1));
  Object.defineProperty(reader, "capabilities", { value: { ...reader.capabilities, streamingRead: false } });
  const read = vi.spyOn(reader, "readFile");
  const fs = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/from": reader, "/to": writer } });
  await fs.copyFile("/from/f", "/to/f");
  expect(read.mock.calls[0]![1]).not.toHaveProperty("maxBytes");
  expect(await writer.readFile("/f")).toEqual(Uint8Array.of(1));
});

it("object staging has no default page-count quota when only bytes are limited", async () => {
  const { withObjectFileDescriptors } = await import("../src/fs/object-publication/index.js");
  const storage = new MemoryFileSystem();
  await storage.writeFile("/f", new Uint8Array());
  const stat = await storage.stat("/f");
  const version = { revision: "v1", stat, read: async () => new Uint8Array(), close: async () => {} };
  const store = { acquire: async () => version, publish: async (_path: string, _revision: string | null, source: AsyncIterable<Uint8Array>) => {
    let size = 0;
    for await (const chunk of source) size += chunk.length;
    return { ...version, revision: "v2", stat: { ...stat, size } };
  } };
  const fs = withObjectFileDescriptors(storage, store, { chunkBytes: 1, maxStagedBytes: 5000 });
  const handle = await fs.open!("/f", { access: "write" });
  try { expect(await handle.write(new Uint8Array(4097), 0)).toBe(4097); }
  finally { await handle.close(); }
  const limited = withObjectFileDescriptors(storage, store, { chunkBytes: 1, maxStagedPages: 1 });
  const writer = await limited.open!("/f", { access: "write" });
  try { await expect(writer.write(Uint8Array.of(1, 2), 0)).rejects.toMatchObject({ code: "ENOSPC" }); }
  finally { await writer.close(); }
});
