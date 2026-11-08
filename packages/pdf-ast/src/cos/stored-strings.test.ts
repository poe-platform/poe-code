import { expect, it } from "vitest";
import { CosByteLexer, CosRangeLexer } from "./lexer.js";

it.each(["literal", "hex", "recovery"])(
  "decodes a growing %s token into caller backing with fixed scratch",
  async (mode) => {
    const text =
      mode === "hex"
        ? "<" + "41 4a 0 ".repeat(2048) + "f>"
        : mode === "recovery"
          ? "((" + "a\\101\\\r\nb\r\n".repeat(2048) + ")\n/Next 123 >>"
          : "(" + "a\\101\\\r\nb\r\n".repeat(2048) + ")";
    const input = new TextEncoder().encode(text),
      native = new CosByteLexer(input).nextToken()!;
    const data = new Uint8Array(input.length + 32);
    let end = 17,
      admitted = 0,
      largest = 0;
    const storage = {
      allocate(n: number) {
        const at = end;
        end += n;
        return at;
      },
      async read(at: number, n: number) {
        return data.subarray(at, at + n);
      },
      async write(at: number, bytes: Uint8Array) {
        largest = Math.max(largest, bytes.length);
        data.set(bytes, at);
      }
    };
    const lexer = new CosRangeLexer(
      {
        size: input.length,
        chunkBytes: 128,
        async read(at, n) {
          expect(n).toBeLessThanOrEqual(128);
          return input.subarray(at, at + n);
        }
      },
      {
        stringStorage: storage,
        maxTokenBytes: Infinity,
        onTokenAllocation(n) {
          admitted += n;
          if (admitted > 32768) throw Error("whole string scratch");
        }
      }
    );
    const actual = await lexer.nextToken();
    expect(actual?.kind).toBe(native.kind);
    expect(actual?.span).toEqual(native.span);
    if (!actual || !("bytes" in actual) || !("bytes" in native))
      throw Error("Expected string tokens");
    expect(actual.bytes).toHaveLength(0);
    expect(actual.storedBytes).toBeDefined();
    const backed = actual.storedBytes!;
    expect(data.subarray(backed.position, backed.position + backed.byteLength)).toEqual(
      native.bytes
    );
    expect(backed.storage).toBe(storage);
    expect(largest).toBeLessThanOrEqual(4096);
    expect(admitted).toBeLessThanOrEqual(32768);
    expect(lexer.offset).toBe(native.span.end);
  }
);

it("keeps token ownership through the measuring/replay boundary", async () => {
  const input = new TextEncoder().encode("(first) (second)");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let allocationMutationRejected = false;
  const storage = {
    allocate() {
      try {
        lexer.offset = 0;
      } catch {
        allocationMutationRejected = true;
      }
      return 0;
    },
    async read() {
      return new Uint8Array();
    },
    async write() {
      entered();
      await waiting;
    }
  };
  const lexer = new CosRangeLexer(
    {
      size: input.length,
      chunkBytes: 128,
      async read(at, n) {
        return input.subarray(at, at + n);
      }
    },
    { stringStorage: storage }
  );
  const first = lexer.nextToken();
  // This continuation runs between the measuring and replay passes.
  const second = lexer.nextToken();
  await expect(second).rejects.toThrow("operation is pending");
  await writing;
  expect(() => {
    lexer.offset = 0;
  }).toThrow("operation is pending");
  await expect(lexer.skipWhitespaceAndComments()).rejects.toThrow("operation is pending");
  release();
  await first;
  expect(allocationMutationRejected).toBe(true);
});

it.each(["abort", "failure"])("preserves final backing-write %s", async (mode) => {
  const input = new TextEncoder().encode("(payload)");
  const controller = new AbortController(),
    failure = new Error("backing unavailable");
  const storage = {
    allocate() {
      return 0;
    },
    async read() {
      return new Uint8Array();
    },
    async write() {
      if (mode === "abort") controller.abort(failure);
      else throw failure;
    }
  };
  const lexer = new CosRangeLexer(
    {
      size: input.length,
      chunkBytes: 128,
      async read(at, n) {
        return input.subarray(at, at + n);
      }
    },
    { stringStorage: storage, signal: controller.signal }
  );
  await expect(lexer.nextToken()).rejects.toBe(failure);
});
