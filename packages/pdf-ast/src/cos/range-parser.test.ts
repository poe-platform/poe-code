import { describe, expect, it, vi } from "vitest";
import type { FileReadHandle, FileSystem } from "@poe-code/safe-fs/contracts";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { parseCosRangeObject } from "./range-parser.js";

function generatedSource(size: number, byteAt: (offset: number) => number) {
  const scratch = new Uint8Array(32);
  const read = vi.fn(async (offset: number, length: number) => {
    const count = Math.min(length, size - offset);
    for (let i = 0; i < count; i++) scratch[i] = byteAt(offset + i);
    return scratch.subarray(0, count);
  });
  const close = vi.fn(async () => {});
  const handle = { stat: async () => ({ type: "file", size }), read, close } as unknown as FileReadHandle;
  const fs = { capabilities: { retainedRead: true }, openReadFile: async () => handle,
    readFile: vi.fn(() => { throw new Error("whole-file read forbidden"); }) } as unknown as FileSystem;
  return { read, close, fs, open: () => PdfFileSource.open(fs, "/input.pdf", { chunkBytes: 32, cacheBytes: 64 }) };
}

function fromText(text: string) {
  const bytes = new TextEncoder().encode(text);
  return { bytes, file: generatedSource(bytes.length, offset => bytes[offset]!) };
}

describe("range-backed COS objects", () => {
  it("matches all objects of an edited PDF without copying stream payloads", async () => {
    const document = PdfDocument.create();
    document.addPage().drawText("Range parser parity", { x: 20, y: 20 });
    document.setTitle("Title (escaped)");
    const bytes = document.save();
    const expected = PdfDocument.load(bytes);
    const file = generatedSource(bytes.length, offset => bytes[offset]!);
    const source = await file.open();
    try {
      for (const object of expected.cos.objects.values()) {
        const parsed = await parseCosRangeObject(source, object.span!.start);
        expect(parsed.objectNumber).toBe(object.objectNumber);
        expect(parsed.generationNumber).toBe(object.generationNumber);
        if (object.value.kind === "stream") {
          expect(parsed.value).toEqual(object.value.dict);
          expect(bytes.subarray(parsed.stream!.start, parsed.stream!.end)).toEqual(object.value.rawBytes);
        } else {
          expect(parsed.value).toEqual(object.value);
          expect(parsed.stream).toBeUndefined();
        }
        expect(parsed.span).toEqual(object.span);
      }
      expect(file.fs.readFile).not.toHaveBeenCalled();
    } finally { await source.close(); }
  });

  it("seeks over a generated 512 MiB stream while retaining only its range", async () => {
    const length = 512 * 1024 * 1024;
    const head = new TextEncoder().encode(`1 0 obj\n<< /Length ${length} >>\nstream\n`);
    const tail = new TextEncoder().encode("\nendstream\nendobj");
    const file = generatedSource(head.length + length + tail.length, offset => offset < head.length ? head[offset]! : offset < head.length + length ? 42 : tail[offset - head.length - length]!);
    const source = await file.open();
    try {
      const object = await parseCosRangeObject(source, 0);
      expect(object.stream).toEqual({ start: head.length, end: head.length + length });
      expect(file.read.mock.calls.every(([offset]) => offset < head.length + 32 || offset >= head.length + length - 32)).toBe(true);
      expect(file.read.mock.calls.length).toBeLessThan(10);
      expect(file.fs.readFile).not.toHaveBeenCalled();
    } finally { await source.close(); }
  });

  it.each(["1", "99999", "0"])("recovers incorrect stream length %s across windows", async length => {
    const raw = "Some data endstream ignored data that crosses a range boundary";
    const { bytes, file } = fromText(`1 0 obj\n<< /Length ${length} >>\nstream\n${raw}\r\nendstream\nendobj`);
    const source = await file.open();
    try {
      const object = await parseCosRangeObject(source, 0);
      expect(new TextDecoder().decode(bytes.subarray(object.stream!.start, object.stream!.end))).toBe(raw);
    } finally { await source.close(); }
  });

  it("resolves indirect lengths without scanning stream contents", async () => {
    const raw = "has endstream endobj inside the payload";
    const { bytes, file } = fromText(`1 0 obj\n<< /Length 2 0 R >>\nstream\n${raw}\nendstream\nendobj`);
    const source = await file.open();
    const resolveLength = vi.fn(async () => raw.length);
    try {
      const object = await parseCosRangeObject(source, 0, { resolveLength });
      expect(resolveLength).toHaveBeenCalledWith(expect.objectContaining({ kind: "ref", objectNumber: 2, generationNumber: 0 }));
      expect(new TextDecoder().decode(bytes.subarray(object.stream!.start, object.stream!.end))).toBe(raw);
    } finally { await source.close(); }
  });

  it("enforces structural budgets and cancellation while leaving source ownership with the caller", async () => {
    const { file } = fromText("1 0 obj\n[[[1 2 3 4 5]]] endobj");
    const source = await file.open();
    await expect(parseCosRangeObject(source, 0, { maxRecursionDepth: 1 })).rejects.toMatchObject({ code: "E_LIMIT" });
    await expect(parseCosRangeObject(source, 0, { maxNodes: 3 })).rejects.toMatchObject({ code: "E_LIMIT" });
    const controller = new AbortController();
    const failure = new Error("cancel object read");
    controller.abort(failure);
    await expect(parseCosRangeObject(source, 0, { signal: controller.signal })).rejects.toBe(failure);
    expect(file.close).not.toHaveBeenCalled();
    await source.close();
  });
  it("scans damaged lengths without allocating a payload-wide buffer", async () => {
    const head = new TextEncoder().encode("1 0 obj << /Length 1 >> stream\n");
    const length = 32 * 1024;
    const tail = new TextEncoder().encode("\nendstream endobj");
    const file = generatedSource(head.length + length + tail.length, offset => offset < head.length ? head[offset]! : offset < head.length + length ? 120 : tail[offset - head.length - length]!);
    const source = await file.open();
    const Original = Uint8Array;
    vi.stubGlobal("Uint8Array", new Proxy(Original, {
      construct(target, args) {
        if (typeof args[0] === "number" && args[0] > 32) throw new Error("payload-wide allocation");
        return Reflect.construct(target, args);
      },
    }));
    try {
      const object = await parseCosRangeObject(source, 0);
      expect(object.stream).toEqual({ start: head.length, end: head.length + length });
      expect(file.read.mock.calls.every(([, length]) => length <= 32)).toBe(true);
    } finally { vi.unstubAllGlobals(); await source.close(); }
  });

  it("preserves primary read errors and cancellation during stream recovery", async () => {
    const { file } = fromText("1 0 obj << /Length 1 >> stream\n" + "x".repeat(1024) + "\nendstream endobj");
    const source = await file.open();
    const original = file.read.getMockImplementation()!;
    const failure = new Error("source failed");
    file.read.mockImplementation(async (offset, length) => {
      if (offset >= 64) throw failure;
      return original(offset, length);
    });
    await expect(parseCosRangeObject(source, 0)).rejects.toBe(failure);
    const controller = new AbortController();
    file.read.mockImplementation(async (offset, length) => {
      if (offset >= 64) controller.abort(failure);
      return original(offset, length);
    });
    await expect(parseCosRangeObject(source, 0, { signal: controller.signal })).rejects.toBe(failure);
    expect(file.close).not.toHaveBeenCalled();
    await source.close();
  });

  it("preserves dictionary recovery and exact node admission", async () => {
    const { file } = fromText("1 0 obj << /Good 1 stray /More [2 3] >> endobj");
    const source = await file.open();
    try {
      await expect(parseCosRangeObject(source, 0)).rejects.toMatchObject({ code: "E_PARSE" });
      await expect(parseCosRangeObject(source, 0, { recovery: "repair", maxNodes: 7 })).resolves.toMatchObject({ value: { kind: "dict" } });
      await expect(parseCosRangeObject(source, 0, { recovery: "repair", maxNodes: 6 })).rejects.toMatchObject({ code: "E_LIMIT" });
    } finally { await source.close(); }
  });

  it.each(["", "1 0", "1 0 obj << /Length 5 >> stream missing marker"])("rejects malformed object %j", async input => {
    const { file } = fromText(input);
    const source = await file.open();
    try { await expect(parseCosRangeObject(source, 0)).rejects.toMatchObject({ code: "E_PARSE" }); }
    finally { await source.close(); }
  });

  it("cancels a pending indirect length resolution without waiting for its result", async () => {
    const { file } = fromText("1 0 obj << /Length 2 0 R >> stream\nabc\nendstream endobj");
    const source = await file.open();
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let release!: (length: number) => void;
    const lookup = new Promise<number>(resolve => { release = resolve; });
    const failure = new Error("cancel length lookup");
    const pending = parseCosRangeObject(source, 0, { signal: controller.signal, resolveLength: () => { entered(); return lookup; } });
    const result = pending.then(() => undefined, error => error);
    try {
      await started;
      controller.abort(failure);
      const winner = await Promise.race([result, new Promise(resolve => setTimeout(() => resolve("still pending"), 10))]);
      expect(winner).toBe(failure);
      expect(file.close).not.toHaveBeenCalled();
    } finally { release(3); await result; await source.close(); }
  });

});


it("preserves direct-value numeric classification when compacting long source spellings",async()=>{
 const {file}=fromText("1 0 obj ["+"0".repeat(4096)+"7.0 -"+"0".repeat(4096)+"0 1e"+"0".repeat(4096)+"0] endobj"),source=await file.open();
 try{
  const object=await parseCosRangeObject(source,0,{compactNumbers:true});
  expect(object.value.kind).toBe("array");if(object.value.kind!=="array")throw new Error("Missing array");
  expect(object.value.items).toMatchObject([{kind:"number",value:7,isInteger:false},{kind:"number",value:-0,isInteger:true},{kind:"number",value:1,isInteger:true}]);
  for(const node of object.value.items)if(node.kind==="number")expect(node.raw.length).toBeLessThanOrEqual(2048);
 }finally{await source.close();}
});
