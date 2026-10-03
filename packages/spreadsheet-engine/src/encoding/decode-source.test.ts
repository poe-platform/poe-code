import { expect, it, vi } from "vitest";
import type { RangeSource } from "../contracts.js";
import { decodeText } from "./decode.js";
import { decodeTextSource } from "./decode-source.js";

function source(bytes: Uint8Array, chunkSize = 3): RangeSource {
  const borrowed = new Uint8Array(chunkSize);
  return { size: bytes.length, async read(offset, maximum) {
    const length = Math.min(chunkSize, maximum, bytes.length - offset);
    borrowed.set(bytes.subarray(offset, offset + length));
    return borrowed.subarray(0, length);
  } };
}
async function collect(input: RangeSource, encoding?: string): Promise<string> {
  let text = "";
  for await (const chunk of decodeTextSource(input, new AbortController().signal, encoding)) text += chunk;
  return text;
}

it.each([
  [undefined, [0xef, 0xbb, 0xbf, 0x41, 0xf0, 0x9f, 0x98, 0x80]],
  [undefined, [0xc3, 0xa9, 0xff]],
  ["utf-8", [0x61, 0xe2, 0x82]],
  ["utf-16", [0xfe, 0xff, 0, 0x41, 0xd8, 0x3d, 0xde, 0, 0]],
  ["utf-16le", [0xff, 0xfe, 0x41, 0, 0x3d, 0xd8, 0, 0xde]],
  ["ucs-2le", [0xff, 0xfe, 0x41, 0, 0x3d, 0xd8, 0, 0xde]],
  ["utf-32", [0, 0, 0xfe, 0xff, 0, 0, 0, 0x41, 0, 1, 0xf6, 0, 0]],
  ["utf-32le", [0xff, 0xfe, 0, 0, 0x41, 0, 0, 0, 0, 0xf6, 1, 0]],
  ["ucs-4", [0, 0, 0, 0x41, 0, 0, 0xd8, 0]],
  ["cp1252", [65, 0x80, 0x81]],
  ["ascii", [65, 0xc3, 0xa9]],
  ["latin1", [0, 65, 0x80, 0xff]],
  ["unknown-encoding", [65, 0xc3, 0xa9]]
] as const)("preserves native decoding guesses across short ranges: %s %j", async (encoding, values) => {
  const bytes = Uint8Array.from(values);
  for (const size of [1, 2, 3, 7]) expect(await collect(source(bytes, size), encoding)).toBe(decodeText(bytes, encoding));
});

it.each(["A+-B", "A+AOQ-B", "+2D3eAA-!", "+2D3eAA", "+2D0-", "+2D0", "+", "+!", "+A-", "+A", "+AB-", "+AB", "+AAAA-", "+AAAA", "+/v8-"])("keeps UTF-7 shift state for %s", async text => {
  const bytes = new TextEncoder().encode(text);
  for (const size of [1, 2, 3, 7]) expect(await collect(source(bytes, size), "utf-7")).toBe(decodeText(bytes, "utf-7"));
});

it("validates guesses before emitting text and stops range reads behind a slow consumer", async () => {
  const size = 1024 * 1024, borrowed = new Uint8Array(16384);
  let bytesRead = 0, largest = 0;
  const read = vi.fn(async (offset: number, maximum: number) => {
    largest = Math.max(largest, maximum);
    const count = Math.min(maximum, size - offset);
    borrowed.fill(65);
    if (offset + count === size) borrowed[count - 1] = 0xff;
    bytesRead += count;
    return borrowed.subarray(0, count);
  });
  const iterator = decodeTextSource({ size, read }, new AbortController().signal)[Symbol.asyncIterator]();
  const first = await iterator.next();
  expect(first.value).toBe("A".repeat(16384));
  expect(bytesRead).toBeGreaterThan(size);
  const calls = read.mock.calls.length;
  await Promise.resolve(); await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(calls);
  let length = first.value!.length, last = "";
  for await (const chunk of iterator) { expect(chunk.length).toBeLessThanOrEqual(16384); length += chunk.length; last = chunk; }
  expect(length).toBe(size); expect(last.endsWith("ÿ")).toBe(true);
  expect(largest).toBeLessThanOrEqual(16384);
});

it("propagates range failures and cancellation without treating them as charset guesses", async () => {
  const error = new TypeError("backend failed");
  await expect(collect({ size: 1, async read() { throw error; } })).rejects.toBe(error);
  const controller = new AbortController();
  const iterator = decodeTextSource({ size: 1, async read(_position, _maximum, options) {
    expect(options?.signal).toBe(controller.signal);
    controller.abort(error); return Uint8Array.of(65);
  } }, controller.signal)[Symbol.asyncIterator]();
  await expect(iterator.next()).rejects.toBe(error);
});

it("matches buffered decoding for malformed Unicode and captured single-byte tables", async () => {
  const { singleByteTables } = await import("./tables.js");
  for (const label of Object.keys(singleByteTables)) {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(await collect(source(bytes, 17), label), label).toBe(decodeText(bytes, label));
  }
  let seed = 91;
  for (const label of ["utf-8", "utf-16", "utf-16be", "utf-32", "utf-32be", "ucs-2", "ucs-4", "utf-7"])
    for (let sample = 0; sample < 40; sample++) {
      const bytes = Uint8Array.from({ length: sample }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed & 255; });
      expect(await collect(source(bytes, 3), label), `${label} ${sample}`).toBe(decodeText(bytes, label));
    }
});
