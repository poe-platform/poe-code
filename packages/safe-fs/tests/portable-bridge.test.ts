import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { createFsBridge, MemoryFileSystem, FsError } from "../src/core.js";
import type { FsBridgeCodec, FsBridgeOptions } from "../src/core.js";
import { createNodeFsBridge } from "../src/node/filesystem.js";
import { FsError as NodeFsError, MemoryFileSystem as NodeMemory } from "../src/index.js";
import { exerciseBridge } from "./helpers/bridge-scenarios.js";

const nativeCodec: FsBridgeCodec = {
  isEncoding: Buffer.isEncoding,
  encode(text, encoding) {
    if (!Buffer.isEncoding(encoding)) throw new TypeError("Invalid encoding");
    return Buffer.from(text, encoding);
  },
  decode(bytes, encoding) {
    if (!Buffer.isEncoding(encoding)) throw new TypeError("Invalid encoding");
    return Buffer.from(bytes).toString(encoding);
  }
};

const spellings = ["ascii", "utf8", "utf-8", "utf16le", "utf-16le", "ucs2", "ucs-2", "base64", "base64url", "latin1", "binary", "hex"];

describe("shared bridge and native oracle", () => {
  it("uses canonical constructors across Node and core entries", () => {
    expect(NodeFsError).toBe(FsError);
    expect(NodeMemory).toBe(MemoryFileSystem);
  });

  it.each(spellings.flatMap(name => [name, name.toUpperCase()]))("retains native encoding %s", async encoding => {
    if (!Buffer.isEncoding(encoding)) throw new Error("Missing native encoding");
    const text = encoding.toLowerCase() === "hex" ? "00ff80f" : encoding.toLowerCase().startsWith("base64") ? "AAH-_w==" : "\ufeffAéĀ\ud800";
    const expected = Buffer.from(text, encoding);
    for (const node of [false, true]) {
      const adapter = new MemoryFileSystem();
      const bridge = node ? createNodeFsBridge(adapter) : createFsBridge(adapter, { codec: nativeCodec });
      await bridge.writeFile("/file", text, encoding);
      expect(await adapter.readFile("/file")).toEqual(new Uint8Array(expected));
      expect(await bridge.readFile("/file", encoding)).toBe(expected.toString(encoding));
    }
  });

  it.each([false, true])("exercises all 21 operations without another backend (node=%s)", async node => {
    const adapter = new MemoryFileSystem();
    await adapter.mkdir("/cwd");
    const bridge = node ? createNodeFsBridge(adapter, { cwd: "/cwd" }) : createFsBridge(adapter, { codec: nativeCodec, cwd: "/cwd" });
    expect(new Set(await exerciseBridge(bridge)).size).toBe(21);
    expect(Buffer.from(await adapter.readFile("/cwd/work/file")).toString()).toBe("one");
    const stat = await bridge.stat("work/file");
    expect(stat.atime).toBeInstanceOf(Date);
    expect(stat.blocks).toBe(1);
    expect(stat.isSocket()).toBe(false);
  });

  it.each([false, true])("owns binary results and raw view writes (node=%s)", async node => {
    const adapter = new MemoryFileSystem();
    const retained = new Uint8Array([1, 128, 255]);
    adapter.readFile = async () => retained;
    const bridge = node ? createNodeFsBridge(adapter) : createFsBridge(adapter, { codec: nativeCodec });
    const bytes = await bridge.readFile("/file");
    expect(Buffer.isBuffer(bytes)).toBe(node);
    expect(bytes).not.toBe(retained);
    retained.fill(4);
    expect(Array.from(bytes)).toEqual([1, 128, 255]);
    bytes.fill(5);
    expect(Array.from(retained)).toEqual([4, 4, 4]);
    let captured: Uint8Array | undefined;
    adapter.writeFile = async (_path, input) => { captured = input; };
    const source = new Uint8Array([9, 1, 128, 255, 8]);
    const pending = bridge.writeFile("/view", new DataView(source.buffer, 1, 3));
    source.fill(0);
    await pending;
    expect(Array.from(captured!)).toEqual([1, 128, 255]);
    const words = new Uint16Array([0x1234, 0xabcd]);
    await bridge.writeFile("/words", words);
    expect(Array.from(captured!)).toEqual(Array.from(new Uint8Array(words.buffer)));
  });

  it("preserves native Buffer/URL paths without widening portable paths", async () => {
    const adapter = new MemoryFileSystem();
    const node = createNodeFsBridge(adapter);
    await node.writeFile(Buffer.from("/buffer"), "buffer");
    await node.writeFile(new URL("file:///url"), "url");
    const portable = createFsBridge(adapter, { codec: nativeCodec });
    await expect(portable.readFile(Buffer.from("/buffer"))).rejects.toBeInstanceOf(TypeError);
    await expect(portable.readFile(new URL("file:///url"))).rejects.toBeInstanceOf(TypeError);
    expect(await node.readFile("/url", "utf8")).toBe("url");
  });

  it("requires a codec, with no ambient default", () => {
    const adapter = new MemoryFileSystem();
    for (const options of [undefined, {}, { codec: {} }]) {
      expect(() => createFsBridge(adapter, options as FsBridgeOptions)).toThrow(TypeError);
    }
  });

  it("owns encoded bytes before asynchronous adapter effects", async () => {
    const retained = new Uint8Array([1, 2, 3]);
    const adapter = new MemoryFileSystem();
    const bridge = createFsBridge(adapter, { codec: { ...nativeCodec, encode: () => retained } });
    const pending = bridge.writeFile("/file", "text");
    retained.fill(0);
    await pending;
    expect(Array.from(await adapter.readFile("/file"))).toEqual([1, 2, 3]);
  });

  it.each([false, true])("retains guards, optional backend refusal and pre-abort (node=%s)", async node => {
    const adapter = new MemoryFileSystem();
    const create = (cwd: string) => node ? createNodeFsBridge(adapter, { cwd }) : createFsBridge(adapter, { cwd, codec: nativeCodec });
    expect(() => create("relative")).toThrow("cwd must be an absolute virtual path");
    expect(() => create("/bad\0path")).toThrow("cwd must be an absolute virtual path");
    const bridge = create("/");
    await expect(bridge.stat("/", { bigint: true })).rejects.toMatchObject({ code: "ENOTSUP" });
    await expect(bridge.readFile("/", "buffer" as BufferEncoding)).rejects.toThrow("Invalid read encoding");
    await expect(bridge.cp("/", "/copy", { dereference: true })).rejects.toMatchObject({ code: "ENOTSUP" });
    const controller = new AbortController();
    controller.abort("original");
    const calls = vi.spyOn(adapter, "readFile");
    await expect(bridge.readFile("/file", { signal: controller.signal })).rejects.toMatchObject({ code: "ABORT_ERR" });
    expect(calls).not.toHaveBeenCalled();
    const missing = new Proxy(adapter, {
      get(target, key) {
        if (key === "link" || key === "readlink" || key === "chmod" || key === "utimes" || key === "truncate") return undefined;
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const limited = node ? createNodeFsBridge(missing) : createFsBridge(missing, { codec: nativeCodec });
    for (const pending of [limited.link("/a", "/b"), limited.readlink("/a"), limited.chmod("/a", 0o600), limited.utimes("/a", 1, 2), limited.truncate("/a")]) {
      await expect(pending).rejects.toMatchObject({ code: "ENOTSUP" });
    }
  });

  it("refuses unsupported codecs before adapter calls, including name conversion", async () => {
    const adapter = new MemoryFileSystem();
    const calls = [vi.spyOn(adapter, "readFile"), vi.spyOn(adapter, "writeFile"), vi.spyOn(adapter, "readdir"), vi.spyOn(adapter, "mkdir"), vi.spyOn(adapter, "realpath")];
    const codec: FsBridgeCodec = { ...nativeCodec, isEncoding: name => name === "hex" };
    const bridge = createFsBridge(adapter, { codec });
    for (const operation of [
      () => bridge.readFile("/file", "utf8"),
      () => bridge.writeFile("/file", "data"),
      () => bridge.readdir("/", "hex"),
      () => bridge.realpath("/", "hex"),
      () => bridge.mkdtemp("prefix", "hex")
    ]) await expect(operation()).rejects.toThrow("Invalid encoding");
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });

  it("preserves codec receivers and backend FsError identity", async () => {
    const codec: FsBridgeCodec = {
      isEncoding(name) { expect(this).toBe(codec); return Buffer.isEncoding(name); },
      encode(text, encoding) { expect(this).toBe(codec); return nativeCodec.encode(text, encoding); },
      decode(bytes, encoding) { expect(this).toBe(codec); return nativeCodec.decode(bytes, encoding); }
    };
    const adapter = new MemoryFileSystem();
    const bridge = createFsBridge(adapter, { codec });
    await bridge.writeFile("/file", "data");
    expect(await bridge.readFile("/file", "utf8")).toBe("data");
    const failure = new FsError("EIO");
    adapter.readFile = async () => { throw failure; };
    await expect(bridge.readFile("/file", "utf8")).rejects.toBe(failure);
  });

  it.each([false, true])("confines cwd resolution and link creation (node=%s)", async node => {
    const adapter = new MemoryFileSystem();
    await adapter.mkdir("/cwd");
    const bridge = node ? createNodeFsBridge(adapter, { cwd: "/cwd" }) : createFsBridge(adapter, { codec: nativeCodec, cwd: "/cwd" });
    await expect(bridge.writeFile("../outside", "denied")).rejects.toMatchObject({ code: "EACCES" });
    await expect(adapter.readFile("/outside")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(bridge.symlink("../outside", "escape")).rejects.toMatchObject({ code: "EACCES" });
    await bridge.writeFile("file", "inside");
    await bridge.symlink("file", "link");
    expect(await bridge.readlink("link")).toBe("file");
    await expect(bridge.cp("/cwd", "/cwd/nested", { recursive: true })).rejects.toMatchObject({ code: "EINVAL" });
    await expect(bridge.readFile("bad\0path", "utf8")).rejects.toBeInstanceOf(TypeError);
    await expect(bridge.readFile("", "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([false, true])("cleans borrowed cancellation and retains ABORT_ERR mapping (node=%s)", async node => {
    const adapter = new MemoryFileSystem();
    let fail!: (error: unknown) => void;
    adapter.readFile = () => new Promise((_resolve, reject) => { fail = reject; });
    const host = new AbortController();
    const call = new AbortController();
    const added = vi.spyOn(host.signal, "addEventListener");
    const removed = vi.spyOn(host.signal, "removeEventListener");
    const bridge = node ? createNodeFsBridge(adapter, { signal: host.signal }) : createFsBridge(adapter, { codec: nativeCodec, signal: host.signal });
    const pending = bridge.readFile("/file", { encoding: "utf8", signal: call.signal });
    await Promise.resolve();
    await Promise.resolve();
    const reason = { borrowed: true };
    host.abort(reason);
    await expect(pending).rejects.toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
    expect(host.signal.reason).toBe(reason);
    expect(call.signal.aborted).toBe(false);
    expect(removed.mock.calls.length).toBe(added.mock.calls.length);
    fail(new Error("late backend rejection"));
    await Promise.resolve();
    added.mockRestore();
    removed.mockRestore();
  });
});
