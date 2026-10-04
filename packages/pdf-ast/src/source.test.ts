import { describe, expect, it, vi } from "vitest";
import type { FileReadHandle, FileSystem } from "@poe-code/safe-fs/contracts";
import { PdfFileSource } from "./source.js";

// This backend generates ranges. It never stores a file-sized payload or spool.
function generatedFile(size = 2 ** 30, shortRead = Infinity) {
  const scratch = new Uint8Array(32);
  const read = vi.fn(async (offset: number, length: number) => {
    const count = Math.min(length, shortRead, size - offset, scratch.length);
    for (let i = 0; i < count; i++) scratch[i] = (offset + i) % 251;
    return scratch.subarray(0, count);
  });
  const close = vi.fn(async () => {});
  const handle = {
    stat: vi.fn(async () => ({ type: "file", size })), read, close,
  } as unknown as FileReadHandle;
  const fs = {
    capabilities: { retainedRead: true },
    openReadFile: vi.fn(async () => handle),
    readFile: vi.fn(() => { throw new Error("whole-file read forbidden"); }),
  } as unknown as FileSystem;
  return { fs, handle, read, close };
}

const options = { chunkBytes: 16, cacheBytes: 32 };

describe("retained PDF ranges", () => {
  it("reuses the source cancellation signal across repeated range reads", async () => {
    const backend = generatedFile(), controller = new AbortController();
    const source = await PdfFileSource.open(backend.fs, "/large.pdf", { ...options, signal: controller.signal });
    try {
      for (let at = 0; at < 128; at += 16) await source.read(at, 16, controller.signal);
      for (const call of vi.mocked(backend.handle.read).mock.calls) {
        expect(call[2]?.signal).toBe(controller.signal);
      }
      const failure = new Error("cancel shared signal"); controller.abort(failure);
      await expect(source.read(0, 1, controller.signal)).rejects.toBe(failure);
    } finally { await source.close(); }
  });

  it.each(["source", "caller"])("keeps distinct %s cancellation active during a read", async origin => {
    const backend = generatedFile(), lifetime = new AbortController(), caller = new AbortController();
    const failure = new Error(`cancel ${origin}`);
    backend.read.mockImplementationOnce(async () => {
      (origin === "source" ? lifetime : caller).abort(failure);
      return new Uint8Array(16);
    });
    const source = await PdfFileSource.open(backend.fs, "/large.pdf", { ...options, signal: lifetime.signal });
    try {
      await expect(source.read(0, 16, caller.signal)).rejects.toBe(failure);
    } finally { await source.close(); }
  });

  it("reads a large generated file with bounded requests and an evicting cache", async () => {
    const backend = generatedFile();
    const source = await PdfFileSource.open(backend.fs, "/large.pdf", options);
    expect(source.size).toBe(2 ** 30);
    expect(backend.read).not.toHaveBeenCalled();
    expect(await source.read(0, 4)).toEqual(new Uint8Array([0, 1, 2, 3]));
    await source.read(16, 4);
    await source.read(0, 4); // recently used, so the next fill evicts page 16
    await source.read(32, 4);
    await source.read(0, 4);
    expect(backend.read).toHaveBeenCalledTimes(3);
    await source.read(16, 4);
    expect(backend.read).toHaveBeenCalledTimes(4);
    expect(backend.read.mock.calls.every(([, bytes]) => bytes <= 16)).toBe(true);
    expect(backend.fs.readFile).not.toHaveBeenCalled();
    await source.close();
    await source.close();
    expect(backend.close).toHaveBeenCalledTimes(1);
  });

  it("owns returned bytes across reused backend chunks, cache eviction and caller mutation", async () => {
    const backend = generatedFile(100, 3);
    const source = await PdfFileSource.open(backend.fs, "/short.pdf", options);
    const first = await source.read(14, 8);
    expect(first).toEqual(Uint8Array.from({ length: 8 }, (_, i) => i + 14));
    first.fill(255);
    expect(await source.read(14, 8)).toEqual(Uint8Array.from({ length: 8 }, (_, i) => i + 14));
    await source.read(64, 8);
    expect(await source.read(98, 16)).toEqual(new Uint8Array([98, 99]));
    expect(await source.read(100, 16)).toHaveLength(0);
    await source.close();
  });

  it("admits input and request budgets before data reads and closes failed acquisitions", async () => {
    const backend = generatedFile();
    await expect(PdfFileSource.open(backend.fs, "/large.pdf", { ...options, maxInputBytes: 100 }))
      .rejects.toMatchObject({ code: "E_LIMIT" });
    expect(backend.read).not.toHaveBeenCalled();
    expect(backend.close).toHaveBeenCalledTimes(1);
    const source = await PdfFileSource.open(backend.fs, "/large.pdf", options);
    await expect(source.read(0, 17)).rejects.toMatchObject({ code: "E_LIMIT" });
    await expect(source.read(-1, 1)).rejects.toThrow(RangeError);
    await expect(source.read(0, NaN)).rejects.toThrow(RangeError);
    expect(backend.read).not.toHaveBeenCalled();
    await source.close();
  });

  it("streams under slow consumer backpressure without reading ahead", async () => {
    const backend = generatedFile(2 ** 30);
    const source = await PdfFileSource.open(backend.fs, "/large.pdf", options);
    const stream = source.stream(0, 48)[Symbol.asyncIterator]();
    expect(backend.read).not.toHaveBeenCalled();
    const first = (await stream.next()).value!;
    await Promise.resolve();
    expect(backend.read).toHaveBeenCalledTimes(1);
    const second = (await stream.next()).value!;
    expect(first).toEqual(Uint8Array.from({ length: 16 }, (_, i) => i));
    expect(second).toEqual(Uint8Array.from({ length: 16 }, (_, i) => i + 16));
    await stream.return?.();
    expect(backend.read).toHaveBeenCalledTimes(2);
    await source.close();
  });

  it("rejects cancellation after backend reads without caching their bytes", async () => {
    const backend = generatedFile();
    const controller = new AbortController();
    const failure = new Error("cancelled range");
    backend.read.mockImplementationOnce(async () => {
      controller.abort(failure);
      return new Uint8Array(16);
    });
    const source = await PdfFileSource.open(backend.fs, "/file.pdf", options);
    await expect(source.read(0, 8, controller.signal)).rejects.toBe(failure);
    expect(await source.read(0, 2)).toEqual(new Uint8Array([0, 1]));
    expect(backend.read).toHaveBeenCalledTimes(2);
    await source.close();
    await expect(source.read(0, 1)).rejects.toMatchObject({ code: "E_CAPABILITY" });
  });

  it("does not publish a partially read cache page after I/O errors or unexpected EOF", async () => {
    const backend = generatedFile();
    const failure = new Error("range failed");
    backend.read.mockRejectedValueOnce(failure);
    const source = await PdfFileSource.open(backend.fs, "/file.pdf", options);
    await expect(source.read(0, 8)).rejects.toBe(failure);
    backend.read.mockResolvedValueOnce(new Uint8Array(0));
    await expect(source.read(0, 8)).rejects.toMatchObject({ code: "E_PARSE" });
    expect(await source.read(0, 2)).toEqual(new Uint8Array([0, 1]));
    await source.close();
  });

  it("checks cancellation and lifetime even for empty streams", async () => {
    const backend = generatedFile(0);
    const source = await PdfFileSource.open(backend.fs, "/empty.pdf", options);
    const controller = new AbortController();
    const failure = new Error("cancelled empty stream");
    controller.abort(failure);
    await expect(source.stream(0, 0, controller.signal).next()).rejects.toBe(failure);
    await source.close();
    await expect(source.stream().next()).rejects.toMatchObject({ code: "E_CAPABILITY" });
  });

  it("keeps the acquired identity when the pathname is replaced", async () => {
    const backend = generatedFile(64);
    const source = await PdfFileSource.open(backend.fs, "/file.pdf", options);
    vi.mocked(backend.fs.openReadFile!).mockRejectedValue(new Error("replacement must not be opened"));
    expect(await source.read(40, 4)).toEqual(new Uint8Array([40, 41, 42, 43]));
    expect(backend.fs.openReadFile).toHaveBeenCalledTimes(1);
    await source.close();
  });

  it("checks target capabilities and never falls back to whole-file reads", async () => {
    const backend = generatedFile();
    const fs = { ...backend.fs, capabilitiesFor: vi.fn(async () => ({ retainedRead: false })) };
    await expect(PdfFileSource.open(fs, "/unsupported.pdf", options))
      .rejects.toMatchObject({ code: "E_CAPABILITY" });
    expect(backend.fs.openReadFile).not.toHaveBeenCalled();
    expect(backend.fs.readFile).not.toHaveBeenCalled();
  });

  it("closes an acquired handle when cancellation occurs during open", async () => {
    const backend = generatedFile();
    const controller = new AbortController();
    const failure = new Error("cancelled acquisition");
    vi.mocked(backend.fs.openReadFile!).mockImplementationOnce(async () => {
      controller.abort(failure);
      return backend.handle;
    });
    await expect(PdfFileSource.open(backend.fs, "/file.pdf", { ...options, signal: controller.signal }))
      .rejects.toBe(failure);
    expect(backend.handle.stat).not.toHaveBeenCalled();
    expect(backend.close).toHaveBeenCalledTimes(1);
  });

  it("preserves admission errors over cleanup errors and reports explicit close errors", async () => {
    const backend = generatedFile();
    const failure = new Error("close failed");
    backend.close.mockRejectedValue(failure);
    await expect(PdfFileSource.open(backend.fs, "/file.pdf", { ...options, maxInputBytes: 1 }))
      .rejects.toMatchObject({ code: "E_LIMIT" });
    const source = await PdfFileSource.open(backend.fs, "/file.pdf", options);
    await expect(source.close()).rejects.toBe(failure);
    await expect(source.close()).rejects.toBe(failure);
    expect(backend.close).toHaveBeenCalledTimes(2);
  });

  it("rejects an oversized backend response without caching it", async () => {
    const backend = generatedFile();
    backend.read.mockResolvedValueOnce(new Uint8Array(17));
    const source = await PdfFileSource.open(backend.fs, "/file.pdf", options);
    await expect(source.read(0, 8)).rejects.toMatchObject({ code: "E_CAPABILITY" });
    expect(await source.read(0, 2)).toEqual(new Uint8Array([0, 1]));
    await source.close();
  });

  it("serializes overlapping cache fills and waits for an active read before closing", async () => {
    const backend = generatedFile();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    backend.read.mockImplementationOnce(async () => { await gate; return new Uint8Array(16); });
    const source = await PdfFileSource.open(backend.fs, "/file.pdf", options);
    const first = source.read(0, 8);
    const second = source.read(0, 8);
    await Promise.resolve();
    const closing = source.close();
    expect(backend.close).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second, closing]);
    expect(backend.read).toHaveBeenCalledTimes(1);
    expect(backend.close).toHaveBeenCalledTimes(1);
  });
});

it("queries creation capabilities for the prospective staging entry rather than its existing parent",async()=>{
 const {createMemoryFileSystem}=await import("@poe-code/safe-fs");
 const {FsError}=await import("@poe-code/safe-fs/contracts");
 const memory=createMemoryFileSystem();await memory.mkdir("/scratch");
 const queries:string[]=[];
 const fs=new Proxy(memory,{get(target,key){if(key==="capabilitiesFor")return async(path:string,options?:{create?:boolean})=>{if(options?.create){queries.push(path);if(path==="/scratch")throw new FsError("EISDIR",{path});}return memory.capabilities;};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const source=await PdfFileSource.fromStream(fs,"/scratch",[Uint8Array.of(1,2,3)]);
 try{expect(await source.read(0,3)).toEqual(Uint8Array.of(1,2,3));expect(queries[0]?.startsWith("/scratch/.pdf-")).toBe(true);}finally{await source.close();}
 expect(await memory.readdir("/scratch")).toEqual([]);
});

it("releases queued range caches while retaining the same read handle and owned results", async () => {
  const backend = generatedFile();
  const source = await PdfFileSource.open(backend.fs, "/large.pdf", options);
  const first = source.read(0, 8);
  const released = source.releaseCache();
  const second = source.read(0, 8);
  await released;
  expect(await first).toEqual(await second);
  expect(backend.read).toHaveBeenCalledTimes(2);
  expect(backend.fs.openReadFile).toHaveBeenCalledTimes(1);
  expect(backend.close).not.toHaveBeenCalled();
  await source.close();
  await expect(source.releaseCache()).rejects.toMatchObject({ code: "E_CAPABILITY" });
});
