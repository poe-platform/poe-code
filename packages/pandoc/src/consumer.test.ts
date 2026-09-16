import { describe, expect, it, vi } from "vitest";
import { convert, readDocument, writeDocument, PandocError, formatCapabilities } from "@poe-code/pandoc";
import type { ConversionContext, Document, ConversionOptions } from "@poe-code/pandoc";

const encode = (value: string) => new TextEncoder().encode(value);
const document: Document = { blocks: [{ t: "Para", c: [{ t: "Str", c: "original" }] }], metadata: {}, resources: [] };
function context(): { -readonly [K in keyof ConversionContext]: ConversionContext[K] } {
  return {
    reader: { format: "commonmark", read: vi.fn(async () => structuredClone(document)) },
    writer: { format: "plain", write: vi.fn(async (doc) => ({ kind: "text" as const, text: String(doc.blocks.length) + "\n" })) }
  };
}
const options: ConversionOptions = { from: "commonmark", to: "plain" };

describe("public conversion seam (original adapters, no format conformance claim)", () => {
  it("reads independently in order, merges blocks and writes once", async () => {
    const ctx = context();
    const result = await convert([{ bytes: encode("one") }, { bytes: encode("two") }], options, ctx);
    expect(result).toEqual({ kind: "text", text: "2\n", diagnostics: [] });
    expect(ctx.reader!.read).toHaveBeenCalledTimes(2);
    expect(ctx.writer!.write).toHaveBeenCalledTimes(1);
  });
  it("shares validation before any input or writer work", async () => {
    const ctx = context();
    for (const operation of [
      () => convert([{ bytes: encode("x") }], { ...options, from: "markdown" }, ctx),
      () => readDocument({ bytes: encode("x") }, { from: "markdown" }, ctx),
      () => writeDocument(document, { to: "markdown" }, ctx)
    ]) await expect(operation()).rejects.toMatchObject({ code: "E_FORMAT" });
    expect(ctx.reader!.read).not.toHaveBeenCalled();
    expect(ctx.writer!.write).not.toHaveBeenCalled();
  });
  it("does not claim a built-in parser", async () => {
    expect(formatCapabilities.every(format => !format.read.available && !format.write.available)).toBe(true);
    await expect(readDocument({ bytes: encode("# actual syntax") }, { from: "commonmark" }, {})).rejects.toMatchObject({ code: "E_CAPABILITY" });
  });
  it("owns input, documents and binary results across capability boundaries", async () => {
    const input = encode("x");
    const output = encode("binary");
    const ctx = context();
    ctx.reader!.read = async (source) => { source.bytes[0] = 0; return document; };
    ctx.writer = { format: "epub", write: async (doc) => { (doc.blocks as unknown[]).length = 0; return { kind: "binary", bytes: output }; } };
    const result = await convert([{ bytes: input }], { from: "commonmark", to: "epub" }, ctx);
    output[0] = 0;
    expect(input).toEqual(encode("x"));
    expect(document.blocks).toHaveLength(1);
    expect(result.kind === "binary" && result.bytes).toEqual(encode("binary"));
  });
  it("bounds aggregate inputs and output before publication", async () => {
    const publish = vi.fn(async () => {});
    const ctx = { ...context(), limits: { inputBytes: 1 }, output: { publish } };
    await expect(convert([{ bytes: encode("x") }, { bytes: encode("y") }], options, ctx)).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(publish).not.toHaveBeenCalled();
    await expect(convert([{ bytes: encode("x") }], options, { ...context(), limits: { outputBytes: 1 }, output: { publish } })).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(publish).not.toHaveBeenCalled();
  });
  it("rejects raised ceilings and aborted operations before callbacks", async () => {
    const ctx = context();
    await expect(convert([], options, { ...ctx, limits: { inputBytes: 33 * 1024 * 1024 } })).rejects.toBeInstanceOf(PandocError);
    const controller = new AbortController(); controller.abort();
    await expect(convert([], options, { ...ctx, signal: controller.signal })).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(ctx.writer!.write).not.toHaveBeenCalled();
  });
  it("checks cancellation after a capability returns and before publish", async () => {
    const controller = new AbortController();
    const publish = vi.fn(async () => {});
    await expect(convert([], options, { ...context(), signal: controller.signal, output: { publish }, writer: { format: "plain", write: async () => { controller.abort(); return { kind: "text", text: "x\n" }; } } })).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(publish).not.toHaveBeenCalled();
  });
  it("copies Node Buffer bytes rather than retaining their views", async () => {
    const source = Buffer.from("source");
    const output = Buffer.from("result");
    const ctx = context();
    ctx.reader!.read = async input => { input.bytes[0] = 0; return document; };
    ctx.writer = { format: "epub", write: async () => ({ kind: "binary", bytes: output }) };
    const result = await convert([{ bytes: source }], { from: "commonmark", to: "epub" }, ctx);
    output[0] = 0;
    expect(source.toString()).toBe("source");
    expect(result.kind === "binary" && new TextDecoder().decode(result.bytes)).toBe("result");
  });
  it("rejects unknown options before adapters run", async () => {
    const ctx = context();
    await expect(convert([], { ...options, unsafe: true } as ConversionOptions, ctx)).rejects.toMatchObject({ code: "E_OPTION" });
    expect(ctx.writer!.write).not.toHaveBeenCalled();
  });
  it("bounds and owns resources from explicit resolvers", async () => {
    const bytes = Buffer.from("image");
    const ctx = context();
    ctx.reader!.read = async (_input, adapter) => {
      const resource = await adapter.resources!.resolve("image", undefined, adapter.signal);
      resource[0] = 0;
      return document;
    };
    await convert([{ bytes: encode("x") }], options, { ...ctx, resources: { resolve: async () => bytes } });
    expect(bytes.toString()).toBe("image");
    await expect(convert([{ bytes: encode("x") }], options, { ...ctx, limits: { resourceBytes: 1 }, resources: { resolve: async () => bytes } })).rejects.toMatchObject({ code: "E_LIMIT" });
  });

});
