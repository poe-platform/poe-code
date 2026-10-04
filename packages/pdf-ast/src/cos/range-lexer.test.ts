import { describe, expect, it, vi } from "vitest";
import type { FileReadHandle, FileSystem } from "@poe-code/safe-fs/contracts";
import { PdfFileSource } from "../source.js";
import { CosByteLexer, CosRangeLexer, type CosToken } from "./lexer.js";

function backend(size: number, byteAt: (offset: number) => number, chunkBytes = 7) {
  const scratch = new Uint8Array(chunkBytes);
  const read = vi.fn(async (offset: number, length: number) => {
    const count = Math.min(length, size - offset);
    for (let i = 0; i < count; i++) scratch[i] = byteAt(offset + i);
    return scratch.subarray(0, count);
  });
  const close = vi.fn(async () => {});
  const handle = { stat: async () => ({ type: "file", size }), read, close } as unknown as FileReadHandle;
  const fs = { capabilities: { retainedRead: true }, openReadFile: async () => handle,
    readFile: vi.fn(() => { throw new Error("whole-file read forbidden"); }) } as unknown as FileSystem;
  return { fs, read, close, chunkBytes };
}

const samples = [
  "% comment\r\n<< /Type /Ca#74alog /Values [true false null 1 -2.3 1e-7ET] >>",
  "(outer(inner) escaped\\(\\)\\\\ \\123 \\7 \\n line\\\r\nnext) <a bc 123> /caf#C3#A9",
  "--7 -.7 -\r\n7 205--.5 1E+8 -.5e2 12Tf 20Td { } >",
  "(unterminated(inner)\r\n/Next 2 >>",
  "/empty/ /bad#xx /trailing# <0z1> (unterminated",
];

describe("retained range COS lexer", () => {
  it.each(samples)("matches buffered token semantics across tiny ranges: %j", async text => {
    const bytes = new TextEncoder().encode(text);
    const file = backend(bytes.length, offset => bytes[offset]!);
    const source = await PdfFileSource.open(file.fs, "/input.pdf", { chunkBytes: 7, cacheBytes: 14 });
    const range = new CosRangeLexer(source);
    const buffered = new CosByteLexer(bytes);
    const retained: CosToken[] = [];
    while (true) {
      const expected = buffered.nextToken();
      const actual = await range.nextToken();
      expect(actual).toEqual(expected);
      if (!actual) break;
      retained.push(actual);
    }
    range.offset = 0;
    expect(await range.nextToken()).toEqual(retained[0]);
    expect(file.read.mock.calls.every(([, length]) => length <= 7)).toBe(true);
    expect(file.fs.readFile).not.toHaveBeenCalled();
    expect(file.close).not.toHaveBeenCalled();
    await source.close();
  });

  it("seeks into a generated large file without reading its prefix or retaining it", async () => {
    const start = 2 ** 30;
    const tail = new TextEncoder().encode("/Tail (owned) 42");
    const file = backend(start + tail.length, offset => offset < start ? 32 : tail[offset - start]!);
    const source = await PdfFileSource.open(file.fs, "/large.pdf", { chunkBytes: 7, cacheBytes: 14 });
    const lexer = new CosRangeLexer(source, { start });
    const name = await lexer.nextToken();
    const value = await lexer.nextToken();
    expect(await lexer.nextToken()).toMatchObject({ kind: "number", value: 42 });
    expect(name).toMatchObject({ kind: "name", decoded: "Tail", rawBytes: new TextEncoder().encode("Tail") });
    expect(value).toMatchObject({ kind: "string", bytes: new TextEncoder().encode("owned") });
    expect(file.read.mock.calls.every(([offset]) => offset >= start - 6)).toBe(true);
    await source.close();
  });

  it("checks token limits and observes cancellation without owning the source", async () => {
    const bytes = new TextEncoder().encode("(abcdefghijklmnopqrstuvwxyz) /Next");
    const file = backend(bytes.length, offset => bytes[offset]!);
    const source = await PdfFileSource.open(file.fs, "/input.pdf", { chunkBytes: 7, cacheBytes: 14 });
    const lexer = new CosRangeLexer(source, { maxTokenBytes: 4 });
    await expect(lexer.nextToken()).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(file.read).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    const cancelled = new CosRangeLexer(source, { signal: controller.signal });
    const failure = new Error("cancelled");
    controller.abort(failure);
    await expect(cancelled.nextToken()).rejects.toBe(failure);
    expect(file.read).toHaveBeenCalledTimes(1);
    expect(file.close).not.toHaveBeenCalled();
    await source.close();
  });

  it("respects an explicit end offset even during numeric lookahead", async () => {
    const bytes = new TextEncoder().encode("--7");
    const file = backend(bytes.length, offset => bytes[offset]!);
    const source = await PdfFileSource.open(file.fs, "/input.pdf", { chunkBytes: 7, cacheBytes: 14 });
    const lexer = new CosRangeLexer(source, { end: 1 });
    expect(await lexer.nextToken()).toMatchObject({ kind: "number", value: 0, span: { start: 0, end: 1 } });
    expect(await lexer.nextToken()).toBeUndefined();
    await source.close();
  });
  it("charges escaped name bytes instead of bypassing the token budget", async () => {
    const bytes = new TextEncoder().encode("/#61#62#63#64 /Next");
    const file = backend(bytes.length, offset => bytes[offset]!);
    const source = await PdfFileSource.open(file.fs, "/input.pdf", { chunkBytes: 7, cacheBytes: 14 });
    await expect(new CosRangeLexer(source, { maxTokenBytes: 4 }).nextToken()).rejects.toMatchObject({ code: "E_LIMIT" });
    await source.close();
  });

  it("does not prefetch later tokens and rejects concurrent cursor mutation", async () => {
    const bytes = new TextEncoder().encode("12 Tf 20 Td");
    const file = backend(bytes.length, offset => bytes[offset]!);
    const original = file.read.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    file.read.mockImplementationOnce(async (offset, length) => { await gate; return original(offset, length); });
    const source = await PdfFileSource.open(file.fs, "/input.pdf", { chunkBytes: 7, cacheBytes: 14 });
    const lexer = new CosRangeLexer(source);
    const pending = lexer.nextToken();
    await expect(lexer.nextToken()).rejects.toThrow("pending");
    expect(() => { lexer.offset = 0; }).toThrow("pending");
    release();
    expect(await pending).toMatchObject({ kind: "number", value: 12 });
    const reads = file.read.mock.calls.length;
    await Promise.resolve();
    expect(file.read).toHaveBeenCalledTimes(reads);
    await source.close();
  });

  it("skips a generated long comment with only bounded byte allocations", async () => {
    const size = 128 * 1024;
    const file = backend(size + 2, offset => offset === 0 ? 37 : offset < size ? 120 : offset === size ? 10 : 48, 256);
    const source = await PdfFileSource.open(file.fs, "/comment.pdf", { chunkBytes: 256, cacheBytes: 512 });
    const Original = Uint8Array;
    vi.stubGlobal("Uint8Array", new Proxy(Original, {
      construct(target, args) {
        if (typeof args[0] === "number" && args[0] > 256) throw new Error("unbounded allocation");
        return Reflect.construct(target, args);
      },
    }));
    try {
      const lexer = new CosRangeLexer(source, { maxTokenBytes: 1 });
      expect(await lexer.nextToken()).toMatchObject({ kind: "number", value: 0 });
      expect(await lexer.nextToken()).toBeUndefined();
    } finally { vi.unstubAllGlobals(); await source.close(); }
  });

  it("preserves read failures and cancellation during a range refill", async () => {
    const file = backend(100, () => 32);
    const source = await PdfFileSource.open(file.fs, "/input.pdf", { chunkBytes: 7, cacheBytes: 14 });
    const failure = new Error("backend read failed");
    file.read.mockRejectedValueOnce(failure);
    await expect(new CosRangeLexer(source).nextToken()).rejects.toBe(failure);
    const controller = new AbortController();
    file.read.mockImplementationOnce(async () => {
      controller.abort(failure);
      return new Uint8Array(7);
    });
    await expect(new CosRangeLexer(source, { signal: controller.signal }).nextToken()).rejects.toBe(failure);
    expect(file.close).not.toHaveBeenCalled();
    await source.close();
    expect(file.close).toHaveBeenCalledTimes(1);
  });

  it("retains known-command splitting across windows", async () => {
    const bytes = new TextEncoder().encode("qQBTET");
    const file = backend(bytes.length, offset => bytes[offset]!, 1);
    const source = await PdfFileSource.open(file.fs, "/input.pdf", { chunkBytes: 1, cacheBytes: 2 });
    const commands = new Set(["q", "Q", "B", "BT", "E", "ET"]);
    const range = new CosRangeLexer(source, { knownCommands: commands });
    const buffered = new CosByteLexer(bytes, 0, bytes.length, Infinity, commands);
    for (let i = 0; i < 5; i++) expect(await range.nextToken()).toEqual(buffered.nextToken());
    await source.close();
  });

});

it.each(["/abcdef", "<aabbcc>", "(abcdef)", "123456", "keyword"])("admits retained token growth before returning %s",async text=>{
 const bytes=new TextEncoder().encode('% comment\n'+text),file=backend(bytes.length,i=>bytes[i]!),source=await PdfFileSource.open(file.fs,'/input',{chunkBytes:7,cacheBytes:14}),failure=new Error('token owner rejected');
 let admitted=0;
 try{const lexer=new CosRangeLexer(source,{onTokenAllocation(size){admitted+=size;if(admitted>64)throw failure;}});await expect(lexer.nextToken()).rejects.toBe(failure);expect(admitted).toBeLessThanOrEqual(96);}finally{await source.close();}
});
it("does not admit skipped comments as resident token storage",async()=>{
 const file=backend(131072,i=>i%4096===0?37:i%4096===4095?10:120,4096),source=await PdfFileSource.open(file.fs,'/input',{chunkBytes:4096,cacheBytes:4096}),admit=vi.fn();
 try{expect(await new CosRangeLexer(source,{onTokenAllocation:admit}).nextToken()).toBeUndefined();expect(admit).not.toHaveBeenCalled();}finally{await source.close();}
});
