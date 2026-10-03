import { expect, test, vi } from "vitest";
import { LazyInput } from "./index.js";
import { pythonCodecs } from "../codecs/python.js";

test("text opening never converts an opaque bulk codec into a payload-wide buffer", async () => {
  const decode = vi.fn(async () => "x\n");
  let reads = 0;
  const file = new LazyInput("input", () => ({ async *[Symbol.asyncIterator]() { reads++; yield new Uint8Array(8); } }),
    { names: ["opaque"], decode, encode: async () => new Uint8Array() }, "opaque", new AbortController().signal, () => {}, () => {});
  await expect(file.nextLine()).rejects.toThrow("streaming decoder");
  expect(reads).toBe(0);
  expect(decode).not.toHaveBeenCalled();
  await file.close();
});

test("all built-in admitted encodings supply incremental decoders", async () => {
  for (const codec of pythonCodecs) {
    expect(codec.decodeStream).toBeTypeOf("function");
    for (const encoding of codec.names) {
      const bytes = await codec.encode("name\nvalue\n", encoding, new AbortController().signal);
      let returned = 0;
      const source = { async *[Symbol.asyncIterator]() {
        const reused = new Uint8Array(1);
        try { for (const byte of bytes) { reused[0] = byte; yield reused; } } finally { returned++; }
      } };
      let text = "";
      for await (const chunk of codec.decodeStream!(source, encoding, new AbortController().signal)) text += chunk;
      expect(text).toBe("name\nvalue\n");
      expect(returned).toBe(1);
    }
  }
});
