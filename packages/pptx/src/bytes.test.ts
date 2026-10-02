import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { readBinary, writeBinary } from "./bytes.js";
import { OfficeError, type ByteSource } from "./index.js";

const context = { limits: { maxBytes: 8, maxReads: 8, chunkBytes: 3 } };

describe("byte admission", () => {
  it("snapshots caller bytes before yielding", async () => {
    const original = Uint8Array.of(0, 255, 17);
    const pending = readBinary(original, context);
    original.fill(42);
    expect(await pending).toEqual(Uint8Array.of(0, 255, 17));
  });

  it("retains empty chunks and snapshots reused producer buffers", async () => {
    const buffer = Uint8Array.of(2, 4);
    const source: ByteSource = (async function* () {
      yield buffer;
      buffer.fill(7);
      yield new Uint8Array();
      yield buffer;
    })();
    expect(await readBinary(source, context)).toEqual(Uint8Array.of(2, 4, 7, 7));
  });

  it.each([0, -1, 1.5, NaN])("rejects invalid limits before reading: %s", async (maxBytes) => {
    const next = vi.fn();
    await expect(
      readBinary(
        { [Symbol.asyncIterator]: () => ({ next }) },
        { limits: { ...context.limits, maxBytes } }
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows explicit limits above or below earlier settings", async () => {
    await expect(readBinary(new Uint8Array(9), context, { maxBytes: 9 })).resolves.toHaveLength(9);
    await expect(readBinary(Uint8Array.of(1, 2), context, { maxBytes: 1 })).rejects.toMatchObject({
      code: "resource-limit"
    });
  });

  it("rejects null and unknown options before opening a filesystem", async () => {
    const readFile = vi.fn();
    for (const options of [{ maxBytes: null }, { extra: 1 }]) {
      await expect(
        readBinary({ path: "seed", fs: { readFile } }, context, options as never)
      ).rejects.toMatchObject({ code: "invalid-value" });
    }
    expect(readFile).not.toHaveBeenCalled();
  });

  it("bounds empty reads and closes the iterator on exhaustion", async () => {
    const next = vi.fn(async () => ({ done: false as const, value: new Uint8Array() }));
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    await expect(
      readBinary({ [Symbol.asyncIterator]: () => ({ next, return: close }) }, context)
    ).rejects.toMatchObject({ code: "resource-limit" });
    expect(next).toHaveBeenCalledTimes(8);
    expect(close).toHaveBeenCalledOnce();
  });

  it("accepts exact ceilings and refuses overflow before copying, even if cleanup fails", async () => {
    expect(
      await readBinary(
        (async function* () {
          yield Uint8Array.of(1, 2, 3);
        })(),
        context,
        { maxBytes: 3 }
      )
    ).toEqual(Uint8Array.of(1, 2, 3));
    let closed = false;
    const chunks = [Uint8Array.of(1, 2, 3), Uint8Array.of(4)];
    const source: ByteSource = {
      [Symbol.asyncIterator]() {
        return {
          async next() { return { done: false, value: chunks.shift()! }; },
          async return(): Promise<IteratorResult<Uint8Array>> {
            closed = true;
            throw new Error("private cleanup detail");
          }
        };
      }
    };
    await expect(readBinary(source, context, { maxBytes: 3 })).rejects.toMatchObject({
      code: "resource-limit"
    });
    expect(closed).toBe(true);
  });

  it("rejects ambient paths and malformed source values asynchronously", async () => {
    for (const input of [
      "/private/deck",
      null,
      {},
      (async function* () {
        yield "abc";
      })()
    ]) {
      await expect(readBinary(input as never, context)).rejects.toBeInstanceOf(OfficeError);
    }
  });

  it("observes cancellation before and after cooperative reads and awaits cleanup", async () => {
    const controller = new AbortController();
    const next = vi.fn(async () => {
      controller.abort("private reason");
      return { done: false as const, value: Uint8Array.of(1) };
    });
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const source = { [Symbol.asyncIterator]: () => ({ next, return: close }) };
    await expect(
      readBinary(source, { ...context, signal: controller.signal })
    ).rejects.toMatchObject({ code: "cancelled", message: "Operation cancelled." });
    expect(close).toHaveBeenCalledOnce();
    next.mockClear();
    await expect(
      readBinary(source, { ...context, signal: controller.signal })
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(next).not.toHaveBeenCalled();
  });

  it("does not leak stream failures into public diagnostics", async () => {
    const next = async (): Promise<IteratorResult<Uint8Array>> => {
      throw new Error("secret path");
    };
    await expect(
      readBinary({ [Symbol.asyncIterator]: () => ({ next }) }, context)
    ).rejects.toMatchObject({ code: "io-failure", message: "Byte input failed." });
  });
});

describe("byte output", () => {
  it.each([
    { empty: true, rejects: false },
    { empty: false, rejects: false },
    { empty: true, rejects: true },
    { empty: false, rejects: true }
  ])("reports cancellation while close is pending: %j", async ({ empty, rejects }) => {
    const controller = new AbortController();
    const volume = Volume.fromJSON({ "/source": "seed", "/destination": "retained" });
    const input = new Uint8Array(volume.readFileSync("/source") as Uint8Array);
    const delivered: number[] = [];
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let complete!: () => void;
    let fail!: (reason: Error) => void;
    const completion = new Promise<void>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    const close = vi.fn(async () => {
      enter();
      await completion;
    });
    const pending = writeBinary(
      empty ? new Uint8Array() : input,
      {
        async write(bytes) {
          delivered.push(...bytes);
        },
        close
      },
      { ...context, signal: controller.signal },
      { close: true }
    );
    const outcome = expect(pending).rejects.toMatchObject({
      code: "cancelled",
      message: "Operation cancelled.",
      phase: "publish"
    });
    await entered;
    controller.abort("private transport detail");
    if (rejects) fail(new Error("private close failure"));
    else complete();
    await outcome;
    expect(close).toHaveBeenCalledOnce();
    expect(delivered).toEqual(empty ? [] : [115, 101, 101, 100]);
    expect(Array.from(input)).toEqual([115, 101, 101, 100]);
    expect(volume.toJSON()).toEqual({ "/source": "seed", "/destination": "retained" });
  });

  it("preserves input and files when stdout fails after a delivered prefix", async () => {
    const volume = Volume.fromJSON({ "/source": "seed", "/destination": "retained" });
    const input = new Uint8Array(volume.readFileSync("/source") as Uint8Array);
    const delivered: number[] = [];
    const close = vi.fn();
    const write = vi.fn(async (bytes: Uint8Array) => {
      if (delivered.length) throw new Error("private transport detail");
      delivered.push(...bytes);
      bytes.fill(0);
    });
    await expect(
      writeBinary(input, { write, close }, context, { close: true })
    ).rejects.toMatchObject({ code: "io-failure", message: "Byte output failed." });
    expect(delivered).toEqual([115, 101, 101]);
    expect(write).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();
    expect(Array.from(input)).toEqual([115, 101, 101, 100]);
    expect(volume.toJSON()).toEqual({ "/source": "seed", "/destination": "retained" });
  });

  it("rejects read-only options before writing", async () => {
    const write = vi.fn();
    await expect(
      writeBinary(Uint8Array.of(1), { write, close: vi.fn() }, context, { maxReads: 2 } as never)
    ).rejects.toMatchObject({ code: "invalid-value" });
    expect(write).not.toHaveBeenCalled();
  });
  it("isolates retained sink chunks and observes cancellation between writes", async () => {
    const controller = new AbortController();
    const chunks: Uint8Array[] = [];
    const close = vi.fn();
    await expect(
      writeBinary(
        Uint8Array.of(1, 2, 3, 4),
        {
          async write(chunk, signal) {
            expect(signal).toBe(controller.signal);
            chunks.push(chunk);
            controller.abort();
          },
          close
        },
        { ...context, signal: controller.signal },
        { close: true }
      )
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(chunks).toEqual([Uint8Array.of(1, 2, 3)]);
    expect(close).not.toHaveBeenCalled();

    let retained: Uint8Array | undefined;
    await writeBinary(
      Uint8Array.of(1, 2, 3, 4),
      {
        async write(chunk) {
          if (retained) {
            retained.fill(9);
            expect(chunk).toEqual(Uint8Array.of(4));
          }
          retained = chunk;
        },
        close
      },
      context
    );
    expect(close).not.toHaveBeenCalled();
  });

  it("reports completion failures without exposing host details", async () => {
    await expect(
      writeBinary(
        new Uint8Array(),
        {
          async write() {},
          async close() {
            throw new Error("private endpoint");
          }
        },
        context,
        { close: true }
      )
    ).rejects.toMatchObject({ code: "io-failure", message: "Byte output failed." });
  });
  it("awaits writes, snapshots input, and closes only on explicit request", async () => {
    const volume = Volume.fromJSON({ "/result": "" });
    const input = Uint8Array.of(1, 2, 3, 4);
    const events: string[] = [];
    const sink = {
      async write(bytes: Uint8Array) {
        events.push("start");
        input.fill(9);
        await Promise.resolve();
        volume.appendFileSync("/result", bytes);
        events.push("end");
      },
      async close() {
        events.push("close");
      }
    };
    await writeBinary(input, sink, context, { close: true });
    expect(new Uint8Array(volume.readFileSync("/result") as Uint8Array)).toEqual(
      Uint8Array.of(1, 2, 3, 4)
    );
    expect(events).toEqual(["start", "end", "start", "end", "close"]);
    events.length = 0;
    await writeBinary(new Uint8Array(), sink, context);
    expect(events).toEqual([]);
  });

  it("refuses over-budget output before writes and leaves the sink open on failure", async () => {
    const write = vi.fn(async () => {
      throw new Error("private destination");
    });
    const close = vi.fn();
    await expect(writeBinary(new Uint8Array(9), { write, close }, context)).rejects.toMatchObject({
      code: "resource-limit"
    });
    expect(write).not.toHaveBeenCalled();
    await expect(
      writeBinary(Uint8Array.of(1), { write, close }, context, { close: true })
    ).rejects.toMatchObject({ code: "io-failure", message: "Byte output failed." });
    expect(close).not.toHaveBeenCalled();
  });
});

it("captures completion intent before host callbacks run", async () => {
  const options = { close: false };
  const close = vi.fn();
  await writeBinary(
    Uint8Array.of(1),
    {
      async write() {
        options.close = true;
      },
      close
    },
    context,
    options
  );
  expect(close).not.toHaveBeenCalled();
});

it("writes to sinks without close even when closing is requested", async () => {
  const write = vi.fn(async (_bytes: Uint8Array) => {});
  await writeBinary(Uint8Array.of(1, 2), { write }, context, { close: true });
  expect(write).toHaveBeenCalledWith(Uint8Array.of(1, 2), undefined);
  await expect(
    writeBinary(Uint8Array.of(1), { write, close: false } as never, context)
  ).rejects.toMatchObject({ code: "invalid-type" });
});
