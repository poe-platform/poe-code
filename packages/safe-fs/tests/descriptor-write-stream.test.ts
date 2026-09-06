import { describe, expect, it, vi } from "vitest";
import type { FileSystem, WriteFileOptions } from "../src/contracts/filesystem.js";
import type { ByteSource } from "../src/contracts/io.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { RealFileSystem } from "../src/fs/real/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { S3FileSystem } from "../src/fs/s3/filesystem.js";
import { MockS3Client } from "../src/fs/s3/mock.js";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = async (filesystem: FileSystem, path = "/file"): Promise<string> => new TextDecoder().decode(await filesystem.readFile(path));

function view(backing: FileSystem, overrides: { [Key in keyof FileSystem]?: FileSystem[Key] | undefined }): FileSystem {
  return new Proxy(Object.create(backing) as FileSystem, {
    get(_target, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value = Reflect.get(backing, property);
      return typeof value === "function" ? value.bind(backing) : value;
    },
  });
}

describe("stock descriptor stream admission", () => {
  it("positively advertises the intact stock profile without filesystem work", () => {
    const filesystem: FileSystem = new MemoryFileSystem();
    expect(filesystem.capabilities.descriptorWriteStream).toBe(true);
    expect(Object.isFrozen(filesystem.capabilities)).toBe(true);
  });

  it.each(["writeStream", "writeFile", "appendFile", "access", "stat", "lstat", "realpath",
    "openWrite", "resolve", "permission", "validatePath", "mode", "bytes", "allocate", "changed", "metadata", "integer", "writeAt", "fail"])(
    "withdraws stock support after replacing %s", (method) => {
      const filesystem: FileSystem = new MemoryFileSystem();
      expect(filesystem.capabilities.descriptorWriteStream).toBe(true);
      Object.defineProperty(filesystem, method, { value: vi.fn(), configurable: true });
      expect(filesystem.capabilities.descriptorWriteStream).toBe(false);
    },
  );

  it("does not execute a replaced policy accessor while checking support", () => {
    const filesystem: FileSystem = new MemoryFileSystem();
    const getter = vi.fn(() => { throw new Error("policy getter"); });
    Object.defineProperty(filesystem, "writeFile", { get: getter });
    expect(filesystem.capabilities.descriptorWriteStream).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it("withdraws inherited subclass and substituted-store claims", () => {
    class CustomizedMemory extends MemoryFileSystem {}
    expect((new CustomizedMemory() as FileSystem).capabilities.descriptorWriteStream).toBe(false);
    const filesystem: FileSystem = new MemoryFileSystem();
    Object.defineProperty(filesystem, "root", { value: Reflect.get(new MemoryFileSystem(), "root") });
    expect(filesystem.capabilities.descriptorWriteStream).toBe(false);
  });

  it("does not endorse the retained getter on a substituted capability policy", () => {
    const filesystem: FileSystem = new MemoryFileSystem();
    const descriptors = Object.getOwnPropertyDescriptors(filesystem.capabilities);
    const replacement = Object.defineProperties({}, { ...descriptors, readOnly: { value: true } });
    Object.defineProperty(filesystem, "capabilities", { value: replacement });
    expect(filesystem.capabilities.descriptorWriteStream).toBe(false);
  });

  it("does not opt in Real, S3 or WebDAV", () => {
    const backends: FileSystem[] = [
      new RealFileSystem({ root: "/unused-mocked-root" }),
      new S3FileSystem({ bucket: "bucket", transport: new MockS3Client({ buckets: ["bucket"] }) }),
      new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: async () => { throw new Error("unexpected network"); } }),
    ];
    for (const backend of backends) expect(backend.capabilities.descriptorWriteStream).toBeUndefined();
  });
});

describe("Memory descriptor stream contents and ownership", () => {
  it.each(["w", "wx"] as const)("%s overwrites at its cursor rather than following an external append", async (flag) => {
    const filesystem = new MemoryFileSystem();
    async function* source() {
      yield bytes("AAAAAAAA");
      expect(await text(filesystem)).toBe("AAAAAAAA");
      await filesystem.appendFile("/file", bytes("X"));
      yield bytes("BBBBBBBB");
      expect(await text(filesystem)).toBe("AAAAAAAABBBBBBBB");
    }
    await filesystem.writeStream("/file", source(), { flag });
  });

  it("preserves the unaffected suffix written by another writer", async () => {
    const filesystem = new MemoryFileSystem();
    async function* source() {
      yield bytes("ab");
      await filesystem.appendFile("/file", bytes("XYZ"));
      yield bytes("C");
    }
    await filesystem.writeStream("/file", source());
    expect(await text(filesystem)).toBe("abCYZ");
  });

  it("retains its position across truncation, zero-fills gaps and ignores empty writes", async () => {
    const filesystem = new MemoryFileSystem();
    async function* source() {
      yield bytes("abcd");
      await filesystem.truncate("/file", 1);
      yield new Uint8Array();
      expect(await text(filesystem)).toBe("a");
      yield bytes("e");
    }
    await filesystem.writeStream("/file", source());
    expect(await filesystem.readFile("/file")).toEqual(Uint8Array.of(97, 0, 0, 0, 101));
  });

  it.each(["a", "ax"] as const)("%s appends to the pinned resource's current EOF", async (flag) => {
    const filesystem = new MemoryFileSystem();
    async function* source() {
      yield bytes("ab");
      await filesystem.appendFile("/file", bytes("X"));
      yield bytes("C");
      expect(await text(filesystem)).toBe("abXC");
      await filesystem.truncate("/file", 1);
      yield bytes("D");
    }
    await filesystem.writeStream("/file", source(), { flag });
    expect(await text(filesystem)).toBe("aD");
  });

  it("pins the opened node across rename, replacement and unlink", async () => {
    const filesystem = new MemoryFileSystem();
    let retained: Awaited<ReturnType<MemoryFileSystem["openReadFile"]>> | undefined;
    async function* source() {
      yield bytes("ab");
      retained = await filesystem.openReadFile("/file");
      await filesystem.rename("/file", "/moved");
      await filesystem.writeFile("/file", bytes("new"));
      yield bytes("C");
      expect(await text(filesystem, "/moved")).toBe("abC");
      await filesystem.rm("/moved");
      yield bytes("D");
    }
    await filesystem.writeStream("/file", source());
    expect(await text(filesystem)).toBe("new");
    expect(new TextDecoder().decode(await retained!.read(0, 4))).toBe("abCD");
    await retained!.close();
  });

  it("keeps independent stream offsets across another open's truncation", async () => {
    const filesystem = new MemoryFileSystem();
    async function* first() {
      yield bytes("A");
      await filesystem.writeStream("/file", [bytes("ZZZ")]);
      yield bytes("B");
    }
    await filesystem.writeStream("/file", first());
    expect(await text(filesystem)).toBe("ZBZ");
  });

  it("copies reused Buffer views into storage before advancing the producer", async () => {
    const filesystem = new MemoryFileSystem();
    const backing = Buffer.from([0, 1, 2, 0]);
    const chunk = backing.subarray(1, 3);
    async function* source() {
      yield chunk;
      expect(await filesystem.readFile("/file")).toEqual(Uint8Array.of(1, 2));
      chunk.fill(3);
      yield chunk;
      chunk.fill(9);
    }
    await filesystem.writeStream("/file", source());
    expect(await filesystem.readFile("/file")).toEqual(Uint8Array.of(1, 2, 3, 3));
  });

  it.each([1, 4, 32])("avoids transient backend copies for 128 bytes in %s-byte chunks", async (chunkSize) => {
    const filesystem = new MemoryFileSystem();
    const internal = filesystem as unknown as {
      bytes(data: Uint8Array): Uint8Array;
      allocate(length: number, syscall: string, path: string): Uint8Array;
      openWrite(path: string, options: WriteFileOptions, syscall: string): unknown;
    };
    const copies = vi.spyOn(internal, "bytes");
    const allocations = vi.spyOn(internal, "allocate");
    const opens = vi.spyOn(internal, "openWrite");
    const stats = vi.spyOn(filesystem, "stat");
    const appends = vi.spyOn(filesystem, "appendFile");
    async function* source() {
      const chunk = new Uint8Array(chunkSize).fill(65);
      for (let offset = 0; offset < 128; offset += chunkSize) yield chunk;
    }
    await filesystem.writeStream("/file", source());
    expect(copies).not.toHaveBeenCalled();
    expect(opens).toHaveBeenCalledTimes(1);
    expect(stats).not.toHaveBeenCalled();
    expect(appends).not.toHaveBeenCalled();
    expect(allocations.mock.calls.map(([length]) => length)).toEqual([64, 128]);
    expect(await filesystem.readFile("/file")).toEqual(new Uint8Array(128).fill(65));
  });

  it.each([false, null, 0, ""])("preserves pre-abort %j before open or source acquisition", async (reason) => {
    const filesystem = new MemoryFileSystem();
    const controller = new AbortController();
    controller.abort(reason);
    const iterator = vi.fn();
    const source: ByteSource = { [Symbol.asyncIterator]: iterator };
    await expect(filesystem.writeStream("/file", source, { signal: controller.signal })).rejects.toBe(reason);
    expect(iterator).not.toHaveBeenCalled();
    await expect(filesystem.stat("/file")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([false, null])("preserves published prefixes and closes the source on abort %j", async (reason) => {
    const filesystem = new MemoryFileSystem();
    const controller = new AbortController();
    let closed = false;
    async function* source() {
      try {
        yield bytes("prefix");
        controller.abort(reason);
        yield bytes("discard");
      } finally { closed = true; }
    }
    await expect(filesystem.writeStream("/file", source(), { signal: controller.signal })).rejects.toBe(reason);
    expect(closed).toBe(true);
    expect(await text(filesystem)).toBe("prefix");
  });

  it("preserves invalid chunk diagnostics and already published bytes", async () => {
    const filesystem = new MemoryFileSystem();
    const source = [bytes("prefix"), "invalid"] as unknown as ByteSource;
    await expect(filesystem.writeStream("/file", source)).rejects.toThrow("Memory files require Uint8Array data");
    expect(await text(filesystem)).toBe("prefix");
  });
});

describe("descriptor stream composition", () => {
  it.each(["readonly", "quota", "overlay"])("masks the stock claim through %s", async (kind) => {
    const memory = new MemoryFileSystem();
    const filesystem: FileSystem = kind === "readonly" ? new ReadOnlyFileSystem(memory)
      : kind === "quota" ? withFileSystemQuota(memory, { maxBytes: 32 })
      : new OverlayFileSystem({ upper: memory, lower: new MemoryFileSystem() });
    expect(filesystem.capabilities.descriptorWriteStream).toBe(false);
    expect((await filesystem.capabilitiesFor?.("/new") ?? filesystem.capabilities).descriptorWriteStream).toBe(false);
  });

  it("forwards selected stock support, not mixed global or unknown backend claims", async () => {
    const memory = new MemoryFileSystem();
    const unknown = view(memory, { capabilities: { write: true, streamingWrite: true } });
    const mounted = new MountFileSystem({ root: unknown, mounts: { "/memory": memory } });
    expect(mounted.capabilities.descriptorWriteStream).not.toBe(true);
    expect((await mounted.capabilitiesFor("/new")).descriptorWriteStream).toBeUndefined();
    expect((await mounted.capabilitiesFor("/memory/new")).descriptorWriteStream).toBe(true);
    async function* source() {
      yield bytes("ab");
      await memory.appendFile("/new", bytes("X"));
      yield bytes("C");
    }
    await mounted.writeStream("/memory/new", source());
    expect(await text(memory, "/new")).toBe("abC");
  });

  it("does not forward a false method-only or true method-missing claim", async () => {
    const memory = new MemoryFileSystem();
    const denied = new MountFileSystem({ root: view(memory, {
      capabilities: { ...memory.capabilities, descriptorWriteStream: false },
    }) });
    expect((await denied.capabilitiesFor("/new")).descriptorWriteStream).toBe(false);
    const missing = new MountFileSystem({ root: view(memory, {
      capabilities: { ...memory.capabilities, descriptorWriteStream: true }, writeStream: undefined,
    }) });
    expect(missing.capabilities.descriptorWriteStream).toBe(false);
    expect((await missing.capabilitiesFor("/new")).descriptorWriteStream).toBe(false);
  });

  it("does not globally endorse a descriptor claim with explicitly disabled streaming writes", async () => {
    const memory = new MemoryFileSystem();
    const mounted = new MountFileSystem({ root: view(memory, {
      capabilities: { ...memory.capabilities, descriptorWriteStream: true, streamingWrite: false },
    }) });
    expect(mounted.capabilities.descriptorWriteStream).toBe(false);
    expect((await mounted.capabilitiesFor("/new")).descriptorWriteStream).toBe(false);
  });

  it("rejects readonly contradictory declarations globally and for selected paths", async () => {
    const memory = new MemoryFileSystem();
    const mounted = new MountFileSystem({ root: view(memory, {
      capabilities: { ...memory.capabilities, descriptorWriteStream: true, readOnly: true },
    }) });
    expect(mounted.capabilities.descriptorWriteStream).toBe(false);
    expect((await mounted.capabilitiesFor("/new")).descriptorWriteStream).toBe(false);
  });

  it("refreshes selected-path support after stock policy changes despite the global snapshot", async () => {
    const memory = new MemoryFileSystem();
    const mounted = new MountFileSystem({ root: memory });
    expect(mounted.capabilities.descriptorWriteStream).toBe(true);
    expect((await mounted.capabilitiesFor("/new")).descriptorWriteStream).toBe(true);
    Object.defineProperty(memory, "writeFile", { value: vi.fn() });
    expect(mounted.capabilities.descriptorWriteStream).toBe(true);
    expect(memory.capabilities.descriptorWriteStream).toBe(false);
    expect((await mounted.capabilitiesFor("/new")).descriptorWriteStream).toBe(false);
  });
});
