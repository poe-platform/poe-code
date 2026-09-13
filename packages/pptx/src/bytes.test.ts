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

  it("snapshots reused producer buffers and treats only null as EOF", async () => {
    const buffer = Uint8Array.of(2, 4);
    let step = 0;
    const source: ByteSource = {
      async read(maxBytes) {
        expect(maxBytes).toBeGreaterThan(0);
        step++;
        if (step === 1) return buffer;
        buffer.fill(7);
        if (step === 2) return new Uint8Array();
        if (step === 3) return buffer;
        return null;
      }
    };
    expect(await readBinary(source, context)).toEqual(Uint8Array.of(2, 4, 7, 7));
  });

  it("reads only through an explicit rooted capability", async () => {
    const volume = Volume.fromJSON({ "/vault/seed": "abc" });
    const openRead = vi.fn(async (path: string) => {
      const bytes = new Uint8Array(volume.readFileSync(`/vault/${path}`) as Uint8Array);
      let offset = 0;
      return {
        async read(maxBytes: number) {
          if (offset === bytes.length) return null;
          const chunk = bytes.subarray(offset, offset + maxBytes);
          offset += chunk.length;
          return chunk;
        }
      };
    });
    expect(await readBinary({ path: "seed", capability: { openRead } }, context)).toEqual(
      Uint8Array.of(97, 98, 99)
    );
    expect(openRead).toHaveBeenCalledOnce();
  });

  it.each([0, -1, 1.5, Infinity, NaN])(
    "rejects invalid limits before reading: %s",
    async (maxBytes) => {
      const read = vi.fn();
      await expect(
        readBinary({ read }, { limits: { ...context.limits, maxBytes } })
      ).rejects.toMatchObject({ code: "invalid-value" });
      expect(read).not.toHaveBeenCalled();
    }
  );

  it("allows lowered limits but refuses increases before I/O", async () => {
    const read = vi.fn();
    await expect(readBinary({ read }, context, { maxBytes: 9 })).rejects.toMatchObject({
      code: "resource-limit"
    });
    expect(read).not.toHaveBeenCalled();
    await expect(readBinary(Uint8Array.of(1, 2), context, { maxBytes: 1 })).rejects.toMatchObject({
      code: "resource-limit"
    });
  });

  it("rejects null and unknown options before opening a capability", async () => {
    const openRead = vi.fn();
    for (const options of [{ maxBytes: null }, { extra: 1 }]) {
      await expect(
        readBinary({ path: "seed", capability: { openRead } }, context, options as never)
      ).rejects.toMatchObject({ code: "invalid-value" });
    }
    expect(openRead).not.toHaveBeenCalled();
  });

  it("bounds empty reads and rejects oversized chunks", async () => {
    const read = vi.fn(async () => new Uint8Array());
    await expect(readBinary({ read }, context)).rejects.toMatchObject({ code: "resource-limit" });
    expect(read).toHaveBeenCalledTimes(8);
    await expect(
      readBinary(
        {
          async read() {
            return new Uint8Array(4);
          }
        },
        context
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
  });

  it("accepts an exact byte ceiling but probes for overflow", async () => {
    let step = 0;
    const read = vi.fn(async (maxBytes: number) => {
      expect(maxBytes).toBe(step === 0 ? 3 : 1);
      return step++ === 0 ? Uint8Array.of(1, 2, 3) : null;
    });
    expect(await readBinary({ read }, context, { maxBytes: 3 })).toEqual(Uint8Array.of(1, 2, 3));
    await expect(
      readBinary(
        {
          async read() {
            return Uint8Array.of(1);
          }
        },
        context,
        { maxBytes: 3 }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
  });

  it("rejects ambient paths and malformed source values asynchronously", async () => {
    for (const input of [
      "/private/deck",
      null,
      {},
      {
        async read() {
          return "abc";
        }
      }
    ]) {
      await expect(readBinary(input as never, context)).rejects.toBeInstanceOf(OfficeError);
    }
  });

  it("observes cancellation before and after cooperative reads", async () => {
    const controller = new AbortController();
    const read = vi.fn(async (_maxBytes, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort("private reason");
      return Uint8Array.of(1);
    });
    await expect(
      readBinary({ read }, { ...context, signal: controller.signal })
    ).rejects.toMatchObject({ code: "cancelled", message: "Operation cancelled." });
    read.mockClear();
    await expect(
      readBinary({ read }, { ...context, signal: controller.signal })
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(read).not.toHaveBeenCalled();
  });

  it("does not leak capability failures into public diagnostics", async () => {
    await expect(
      readBinary(
        {
          async read() {
            throw new Error("secret path");
          }
        },
        context
      )
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
