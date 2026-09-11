import { describe, expect, it, vi } from "vitest";
import { FsError } from "../src/contracts/errors.js";
import type { FileStat, FileSystem } from "../src/contracts/filesystem.js";
import { toByteSource } from "../src/contracts/io.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { createReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { compareEntries } from "../src/fs/mount/comparison.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { bridgeDirent, bridgeStats } from "../src/bridge/stats.js";
import { createDeviceFileSystem, DeviceFileSystem } from "../src/fs/devices/index.js";

const bytes = (value: string) => new TextEncoder().encode(value);

async function fixture(historical = false) {
  const backing = new MemoryFileSystem();
  await backing.writeFile("/ordinary", bytes("ordinary"));
  if (historical) {
    await backing.mkdir("/dev");
    await backing.writeFile("/dev/null", bytes("historical diagnostics"));
    await backing.writeFile("/dev/sibling", bytes("sibling"));
  }
  const mutations = ["writeFile", "appendFile", "writeStream", "mkdir", "rm", "rmdir", "rename", "copyFile", "symlink", "link", "chmod", "utimes", "truncate"] as const;
  const spies = mutations.map(name => vi.spyOn(backing, name));
  return { backing, view: createDeviceFileSystem(backing), assertUntouched() { for (const spy of spies) expect(spy).not.toHaveBeenCalled(); } };
}

describe("virtual null device", () => {
  for (const historical of [false, true]) it(`masks ${historical ? "historical" : "absent"} storage without reads, writes or quota allocation`, async () => {
    const { backing, view, assertUntouched } = await fixture(historical);
    expect(view).toBeInstanceOf(DeviceFileSystem);
    expect(createDeviceFileSystem(view)).toBe(view);
    expect(createDeviceFileSystem(backing)).toBe(view);
    for (const path of ["/dev/null", "dev/./null", "//dev//null", "/dev/../dev/null"]) {
      expect(await view.readFile(path)).toEqual(new Uint8Array());
      expect(await view.realpath(path)).toBe("/dev/null");
      await view.writeFile(path, bytes("discard"));
      await view.appendFile(path, bytes("discard"));
      await view.writeFile(path, bytes("discard"), { flag: "a" });
      await view.writeStream!(path, toByteSource("discard"), { flag: "a" });
      for (const flag of ["wx", "ax"] as const) await expect(view.writeFile(path, bytes("x"), { flag })).rejects.toMatchObject({ code: "EEXIST" });
      expect(await view.stat(path)).toMatchObject({ type: "character", mode: 0o020666, size: 0, allocatedBytes: 0 });
    }
    assertUntouched();
    if (historical) expect(await backing.readFile("/dev/null")).toEqual(bytes("historical diagnostics"));
    else await expect(backing.stat("/dev")).rejects.toMatchObject({ code: "ENOENT" });
  });

  for (const path of ["/dev/null/", "/dev/null/child", "/dev/null/.", "/dev/null/..", "/dev/null/../ordinary"]) it(`rejects device traversal ${path}`, async () => {
    const { view, assertUntouched } = await fixture(true);
    for (const operation of [() => view.stat(path), () => view.readFile(path), () => view.writeFile(path, bytes("x")), () => view.rm(path, { recursive: true, force: true })]) {
      await expect(operation()).rejects.toMatchObject({ code: "ENOTDIR" });
    }
    assertUntouched();
  });

  it("resolves absolute, relative and parent symlink aliases without exposing historical bytes", async () => {
    const backing = new MemoryFileSystem();
    await backing.symlink("/dev", "/devices");
    await backing.symlink("dev/null", "/alias");
    await backing.symlink("/alias", "/chain");
    const write = vi.spyOn(backing, "writeFile");
    const view = createDeviceFileSystem(backing);
    for (const path of ["/devices/null", "/alias", "/chain"]) {
      await view.writeFile(path, bytes("discard"));
      expect(await view.stat(path)).toMatchObject({ type: "character" });
      expect(await view.readFile(path)).toEqual(new Uint8Array());
    }
    expect(await view.lstat("/alias")).toMatchObject({ type: "symlink" });
    expect(await view.readlink!("/alias")).toBe("dev/null");
    await expect(view.stat("/chain/..")).rejects.toMatchObject({ code: "ENOTDIR" });
    await view.rm("/alias");
    await expect(backing.lstat("/alias")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await view.readFile("/dev/null")).toEqual(new Uint8Array());
    expect(write).not.toHaveBeenCalled();
  });

  it("protects device and ancestors from removal, replacement and metadata mutation", async () => {
    const { view, assertUntouched } = await fixture(true);
    for (const path of ["/", "/dev", "/dev/null"]) {
      for (const operation of [
        () => view.rm(path, { force: true, recursive: true }), () => view.rmdir!(path),
        () => view.rename(path, "/other"), () => view.rename("/ordinary", path),
        () => view.symlink!("/ordinary", path), () => view.link!("/ordinary", path),
        () => view.link!(path, "/other"), () => view.chmod!(path, 0),
        () => view.utimes!(path, 1, 2), () => view.truncate!(path, 1),
      ]) await expect(operation()).rejects.toBeInstanceOf(FsError);
    }
    await expect(view.mkdir("/dev/null", { recursive: true })).rejects.toMatchObject({ code: "EEXIST" });
    await view.mkdir("/dev", { recursive: true });
    await expect(view.writeFile("/dev", bytes("x"))).rejects.toMatchObject({ code: "EISDIR" });
    assertUntouched();
  });

  it("classifies null rmdir as ENOTDIR while retaining reserved ancestor protection", async () => {
    const { backing, view, assertUntouched } = await fixture(true);
    await backing.symlink("/dev", "/devices");
    vi.mocked(backing.symlink).mockClear();
    for (const path of ["/dev/null", "dev/null", "/devices/null", "/dev/null/", "/dev/null/.."]) {
      await expect(view.rmdir(path)).rejects.toMatchObject({ code: "ENOTDIR" });
    }
    for (const path of ["/", "/dev"]) await expect(view.rmdir(path)).rejects.toMatchObject({ code: "EBUSY" });
    await expect(view.rm("/dev/null")).rejects.toMatchObject({ code: "EBUSY" });
    await expect(view.rename("/dev/null", "/other")).rejects.toMatchObject({ code: "EBUSY" });
    assertUntouched();
  });

  it("synthesizes dev, merges siblings, masks historical types and enforces listing admission", async () => {
    const { view } = await fixture();
    expect(await view.readdir("/")).toEqual([{ name: "ordinary", type: "file" }, { name: "dev", type: "directory" }]);
    expect(await view.readdir("/dev", { maxEntries: 1 })).toEqual([{ name: "null", type: "character" }]);
    await expect(view.readdir("/dev", { maxEntries: 0 })).rejects.toMatchObject({ code: "EFBIG" });
    await expect(view.readdir("/", { maxEntries: 1 })).rejects.toMatchObject({ code: "EFBIG" });
    await expect(view.readdir("/dev", { maxEntries: -1 })).rejects.toMatchObject({ code: "EINVAL" });
    const historical = await fixture(true);
    expect(await historical.view.readdir("/dev", { maxEntries: 2 })).toEqual([{ name: "null", type: "character" }, { name: "sibling", type: "file" }]);
    vi.spyOn(historical.backing, "readdir").mockResolvedValue([{ name: "null", type: "file" }, { name: "null", type: "file" }]);
    expect(await historical.view.readdir("/dev", { maxEntries: 1 })).toEqual([{ name: "null", type: "character" }]);
  });

  for (const path of ["/", "/dev"]) it(`ignores provider dot entries while retaining merged order and admission at ${path}`, async () => {
    const { backing, view } = await fixture(true);
    const readdir = vi.spyOn(backing, "readdir").mockResolvedValue([
      { name: ".", type: "directory" }, { name: "..", type: "directory" },
      { name: "z", type: "file" }, { name: "a", type: "file" },
    ]);
    const signal = new AbortController().signal;
    expect(await view.readdir(path, { signal, maxEntries: 3 })).toEqual([
      { name: "z", type: "file" }, { name: "a", type: "file" },
      { name: path === "/" ? "dev" : "null", type: path === "/" ? "directory" : "character" },
    ]);
    expect(readdir).toHaveBeenLastCalledWith(path, { signal, maxEntries: 3 });
    await expect(view.readdir(path, { maxEntries: 2 })).rejects.toMatchObject({ code: "EFBIG" });
    readdir.mockResolvedValue([{ name: ".", type: "directory" }, { name: "..", type: "directory" }]);
    expect(await view.readdir(path, { maxEntries: 1 })).toEqual([
      { name: path === "/" ? "dev" : "null", type: path === "/" ? "directory" : "character" },
    ]);
    await expect(view.readdir(path, { maxEntries: 0 })).rejects.toMatchObject({ code: "EFBIG" });
  });

  for (const path of ["/", "/dev"]) for (const name of ["", "nested/entry", "nul\0entry"]) it(`rejects malformed provider entry ${JSON.stringify(name)} at ${path}`, async () => {
    const { backing, view } = await fixture(true);
    vi.spyOn(backing, "readdir").mockResolvedValue([
      { name: ".", type: "directory" }, { name: "..", type: "directory" }, { name, type: "file" },
    ]);
    await expect(view.readdir(path)).rejects.toMatchObject({ code: "EIO" });
  });

  it("retains device read handles and reports character metadata through bridge APIs", async () => {
    const { view } = await fixture();
    const handle = await view.openReadFile!("/dev/null");
    const stat = await handle.stat();
    expect(await handle.read(0, 10)).toEqual(new Uint8Array());
    expect(await handle.read(100, 10)).toEqual(new Uint8Array());
    await expect(handle.read(-1, 1)).rejects.toMatchObject({ code: "EINVAL" });
    expect(bridgeStats(stat).isCharacterDevice()).toBe(true);
    expect(bridgeStats(stat).isFile()).toBe(false);
    expect(bridgeStats(stat).mode).toBe(0o020666);
    expect(bridgeDirent("null", "/dev", stat.type).isCharacterDevice()).toBe(true);
    await handle.close(); await handle.close();
    await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
  });

  it("keeps backing capabilities and identity while giving null its own writable identity", async () => {
    const { backing, view } = await fixture(true);
    expect(await compareEntries(view, "/ordinary", backing, "/ordinary")).toBe("same");
    expect(await compareEntries(view, "/dev/null", backing, "/dev/null")).toBe("distinct");
    const scoped = scopeFileSystem(view, () => {}, new AbortController().signal);
    expect(await compareEntries(view, "/dev/null", scoped, "/dev/null")).toBe("same");
    const readOnly = createReadOnlyFileSystem(backing);
    const wrapped = createDeviceFileSystem(readOnly);
    expect(await wrapped.capabilitiesFor!("/ordinary")).toEqual(await readOnly.capabilitiesFor("/ordinary"));
    expect(await wrapped.capabilitiesFor!("/dev/null")).toMatchObject({ readOnly: false, streamingWrite: true, retainedRead: true });
    await wrapped.writeFile("/dev/null", bytes("discard"));
    await expect(wrapped.writeFile("/ordinary", bytes("no"))).rejects.toMatchObject({ code: "EROFS" });
    await view.writeFile("/ordinary", bytes("changed"));
    expect(await backing.readFile("/ordinary")).toEqual(bytes("changed"));
  });

  it("copies both null operands through streams without collecting or publishing to null", async () => {
    const { backing, view } = await fixture(true);
    const copy = vi.spyOn(backing, "copyFile");
    const read = vi.spyOn(backing, "readFile").mockRejectedValue(new Error("whole-input read forbidden"));
    await view.copyFile("/ordinary", "/dev/null");
    await view.copyFile("/dev/null", "/empty");
    await view.copyFile("/dev/null", "/dev/null");
    await expect(view.copyFile("/ordinary", "/dev/null", { exclusive: true })).rejects.toMatchObject({ code: "EEXIST" });
    expect(copy).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    expect(await backing.readFile("/empty")).toEqual(new Uint8Array());
    expect(await backing.readFile("/dev/null")).toEqual(bytes("historical diagnostics"));
    const limited = new Proxy(backing, { get(target, key) { if (key === "readStream" || key === "openReadFile") return undefined; const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } }) as FileSystem;
    await expect(createDeviceFileSystem(limited).copyFile("/ordinary", "/dev/null")).rejects.toMatchObject({ code: "ENOTSUP" });
  });

  it("does not impose metadata or streaming obligations on opaque ordinary delegates", async () => {
    const readFile = vi.fn(async () => bytes("opaque"));
    const writeFile = vi.fn(async () => {});
    const copyFile = vi.fn(async () => {});
    const lstat = vi.fn(async () => { throw new FsError("ENOTSUP"); });
    const capabilities = Object.freeze({ read: true, write: true });
    const backing = { capabilities, readFile, writeFile, copyFile, lstat,
      readlink: vi.fn(async () => { throw new FsError("ENOTSUP"); }),
    } as unknown as FileSystem;
    const view = createDeviceFileSystem(backing);
    const options = { signal: new AbortController().signal };
    expect(await view.readFile("relative/../ordinary", options)).toEqual(bytes("opaque"));
    await view.writeFile("relative/../ordinary", bytes("value"), options);
    await view.copyFile("relative/source", "relative/destination", options);
    expect(readFile).toHaveBeenCalledWith("relative/../ordinary", options);
    expect(writeFile).toHaveBeenCalledWith("relative/../ordinary", bytes("value"), options);
    expect(copyFile).toHaveBeenCalledWith("relative/source", "relative/destination", options);
    expect(lstat.mock.calls).toEqual([
      ["relative", options], ["relative", options], ["relative", options], ["relative", options],
    ]);
    expect(await view.capabilitiesFor!("relative/ordinary")).toEqual({ ...capabilities,
      streamingRead: false, streamingWrite: false, streamingAppend: false, descriptorWriteStream: false, retainedRead: false });
    await expect(view.copyFile("relative/source", "/dev/null")).rejects.toMatchObject({ code: "ENOTSUP" });
  });

  it("preserves relative lookup policy when resolving advertised aliases", async () => {
    const backing = new MemoryFileSystem();
    await backing.symlink("/dev/null", "/alias");
    const readlink = vi.fn(async (path: string) => {
      if (path.startsWith("/")) throw new FsError("EINVAL");
      return backing.readlink(path);
    });
    const lstat = vi.fn(async (path: string) => {
      if (path.startsWith("/")) throw new FsError("EINVAL");
      return backing.lstat(path);
    });
    const view = createDeviceFileSystem({ capabilities: { symlinks: true }, lstat, readlink } as unknown as FileSystem);
    expect(await view.readFile("alias")).toEqual(new Uint8Array());
    expect(readlink).toHaveBeenCalledWith("alias", {});
  });

  it("does not pass synthetic directory copy sources to backing storage", async () => {
    const { backing, view } = await fixture();
    const read = vi.spyOn(backing, "readStream");
    await expect(view.copyFile("/dev", "/dev/null")).rejects.toMatchObject({ code: "EISDIR" });
    expect(read).not.toHaveBeenCalled();
  });

  for (const [path, code] of [["/ordinary/../dev/null", "ENOTDIR"], ["/missing/../dev/null", "ENOENT"]]) {
    it(`preserves native traversal failure before reaching ${path}`, async () => {
      const { backing, view } = await fixture();
      for (const operation of [() => view.readFile(path!), () => view.stat(path!), () => view.writeFile(path!, bytes("x"))]) {
        await expect(operation()).rejects.toMatchObject({ code });
      }
      await backing.symlink(path!, "/alias");
      await expect(view.readFile("/alias")).rejects.toMatchObject({ code });
    });
  }

  it("mutates ordinary symlink entries without mutating their reserved referents", async () => {
    const { backing, view } = await fixture(true);
    await backing.symlink("/dev/null", "/alias");
    await backing.symlink("/dev", "/directory-alias");
    await expect(view.rmdir!("/alias")).rejects.toMatchObject({ code: "ENOTDIR" });
    await view.link!("/alias", "/linked");
    expect(await backing.lstat("/linked")).toMatchObject({ type: "symlink" });
    await view.rename("/alias", "/moved");
    expect(await backing.readlink("/moved")).toBe("/dev/null");
    await view.rm("/moved");
    await view.rename("/ordinary", "/linked");
    expect(await backing.readFile("/linked")).toEqual(bytes("ordinary"));
    await view.rm("/directory-alias");
    await backing.symlink("/dev/null", "/write-alias");
    await backing.symlink("/dev", "/parent-alias");
    await view.writeFile("/write-alias", bytes("discard"));
    await backing.writeFile("/source", bytes("copy discard"));
    await view.copyFile("/source", "/write-alias");
    await expect(view.copyFile("/source", "/write-alias", { exclusive: true })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(view.symlink!("/source", "/write-alias")).rejects.toMatchObject({ code: "EEXIST" });
    for (const operation of [() => view.rm("/parent-alias/null"), () => view.rename("/source", "/parent-alias/null"), () => view.link!("/parent-alias/null", "/hardlink")]) {
      await expect(operation()).rejects.toMatchObject({ code: "EBUSY" });
    }
    expect(await backing.readFile("/dev/null")).toEqual(bytes("historical diagnostics"));
    expect(await view.stat("/dev/null")).toMatchObject({ type: "character" });
  });

  it("copies device EOF through mandatory writes on nonstreaming adapters", async () => {
    const writeFile = vi.fn(async () => {});
    const view = createDeviceFileSystem({ capabilities: { write: true, streamingWrite: false }, writeFile } as unknown as FileSystem);
    await view.copyFile("/dev/null", "empty");
    await view.copyFile("/dev/null", "exclusive", { exclusive: true });
    expect(writeFile.mock.calls).toEqual([
      ["empty", new Uint8Array(), { flag: "w" }],
      ["exclusive", new Uint8Array(), { exclusive: true, flag: "wx" }],
    ]);
  });

  it("drains retained reads in bounded chunks without requiring a stream or whole read", async () => {
    const read = vi.fn(async (position: number, maxBytes: number) => new Uint8Array(Math.min(maxBytes, 150000 - position)));
    const close = vi.fn(async () => {});
    const openReadFile = vi.fn(async () => ({ read, close }));
    const view = createDeviceFileSystem({ capabilities: { retainedRead: true, streamingRead: false }, openReadFile } as unknown as FileSystem);
    await view.copyFile("ordinary", "/dev/null");
    expect(read.mock.calls).toEqual([[0, 65536, {}], [65536, 65536, {}], [131072, 65536, {}], [150000, 65536, {}]]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("forwards method assignments to the original receiver without replacing interception", async () => {
    const stat: FileStat = { type: "file", size: 123, mode: 0o644, mtimeMs: 0 };
    const backing = { capabilities: {}, stat: vi.fn(async () => stat) } as unknown as FileSystem;
    const view = createDeviceFileSystem(backing);
    const previous = view.stat;
    const replacement: FileSystem["stat"] = async function (this: FileSystem) { expect(this).toBe(backing); return stat; };
    view.stat = replacement;
    expect(backing.stat).toBe(replacement);
    expect(view.stat).not.toBe(previous);
    expect(view.stat).toBe(view.stat);
    expect(await view.stat("/ordinary")).toBe(stat);
    expect(await view.stat("/dev/null")).toMatchObject({ type: "character" });
  });

  it("preserves frozen host assignment rejection", () => {
    const backing = Object.freeze({ capabilities: {}, stat: async () => ({}) }) as unknown as FileSystem;
    const view = createDeviceFileSystem(backing);
    expect(Reflect.set(view, "stat", async () => ({}))).toBe(false);
    expect(() => { view.stat = async () => { throw new Error("replacement"); }; }).toThrow(TypeError);
  });

  it("reports mixed global capabilities while normalizing absent ordinary stream methods", async () => {
    const capabilities = Object.freeze({ read: true, write: false, append: false, copy: false,
      remove: true, rename: true, permissions: false, readOnly: false, streamingRead: false });
    const view = createDeviceFileSystem({ capabilities } as unknown as FileSystem);
    expect(view.capabilities).toMatchObject({ read: true, readOnly: false, permissions: false });
    for (const key of ["write", "append", "copy", "remove", "rename", "streamingRead"]) expect(view.capabilities[key]).toBeUndefined();
    expect(Object.isFrozen(view.capabilities)).toBe(true);
    expect(await view.capabilitiesFor("ordinary")).toEqual({ ...capabilities,
      streamingWrite: false, streamingAppend: false, descriptorWriteStream: false, retainedRead: false });
    expect(await view.capabilitiesFor("/dev/null")).toMatchObject({ write: true, append: true, streamingRead: true, remove: false });
    expect(await view.capabilitiesFor("/dev")).toMatchObject({ write: false, append: false,
      exclusiveCreate: false, streamingAppend: false, descriptorWriteStream: false });
    await view.writeFile("/dev/null", bytes("discard"));
  });

  for (const declared of [undefined, true, false]) it(`normalizes absent ordinary optional methods declared ${String(declared)} without mutating raw capabilities`, async () => {
    const capabilities = Object.freeze({ readOnly: true, permissions: false, customPolicy: true,
      streamingRead: declared, streamingWrite: declared, streamingAppend: declared,
      descriptorWriteStream: declared, retainedRead: declared });
    const backing = { capabilities: { readOnly: false }, capabilitiesFor: vi.fn(async function (this: FileSystem) {
      expect(this).toBe(backing);
      return capabilities;
    }) } as unknown as FileSystem;
    const view = createDeviceFileSystem(backing);
    const options = { signal: new AbortController().signal };
    const selected = await view.capabilitiesFor("relative/ordinary", options);
    expect(backing.capabilitiesFor).toHaveBeenCalledWith("relative/ordinary", options);
    expect(selected).toEqual({ ...capabilities, streamingRead: false, streamingWrite: false,
      streamingAppend: false, descriptorWriteStream: false, retainedRead: false });
    expect(capabilities.streamingRead).toBe(declared);
    expect(capabilities.streamingWrite).toBe(declared);
    expect(capabilities.streamingAppend).toBe(declared);
    expect(capabilities.descriptorWriteStream).toBe(declared);
    expect(capabilities.retainedRead).toBe(declared);
    if (declared === false) expect(selected).toBe(capabilities);
    else expect(selected).not.toBe(capabilities);
    expect(await view.capabilitiesFor("/dev/null")).toMatchObject({ streamingRead: true,
      streamingWrite: true, streamingAppend: true, descriptorWriteStream: true, retainedRead: true });
  });

  for (const declared of [undefined, true, false]) it(`preserves raw capability identity with present optional methods declared ${String(declared)}`, async () => {
    const capabilities = Object.freeze({ readOnly: true, permissions: false,
      streamingRead: declared, streamingWrite: declared, streamingAppend: declared,
      descriptorWriteStream: declared, retainedRead: declared });
    const readStream = vi.fn();
    const writeStream = vi.fn();
    const openReadFile = vi.fn();
    const view = createDeviceFileSystem({ capabilities, readStream, writeStream, openReadFile } as unknown as FileSystem);
    expect(await view.capabilitiesFor("ordinary")).toBe(capabilities);
    expect(readStream).not.toHaveBeenCalled();
    expect(writeStream).not.toHaveBeenCalled();
    expect(openReadFile).not.toHaveBeenCalled();
  });

  for (const method of ["readStream", "writeStream", "openReadFile"] as const) it(`normalizes only capabilities affected by absent ${method}`, async () => {
    const capabilities = Object.freeze({ streamingRead: true, streamingWrite: true,
      streamingAppend: true, descriptorWriteStream: true, retainedRead: true, permissions: false });
    const backing = { capabilities, readStream: vi.fn(), writeStream: vi.fn(), openReadFile: vi.fn() } as unknown as FileSystem;
    Reflect.deleteProperty(backing, method);
    const selected = await createDeviceFileSystem(backing).capabilitiesFor("ordinary");
    expect(selected).toEqual({ ...capabilities, streamingRead: method !== "readStream",
      streamingWrite: method !== "writeStream", streamingAppend: method !== "writeStream",
      descriptorWriteStream: method !== "writeStream", retainedRead: method !== "openReadFile" });
  });

  it("keeps missing bounded primitives fail-closed without using whole-file fallbacks", async () => {
    const readFile = vi.fn(async () => bytes("must not be collected"));
    const writeFile = vi.fn(async () => {});
    const view = createDeviceFileSystem({ capabilities: {}, readFile, writeFile } as unknown as FileSystem);
    const selected = await view.capabilitiesFor("ordinary");
    expect(selected).toMatchObject({ streamingRead: false, streamingWrite: false, retainedRead: false });
    await expect(view.readStream("ordinary")[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: "ENOTSUP" });
    await expect(view.openReadFile("ordinary")).rejects.toMatchObject({ code: "ENOTSUP" });
    await expect(view.writeStream("ordinary", toByteSource("x"))).rejects.toMatchObject({ code: "ENOTSUP" });
    await expect(view.copyFile("ordinary", "/dev/null")).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(readFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("does not retain stale descriptor stream admission after backing policy changes", async () => {
    const backing = new MemoryFileSystem();
    const view = createDeviceFileSystem(backing);
    expect(view.capabilities.descriptorWriteStream).toBe(true);
    view.writeFile = async () => {};
    expect(backing.capabilities.descriptorWriteStream).toBe(false);
    expect(view.capabilities.descriptorWriteStream).toBeUndefined();
    expect((await view.capabilitiesFor("ordinary")).descriptorWriteStream).toBe(false);
    expect((await view.capabilitiesFor("/dev/null")).descriptorWriteStream).toBe(true);
  });

  for (const flag of ["w", "a"] as const) it(`supports null descriptor ${flag} streams across interleaved writes without backing mutation`, async () => {
    const { backing, view, assertUntouched } = await fixture(true);
    expect((await view.capabilitiesFor("/dev/null")).descriptorWriteStream).toBe(true);
    let returned = 0;
    const source = { [Symbol.asyncIterator]() { let chunks = 0; return {
      async next() {
        if (chunks++ === 2) return { done: true, value: undefined };
        await view.writeFile("/dev/null", bytes("other writer"));
        await view.appendFile("/dev/null", bytes("append"));
        expect(await view.readFile("/dev/null")).toEqual(new Uint8Array());
        return { done: false, value: bytes("stream chunk") };
      },
      async return() { returned++; return { done: true, value: undefined }; },
    }; } };
    await view.writeStream("/dev/null", source, { flag });
    expect(returned).toBe(1);
    expect(await view.stat("/dev/null")).toMatchObject({ size: 0, allocatedBytes: 0 });
    assertUntouched();
    expect(await backing.readFile("/dev/null")).toEqual(bytes("historical diagnostics"));
  });

  it("retains the null stream target when an ordinary symlink is replaced during consumption", async () => {
    const { backing, view } = await fixture(true);
    await backing.symlink("/dev/null", "/alias");
    await view.writeStream("/alias", (async function* () {
      yield bytes("discard before replacement");
      await view.rm("/alias");
      await view.symlink!("/ordinary", "/alias");
      yield bytes("discard after replacement");
    })());
    expect(await backing.readFile("/ordinary")).toEqual(bytes("ordinary"));
    expect(await backing.readFile("/dev/null")).toEqual(bytes("historical diagnostics"));
    expect(await view.readFile("/alias")).toEqual(bytes("ordinary"));
  });
});
