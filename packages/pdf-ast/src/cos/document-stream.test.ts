import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { cosDict, cosName, cosRef, cosStream, dictGet } from "../ast.js";
import { parseCosDocument } from "./parser.js";
import { concatByteArrays, serializeCosDocument, serializeCosDocumentTo, type SerializeCosOptions } from "./writer.js";

function fixture(): SerializeCosOptions {
  const doc = PdfDocument.create();
  doc.addPage().drawText("Streamed PDF bytes", { x: 20, y: 20 });
  return { objects: [...doc.cos.objects.values()], rootRef: doc.cos.rootRef, infoRef: doc.cos.infoRef, version: doc.version };
}

describe("streamed PDF document output", () => {
  it.each([
    {}, { objectStreams: "generate" as const }, { normalizeContent: true }, { linearize: true },
  ])("preserves exact output and readable documents for %j", async mode => {
    const options = { ...fixture(), ...mode };
    const expected = serializeCosDocument(options);
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    const chunks: Uint8Array[] = [];
    await serializeCosDocumentTo({ ...options, chunkBytes: 7 }, { write: async chunk => { chunks.push(chunk); } }, { fs, directory: "/scratch" });
    expect(chunks.every(chunk => chunk.length <= 7 && chunk.buffer.byteLength <= 7)).toBe(true);
    const actual = concatByteArrays(chunks);
    expect(actual).toEqual(expected);
    // Captured from the committed writer before its chunk-output refactor.
    const hashes = {
      standard: "3141473a2d7e7cce05d0f9e18d864e71c0ab342ef18cb79adab50c4b792297b9",
      generated: "84b99aaa3aa5873d007f45e6da4db5e2292b73fb603c7cf4ac1ac17face230d8",
      normalized: "5208b946282dac16fd539af92647472bf819c1248e7dccdb31c6361d23029226",
      linearized: "2a50b5d4c1de3968797d876ca10940496dcfd61157ccdc93b07e807690b720bf",
    };
    const kind = mode.linearize ? "linearized" : mode.normalizeContent ? "normalized" : mode.objectStreams ? "generated" : "standard";
    expect(createHash("sha256").update(actual).digest("hex")).toBe(hashes[kind]);
    expect(PdfDocument.load(actual).extractText()).toContain("Streamed PDF bytes");
    expect(await fs.readdir("/scratch")).toEqual([]);
    if (mode.linearize) {
      const parsed = parseCosDocument(actual);
      const linearized = [...parsed.objects.values()].find(object => object.value.kind === "dict" && dictGet(object.value, "Linearized"));
      expect(dictGet(linearized!.value as ReturnType<typeof cosDict>, "L")).toMatchObject({ value: actual.length });
    }
  });

  it("streams a large body directly without staging and stops at a slow sink", async () => {
    const payload = new Uint8Array(1024 * 1024).fill(97);
    const options: SerializeCosOptions = { objects: [
      { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog") }) },
      { objectNumber: 2, generationNumber: 0, value: cosStream(payload, { compress: false }) },
    ], rootRef: cosRef(1) };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let active = 0;
    let outstanding = 0;
    let peak = 0;
    const write = vi.fn(async (chunk: Uint8Array) => {
      active++;
      outstanding += chunk.buffer.byteLength;
      peak = Math.max(peak, outstanding);
      expect(active).toBe(1);
      if (write.mock.calls.length === 1) await gate;
      outstanding -= chunk.buffer.byteLength;
      active--;
    });
    const operation = serializeCosDocumentTo({ ...options, chunkBytes: 1024 }, { write });
    while (write.mock.calls.length === 0) await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    release();
    await operation;
    expect(peak).toBeLessThanOrEqual(1024);
    expect(write.mock.calls.length).toBeGreaterThan(1024);
    expect(payload[0]).toBe(97);
  });

  it("never allocates a payload-sized output array on the direct streaming path", async () => {
    const payload = new Uint8Array(32768).fill(97);
    const options: SerializeCosOptions = { objects: [
      { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog") }) },
      { objectNumber: 2, generationNumber: 0, value: cosStream(payload, { compress: false }) },
    ], rootRef: cosRef(1) };
    const Original = Uint8Array;
    vi.stubGlobal("Uint8Array", new Proxy(Original, {
      construct(target, args, receiver) {
        const value = args[0];
        const size = typeof value === "number" ? value : value?.byteLength ?? value?.length ?? 0;
        if (size > 128) throw new Error(`Unbounded output allocation: ${size}`);
        return Reflect.construct(target, args, receiver);
      },
    }));
    try {
      await serializeCosDocumentTo({ ...options, chunkBytes: 128 }, { write: async () => {} });
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not require staging when object-stream generation takes precedence over linearization", async () => {
    const options = { ...fixture(), objectStreams: "generate" as const, linearize: true };
    const chunks: Uint8Array[] = [];
    await serializeCosDocumentTo(options, { write: async chunk => { chunks.push(chunk); } });
    expect(concatByteArrays(chunks)).toEqual(serializeCosDocument(options));
  });

  it("rejects missing linearization storage before writing", async () => {
    const write = vi.fn(async () => {});
    await expect(serializeCosDocumentTo({ ...fixture(), linearize: true }, { write })).rejects.toMatchObject({ code: "E_CAPABILITY" });
    expect(write).not.toHaveBeenCalled();
  });

  it("enforces output budgets before a sink sees excess bytes", async () => {
    const options = fixture();
    const size = serializeCosDocument(options).length;
    const write = vi.fn(async () => {});
    await expect(serializeCosDocumentTo({ ...options, maxOutputBytes: 0 }, { write })).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(write).not.toHaveBeenCalled();
    await expect(serializeCosDocumentTo({ ...options, maxOutputBytes: size }, { write })).resolves.toBeUndefined();
    await expect(serializeCosDocumentTo({ ...options, maxOutputBytes: size - 1 }, { write })).rejects.toMatchObject({ code: "E_LIMIT" });
  });

  it("preserves sink failures and cleans up linearized staging", async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    const failure = new Error("slow sink failed");
    await expect(serializeCosDocumentTo({ ...fixture(), linearize: true }, { write: async () => { throw failure; } }, { fs, directory: "/scratch" })).rejects.toBe(failure);
    expect(await fs.readdir("/scratch")).toEqual([]);
  });

  it("observes cancellation between chunks", async () => {
    const controller = new AbortController();
    const failure = new Error("output cancelled");
    const write = vi.fn(async () => { controller.abort(failure); });
    await expect(serializeCosDocumentTo({ ...fixture(), signal: controller.signal }, { write })).rejects.toBe(failure);
    expect(write).toHaveBeenCalledOnce();
  });
});
