import { describe, expect, it, vi } from "vitest";
import {
  convert,
  readDocument,
  writeDocument,
  PandocError,
  formatCapabilities
} from "@poe-code/pandoc";
import type { ConversionContext, Document, ConversionOptions, InputSource } from "@poe-code/pandoc";

const encode = (value: string) => new TextEncoder().encode(value);
const document: Document = {
  blocks: [{ t: "Para", c: [{ t: "Str", c: "original" }] }],
  metadata: {},
  resources: []
};
function context(): { -readonly [K in keyof ConversionContext]: ConversionContext[K] } {
  return {
    reader: { format: "commonmark", read: vi.fn(async () => structuredClone(document)) },
    writer: {
      format: "plain",
      write: vi.fn(async (doc) => ({
        kind: "text" as const,
        text: String(doc.blocks.length) + "\n"
      }))
    }
  };
}
const options: ConversionOptions = { from: "commonmark", to: "plain" };

describe("public conversion seam (original adapters, no format conformance claim)", () => {
  it("supplies identical normalized text/documents/output across one-byte chunk boundaries", async () => {
    const bytes = encode("\ufeffé𐀀\r\nx\ry");
    const inputs: InputSource[] = [
      { bytes },
      { chunks: Array.from(bytes, (byte) => Uint8Array.of(byte)) }
    ];
    const results = [];
    const ctx = context();
    ctx.reader = {
      format: "commonmark",
      read: async (input) => ({
        blocks: [{ t: "Para", c: [{ t: "Str", c: input.text! }] }],
        metadata: {},
        resources: []
      })
    };
    ctx.writer = {
      format: "plain",
      write: async (doc) => ({ kind: "text", text: JSON.stringify(doc) })
    };
    for (const input of inputs)
      results.push(await convert([input], options, { ...ctx, yield: async () => {} }));
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ text: expect.stringContaining("é𐀀\\nx\\ny") });
  });
  it("rejects invalid text before reader work but preserves non-UTF8 RTF byte input", async () => {
    const ctx = context();
    await expect(
      readDocument({ bytes: Uint8Array.of(0xc3) }, { from: "commonmark" }, ctx)
    ).rejects.toMatchObject({ code: "E_ENCODING" });
    expect(ctx.reader!.read).not.toHaveBeenCalled();
    ctx.reader = {
      format: "rtf",
      read: vi.fn(async (input) => {
        expect(input.bytes).toEqual(Uint8Array.of(0xff));
        expect(input.text).toBeUndefined();
        return document;
      })
    };
    await readDocument({ chunks: [Uint8Array.of(0xff)] }, { from: "rtf" }, ctx);
    expect(ctx.reader.read).toHaveBeenCalledTimes(1);
  });
  it("bounds diagnostics before merging metadata conflicts", async () => {
    const ctx = context();
    ctx.reader = {format: "csv", read: ctx.reader!.read};
    ctx.reader!.read = async () => ({
      ...document,
      metadata: { title: { t: "MetaString", c: "original" } }
    });
    await expect(
      convert([{ bytes: encode("a") }, { bytes: encode("b") }], {...options, from: "csv"}, {
        ...ctx,
        limits: { diagnostics: 0 }
      })
    ).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(ctx.writer!.write).not.toHaveBeenCalled();
  });
  it("shares bounded owned diagnostics from readers and writers", async () => {
    for (const diagnostics of [1, 2, 3]) {
      const ctx = context();
      const original = {
        code: "W_METADATA_CONFLICT" as const,
        operation: "convert" as const,
        message: "original reader notice"
      };
      ctx.reader!.read = async (_input, adapter) => {
        adapter.report(original);
        original.message = "mutated";
        return document;
      };
      ctx.writer!.write = async (_document, adapter) => {
        adapter.report({ ...original, message: "original writer notice" });
        return { kind: "text", text: "original" };
      };
      const pending = convert([{ bytes: encode("a") }], options, {
        ...ctx,
        limits: { diagnostics }
      });
      if (diagnostics < 2) await expect(pending).rejects.toMatchObject({ code: "E_LIMIT" });
      else
        expect((await pending).diagnostics.map((item) => item.message)).toEqual([
          "original reader notice",
          "original writer notice"
        ]);
    }
  });
  it("never succeeds when streaming output close rejects and aborts it once", async () => {
    const abort = vi.fn(async () => {});
    await expect(
      convert([], options, {
        ...context(),
        output: {
          write: async () => {},
          close: async () => {
            throw new Error("original close failure");
          },
          abort
        }
      })
    ).rejects.toMatchObject({ code: "E_IO" });
    expect(abort).toHaveBeenCalledTimes(1);
  });
  it("owns the entire binary output before the first awaited sink write", async () => {
    const bytes = new Uint8Array(4097).fill(65);
    const chunks: Uint8Array[] = [];
    const ctx = context();
    ctx.writer = { format: "epub", write: async () => ({ kind: "binary", bytes }) };
    const result = await convert(
      [],
      { from: "commonmark", to: "epub" },
      {
        ...ctx,
        yield: async () => {},
        output: {
          write: async (chunk) => {
            chunks.push(chunk);
            bytes.fill(66);
          },
          close: async () => {},
          abort: async () => {}
        }
      }
    );
    expect(chunks.map((chunk) => [...chunk]).flat()).toEqual(
      Array.from({ length: 4097 }, () => 65)
    );
    expect(result.kind === "binary" && [...result.bytes]).toEqual(
      chunks.map((chunk) => [...chunk]).flat()
    );
  });
  it("bounds the number of document resources before cloning", async () => {
    const ctx = context();
    ctx.reader!.read = async () => ({
      ...document,
      resources: [{ id: "original", bytes: Uint8Array.of(1) }]
    });
    await expect(
      readDocument(
        { bytes: encode("a") },
        { from: "commonmark" },
        { ...ctx, limits: { resources: 0 } }
      )
    ).rejects.toMatchObject({ code: "E_LIMIT" });
  });
  it("enforces compressed EPUB byte budgets at max-1/max/max+1 before reader work", async () => {
    for (const count of [1, 2, 3]) {
      const read = vi.fn(async () => document);
      const pending = readDocument(
        { chunks: Array.from({ length: count }, () => Uint8Array.of(0xff)) },
        { from: "epub" },
        {
          reader: { format: "epub", read },
          limits: { compressedBytes: 2 },
          yield: async () => {}
        }
      );
      if (count <= 2) expect(await pending).toEqual(document);
      else {
        await expect(pending).rejects.toMatchObject({ code: "E_LIMIT" });
        expect(read).not.toHaveBeenCalled();
      }
    }
  });
  it("bounds UTF-8 output byte size exactly, including split surrogate encoding", async () => {
    for (const text of ["a", "é", "€"]) {
      const ctx = {
        ...context(),
        limits: { outputBytes: 2 },
        writer: { format: "plain", write: async () => ({ kind: "text" as const, text }) }
      };
      if (encode(text).length <= 2) expect(await convert([], options, ctx)).toMatchObject({ text });
      else await expect(convert([], options, ctx)).rejects.toMatchObject({ code: "E_LIMIT" });
    }
    const text = "a".repeat(4095) + "𐀀end";
    const published: Uint8Array[] = [];
    const ctx = context();
    ctx.writer = { format: "plain", write: async () => ({ kind: "text", text }) };
    await convert([], options, {
      ...ctx,
      yield: async () => {},
      output: {
        publish: async (bytes) => {
          published.push(bytes);
        }
      }
    });
    expect(published[0]).toEqual(encode(text));
  });
  it("cancels during output CPU encoding before publishing", async () => {
    const controller = new AbortController();
    const publish = vi.fn(async () => {});
    const ctx = context();
    ctx.writer = { format: "plain", write: async () => ({ kind: "text", text: "a".repeat(1000) }) };
    await expect(
      convert([], options, {
        ...ctx,
        signal: controller.signal,
        output: { publish },
        yield: async () => {
          controller.abort();
        }
      })
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(publish).not.toHaveBeenCalled();
  });
  it("rejects invalid writer Unicode before output and retains completed results after later cancellation", async () => {
    const publish = vi.fn(async () => {});
    const ctx = context();
    ctx.writer = { format: "plain", write: async () => ({ kind: "text", text: "\ud800" }) };
    await expect(convert([], options, { ...ctx, output: { publish } })).rejects.toMatchObject({
      code: "E_ENCODING"
    });
    expect(publish).not.toHaveBeenCalled();
    const controller = new AbortController();
    const result = await convert([], options, { ...context(), signal: controller.signal });
    controller.abort();
    expect(result).toEqual({ kind: "text", text: "0\n", diagnostics: [] });
  });
  it("joins text in order, reads once and writes once", async () => {
    const ctx = context();
    const result = await convert(
      [{ bytes: encode("one") }, { bytes: encode("two") }],
      options,
      ctx
    );
    expect(result).toEqual({ kind: "text", text: "1\n", diagnostics: [] });
    expect(ctx.reader!.read).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ctx.reader!.read).mock.calls[0]![0].text).toBe("one\ntwo\n");
    expect(ctx.writer!.write).toHaveBeenCalledTimes(1);
  });
  it("shares validation before any input or writer work", async () => {
    const ctx = context();
    for (const operation of [
      () => convert([{ bytes: encode("x") }], { ...options, from: "markdown" }, ctx),
      () => readDocument({ bytes: encode("x") }, { from: "markdown" }, ctx),
      () => writeDocument(document, { to: "markdown" }, ctx)
    ])
      await expect(operation()).rejects.toMatchObject({ code: "E_FORMAT" });
    expect(ctx.reader!.read).not.toHaveBeenCalled();
    expect(ctx.writer!.write).not.toHaveBeenCalled();
  });
  it("claims the implemented CommonMark reader and JSON codec", async () => {
    expect(
      formatCapabilities
        .filter((format) => format.read.available || format.write.available)
        .map((format) => format.name)
    ).toEqual(["commonmark", "csv", "epub", "gfm", "html", "html5", "json", "latex", "pdf", "plain", "rst", "rtf", "tsv"]);
    await expect(
      readDocument({ bytes: encode("# actual syntax") }, { from: "commonmark" }, {})
    ).resolves.toMatchObject({ blocks: [{ t: "Header", c: [1, ["", [], []], [{ t: "Str", c: "actual" }, { t: "Space" }, { t: "Str", c: "syntax" }]] }] });
  });
  it("owns input, documents and binary results across capability boundaries", async () => {
    const input = encode("x");
    const output = encode("binary");
    const ctx = context();
    ctx.reader!.read = async (source) => {
      source.bytes[0] = 0;
      return document;
    };
    ctx.writer = {
      format: "epub",
      write: async (doc) => {
        (doc.blocks as unknown[]).length = 0;
        return { kind: "binary", bytes: output };
      }
    };
    const result = await convert([{ bytes: input }], { from: "commonmark", to: "epub" }, ctx);
    output[0] = 0;
    expect(input).toEqual(encode("x"));
    expect(document.blocks).toHaveLength(1);
    expect(result.kind === "binary" && result.bytes).toEqual(encode("binary"));
  });
  it("bounds aggregate inputs and output before publication", async () => {
    const publish = vi.fn(async () => {});
    const ctx = { ...context(), limits: { inputBytes: 1 }, output: { publish } };
    await expect(
      convert([{ bytes: encode("x") }, { bytes: encode("y") }], options, ctx)
    ).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(publish).not.toHaveBeenCalled();
    await expect(
      convert([{ bytes: encode("x") }], options, {
        ...context(),
        limits: { outputBytes: 1 },
        output: { publish }
      })
    ).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(publish).not.toHaveBeenCalled();
  });
  it("rejects raised ceilings and aborted operations before callbacks", async () => {
    const ctx = context();
    await expect(
      convert([], options, { ...ctx, limits: { inputBytes: 33 * 1024 * 1024 } })
    ).rejects.toBeInstanceOf(PandocError);
    const controller = new AbortController();
    controller.abort();
    await expect(convert([], options, { ...ctx, signal: controller.signal })).rejects.toMatchObject(
      { code: "E_CANCELLED" }
    );
    expect(ctx.writer!.write).not.toHaveBeenCalled();
  });
  it("checks cancellation after a capability returns and before publish", async () => {
    const controller = new AbortController();
    const publish = vi.fn(async () => {});
    await expect(
      convert([], options, {
        ...context(),
        signal: controller.signal,
        output: { publish },
        writer: {
          format: "plain",
          write: async () => {
            controller.abort();
            return { kind: "text", text: "x\n" };
          }
        }
      })
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(publish).not.toHaveBeenCalled();
  });
  it("copies Node Buffer bytes rather than retaining their views", async () => {
    const source = Buffer.from("source");
    const output = Buffer.from("result");
    const ctx = context();
    ctx.reader!.read = async (input) => {
      input.bytes[0] = 0;
      return document;
    };
    ctx.writer = { format: "epub", write: async () => ({ kind: "binary", bytes: output }) };
    const result = await convert([{ bytes: source }], { from: "commonmark", to: "epub" }, ctx);
    output[0] = 0;
    expect(source.toString()).toBe("source");
    expect(result.kind === "binary" && new TextDecoder().decode(result.bytes)).toBe("result");
  });
  it("rejects unknown options before adapters run", async () => {
    const ctx = context();
    await expect(
      convert([], { ...options, unsafe: true } as ConversionOptions, ctx)
    ).rejects.toMatchObject({ code: "E_OPTION" });
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
    await convert([{ bytes: encode("x") }], options, {
      ...ctx,
      resources: { resolve: async () => bytes }
    });
    expect(bytes.toString()).toBe("image");
    await expect(
      convert([{ bytes: encode("x") }], options, {
        ...ctx,
        limits: { resourceBytes: 1 },
        resources: { resolve: async () => bytes }
      })
    ).rejects.toMatchObject({ code: "E_LIMIT" });
  });
});
