import { expect, test } from "vitest";
import { LazyInput } from "./index.js";
import { utf8Codec } from "../codecs/utf8.js";
import { defaultSniffStreamProfile } from "../csv/sniffer-profile.js";

test("permissive stdin sniffing never sanitizes invalid bytes for the strict reader", async () => {
  let closed = 0;
  const input = new LazyInput("stdin", () => (async function* () {
    try { yield Uint8Array.from([97, 59, 98, 10, 120, 59, 0xff, 121, 10]); }
    finally { closed++; }
  })(), utf8Codec, "utf-8", new AbortController().signal, () => {}, () => {}, true);
  expect(await input.sniffSample(100, 100)).toBe("a;b\nx;y\n");
  await expect(input.read()).rejects.toThrow("utf-8 decoding failed");
  await input.close();
  expect(closed).toBe(1);
});

test("named sampling counts a supplementary character split by an injected decoder once", async () => {
  const input = new LazyInput("file", () => (async function* () {})(), {
    ...utf8Codec,
    async *decodeStream() { yield "\ud83d"; yield "\ude00;"; yield "b\r"; yield "\n1;2\n"; }
  }, "utf-8", new AbortController().signal, () => {}, () => {});
  expect(await input.sniffSample(3, 3)).toBe("😀;b");
  expect(await input.read()).toBe("😀;b\n1;2\n");
  await input.close();
});

test("a mutable borrowed producer cannot overwrite the replayed sniff prefix", async () => {
  const buffer = new Uint8Array(4);
  const input = new LazyInput("stdin", () => (async function* () {
    buffer.set(new TextEncoder().encode("a;b\n")); yield buffer;
    buffer.set(new TextEncoder().encode("x;y\n")); yield buffer;
  })(), utf8Codec, "utf-8", new AbortController().signal, () => {}, () => {}, true);
  expect(await input.sniffSample(8, 8, { ...defaultSniffStreamProfile, peekBytes: 8 })).toBe("a;b\nx;y\n");
  expect(await input.read()).toBe("a;b\nx;y\n");
  await input.close();
});

test("full and positive samples admit exactly the character bound and reject one beyond", async () => {
  for (const borrowed of [false, true]) {
    for (const limit of [-1, 4, 5]) {
      const input = new LazyInput("sample", () => (async function* () {
        yield new TextEncoder().encode("😀;b\n");
      })(), utf8Codec, "utf-8", new AbortController().signal, () => {}, () => {}, borrowed);
      expect(await input.sniffSample(limit, 4)).toBe("😀;b\n");
      await expect(input.sniffSample(limit, 3)).rejects.toThrow("sniff sample character budget exceeded");
      await input.close();
    }
  }
});
