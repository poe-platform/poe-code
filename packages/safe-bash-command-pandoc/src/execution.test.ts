import { describe, expect, it, vi } from "vitest";
import { createExecutionContext, defaultLimits } from "./execution.js";
import { PandocError } from "./errors.js";

const encode = (text: string) => new TextEncoder().encode(text);
const immediate = async () => {};

describe("original execution-context fixtures", () => {
  it("retains reader format and source location through capability error normalization", async () => {
    const context = createExecutionContext("convert", { yield: immediate });
    await expect(context.call(async () => {
      throw new PandocError("E_AST", "read", "Original malformed input", "json", "2:4");
    })).rejects.toMatchObject({ code: "E_AST", operation: "convert", format: "json", location: "2:4" });
  });
  it("normalizes synchronous host throws and simultaneous cancellation", async () => {
    const ordinary = createExecutionContext("read", { yield: immediate });
    await expect(
      ordinary.call(() => {
        throw new Error("original synchronous failure");
      })
    ).rejects.toMatchObject({ code: "E_IO" });
    const controller = new AbortController();
    const context = createExecutionContext("read", { signal: controller.signal, yield: immediate });
    await expect(
      context.call(() => {
        controller.abort();
        throw new Error("original aborted host failure");
      })
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
  });
  it("checks every finite aggregate budget at max-1, max, max+1 before mutation", () => {
    for (const key of Object.keys(defaultLimits) as (keyof typeof defaultLimits)[]) {
      const context = createExecutionContext("read", { limits: { [key]: 2 }, yield: immediate });
      context.charge(key, 1);
      context.charge(key, 1);
      expect(() => context.charge(key, 1)).toThrowError(/exceeds/);
      expect(() => context.checkpoint(0)).toThrowError(/exceeds/);
    }
  });
  it("decodes identical Unicode and newline policy at every chunk boundary", async () => {
    const bytes = encode("\ufeffAé𐀀\r\nB\rC\ufeff");
    for (let size = 1; size <= bytes.length; size++) {
      const context = createExecutionContext("read", { yield: immediate });
      const chunks = Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) =>
        bytes.subarray(i * size, (i + 1) * size)
      );
      expect(await context.decodeUtf8(chunks)).toBe("Aé𐀀\nB\nC\ufeff");
    }
    const context = createExecutionContext("read", { yield: immediate });
    expect(await context.decodeUtf8([encode("\ufeffone")])).toBe("one");
    expect(await context.decodeUtf8([encode("\ufefftwo")])).toBe("two");
  });
  it("charges decoded UTF-16 units exactly at max-1/max/max+1", async () => {
    for (const text of ["a", "éé", "𐀀a"]) {
      const context = createExecutionContext("read", { limits: { text: 2 }, yield: immediate });
      if (text.length <= 2) expect(await context.decodeUtf8([encode(text)])).toBe(text);
      else
        await expect(context.decodeUtf8([encode(text)])).rejects.toMatchObject({ code: "E_LIMIT" });
    }
  });
  it("does not charge producer chunk boundaries as reference-index entries", async () => {
    for (const chunks of [[encode("abc")], [encode("a"), encode("b"), encode("c")]]) {
      const context = createExecutionContext("read", {
        limits: { references: 1 },
        yield: immediate
      });
      expect(await context.acquire(chunks)).toEqual(encode("abc"));
      const decoder = createExecutionContext("read", {
        limits: { references: 1 },
        yield: immediate
      });
      expect(await decoder.decodeUtf8(chunks)).toBe("abc");
    }
  });
  it("bounds decoded entity bytes before constructing expanded text", () => {
    for (const code of [0x61, 0xe9, 0x20ac]) {
      const context = createExecutionContext("read", { limits: { entityBytes: 2 } });
      if (code <= 0x7ff) expect(context.decodeEntity(code)).toBe(String.fromCodePoint(code));
      else expect(() => context.decodeEntity(code)).toThrowError(/entityBytes/);
    }
    const context = createExecutionContext("read", { limits: { entities: 1 } });
    expect(context.decodeEntity(0x61)).toBe("a");
    expect(() => context.decodeEntity(0x62)).toThrowError(/entities/);
  });
  it("aggregates expanded containers and RTF binary blocks with resolved resources", async () => {
    const context = createExecutionContext("read", {
      limits: { resourceBytes: 3 },
      resources: { resolve: async () => Uint8Array.of(1) }
    });
    await context.resources!.resolve("original", undefined, undefined);
    context.charge("expandedBytes", 1);
    context.charge("binaryBytes", 1);
    expect(() => context.charge("expandedBytes", 1)).toThrowError(/resourceBytes/);
  });
  it("decodes RTF text runs by codepage and retains binary blocks without UTF-8 decoding", async () => {
    const context = createExecutionContext("read", { yield: immediate });
    expect(await context.decodeCodepage(Uint8Array.of(0x80, 0xe9, 0xff), 1252)).toBe("€éÿ");
    expect(await context.decodeCodepage(Uint8Array.of(0x80, 0xe9), 28591)).toBe("\u0080é");
    const source = Uint8Array.of(0xff, 0x00, 0xc3);
    const owned = context.retainBinaryBlock(source);
    source.fill(0);
    expect(owned).toEqual(Uint8Array.of(0xff, 0x00, 0xc3));
    for (const count of [1, 2, 3]) {
      const bounded = createExecutionContext("read", { limits: { binaryBytes: 2 } });
      if (count <= 2) expect(bounded.retainBinaryBlock(new Uint8Array(count))).toHaveLength(count);
      else
        expect(() => bounded.retainBinaryBlock(new Uint8Array(count))).toThrowError(/binaryBytes/);
    }
  });
  it("cancels UTF-8/codepage CPU decoding at deterministic yields", async () => {
    for (const kind of ["utf8", "codepage"] as const) {
      const controller = new AbortController();
      const context = createExecutionContext("read", {
        signal: controller.signal,
        yield: async () => {
          controller.abort();
        }
      });
      const bytes = new Uint8Array(300).fill(65);
      await expect(
        kind === "utf8" ? context.decodeUtf8([bytes]) : context.decodeCodepage(bytes, 1252)
      ).rejects.toMatchObject({ code: "E_CANCELLED" });
    }
  });
  it("reserves CPU work before decoded text growth", async () => {
    for (const kind of ["utf8", "codepage"] as const) {
      const context = createExecutionContext("read", {
        limits: { work: 0, text: 0 },
        yield: immediate
      });
      await expect(
        kind === "utf8"
          ? context.decodeUtf8([encode("a")])
          : context.decodeCodepage(encode("a"), 1252)
      ).rejects.toMatchObject({ code: "E_LIMIT", message: expect.stringContaining("work") });
    }
  });
  it("does not allow gauges or growth after context closure", async () => {
    const context = createExecutionContext("read");
    await context.close();
    expect(() => context.bound("depth", 1)).toThrowError(/closed/);
    const next = vi.fn(async () => ({ done: true as const, value: undefined }));
    await expect(
      context.acquire({ [Symbol.asyncIterator]: () => ({ next }) })
    ).rejects.toMatchObject({ code: "E_IO" });
    expect(next).not.toHaveBeenCalled();
  });
  it.each([[0xc3], [0xf0, 0x90, 0x80], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xff]])(
    "rejects malformed/trailing UTF-8 %j",
    async (...bytes) => {
      const context = createExecutionContext("read", { yield: immediate });
      await expect(
        context.decodeUtf8(bytes.map((byte) => Uint8Array.of(byte)))
      ).rejects.toMatchObject({ code: "E_ENCODING" });
    }
  );
  it("owns chunks before asking a producer to reuse its buffer", async () => {
    const buffer = Uint8Array.of(1);
    async function* source() {
      yield buffer;
      buffer[0] = 2;
      yield buffer;
      buffer[0] = 3;
    }
    const context = createExecutionContext("read", { yield: immediate });
    expect(await context.acquire(source())).toEqual(Uint8Array.of(1, 2));
  });
  it("bounds acquisition before copying and closes a producer once on failure", async () => {
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    const next = vi.fn(async () => ({ done: false as const, value: Uint8Array.of(1, 2, 3) }));
    const context = createExecutionContext("read", { limits: { inputBytes: 2 }, yield: immediate });
    await expect(
      context.acquire({ [Symbol.asyncIterator]: () => ({ next, return: returned }) })
    ).rejects.toMatchObject({ code: "E_LIMIT" });
    await context.close();
    await context.close();
    expect(next).toHaveBeenCalledTimes(1);
    expect(returned).toHaveBeenCalledTimes(1);
  });
  it("admits max-1/max input bytes and rejects max+1 for whole and one-byte chunks", async () => {
    for (const count of [1, 2, 3]) {
      const bytes = new Uint8Array(count).fill(0xff);
      for (const chunks of [[bytes], Array.from(bytes, (byte) => Uint8Array.of(byte))]) {
        const context = createExecutionContext("read", {
          limits: { inputBytes: 2 },
          yield: immediate
        });
        if (count <= 2) expect(await context.acquire(chunks)).toEqual(bytes);
        else await expect(context.acquire(chunks)).rejects.toMatchObject({ code: "E_LIMIT" });
        await context.close();
      }
    }
  });
  it("awaits backpressure and never succeeds after a caught sink rejection", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = vi.fn(() => gate);
    const abort = vi.fn(immediate);
    const context = createExecutionContext("write", {
      output: { write, close: immediate, abort },
      yield: immediate
    });
    const pending = context.emit(Uint8Array.of(1));
    expect(write).toHaveBeenCalledTimes(1);
    release();
    await pending;
    write.mockImplementationOnce(async () => {
      throw new Error("original sink failure");
    });
    await expect(context.emit(Uint8Array.of(2))).rejects.toMatchObject({ code: "E_IO" });
    await expect(context.completeOutput()).rejects.toMatchObject({ code: "E_IO" });
    await context.close();
    await context.close();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(2);
  });
  it("closes output once under concurrent completion and rejects writes during close", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const close = vi.fn(() => gate);
    const context = createExecutionContext("write", {
      output: { write: immediate, close, abort: immediate }
    });
    const first = context.completeOutput();
    const second = context.completeOutput();
    expect(close).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    const pending = createExecutionContext("write", {
      output: { write: immediate, close: () => new Promise<void>(() => {}), abort: immediate }
    });
    const completion = pending.completeOutput();
    const rejectedCompletion = expect(completion).rejects.toMatchObject({ code: "E_IO" });
    await expect(pending.emit(Uint8Array.of(1))).rejects.toMatchObject({ code: "E_IO" });
    await pending.close();
    await rejectedCompletion;
  });
  it("cancels pending sink backpressure, aborts once and never writes again", async () => {
    const controller = new AbortController();
    const write = vi.fn(() => new Promise<void>(() => {}));
    const abort = vi.fn(immediate);
    const context = createExecutionContext("write", {
      signal: controller.signal,
      output: { write, close: immediate, abort }
    });
    const pending = context.emit(Uint8Array.of(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "E_CANCELLED" });
    await context.close();
    await expect(context.emit(Uint8Array.of(2))).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("observes cancellation before, during CPU work, and after awaited output", async () => {
    const before = new AbortController();
    before.abort();
    expect(() => createExecutionContext("read", { signal: before.signal })).toThrowError(
      /cancelled/
    );
    const during = new AbortController();
    const context = createExecutionContext("read", {
      signal: during.signal,
      yield: async () => {
        during.abort();
      }
    });
    await expect(context.cooperate(256)).rejects.toMatchObject({ code: "E_CANCELLED" });
    const after = new AbortController();
    const writer = createExecutionContext("write", {
      signal: after.signal,
      yield: immediate,
      output: {
        publish: async () => {
          after.abort();
        }
      }
    });
    await expect(writer.emit(Uint8Array.of(1))).rejects.toMatchObject({ code: "E_CANCELLED" });
  });
  it("cancels a pending producer without acquiring again", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const next = vi.fn(() => {
      started();
      return new Promise<IteratorResult<Uint8Array>>(() => {});
    });
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    const context = createExecutionContext("read", { signal: controller.signal, yield: immediate });
    const pending = context.acquire({ [Symbol.asyncIterator]: () => ({ next, return: returned }) });
    await ready;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "E_CANCELLED" });
    await context.close();
    expect(next).toHaveBeenCalledTimes(1);
    expect(returned).toHaveBeenCalledTimes(1);
  });
  it("requires deterministic pagination progress and bounds its index", () => {
    const context = createExecutionContext("write", { limits: { references: 1 } });
    context.progress("pagination", 0);
    context.progress("pagination", 1);
    expect(() => context.progress("pagination", 1)).toThrowError(/progress/);
    const bounded = createExecutionContext("write", { limits: { references: 1 } });
    bounded.progress("first", 0);
    expect(() => bounded.progress("second", 0)).toThrowError(/references/);
  });
});
