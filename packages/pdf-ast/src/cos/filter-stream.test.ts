import { describe, expect, it, vi } from "vitest";
import { cosArray, cosDict, cosName, cosNumber } from "../ast.js";
import { decodeStreamObject, encodeFlate, encodeAsciiHex, encodeAscii85, encodeRunLength, encodeLzw } from "./filters.js";
import { decodePdfStreamChunks } from "./filter-stream.js";

async function* pieces(bytes: Uint8Array) { for (let i = 0; i < bytes.length; i += 3) yield bytes.subarray(i, i + 3); }
async function collect(input: AsyncIterable<Uint8Array>) {
  const result: number[] = [];
  for await (const chunk of input) { expect(chunk.buffer.byteLength).toBeLessThanOrEqual(7); result.push(...chunk); }
  return Uint8Array.from(result);
}

describe("streaming PDF filter pipelines", () => {
  it.each(["DCTDecode", "DCT", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode", "CCF"])("preserves native %s bytes after transport decoding", async codec => {
    const plain = new Uint8Array([255, 216, 17, 23, 255, 217]);
    const raw = encodeAsciiHex(plain);
    const dict = cosDict({ Filter: cosArray([cosName("ASCIIHexDecode"), cosName(codec), cosName("Unsupported")]) });
    expect(await collect(decodePdfStreamChunks(dict, pieces(raw), { chunkBytes: 7, stopBeforeImageCodec: true }))).toEqual(plain);
    await expect(collect(decodePdfStreamChunks(dict, pieces(raw), { chunkBytes: 7 }))).rejects.toThrow();
    await expect(collect(decodePdfStreamChunks(dict, pieces(raw), { chunkBytes: 7, maxDecodedBytes: 5, stopBeforeImageCodec: true }))).rejects.toMatchObject({ code: "E_LIMIT" });
  });
  it("decodes chained Flate filters and PNG rows from DecodeParms", async () => {
    const raw = encodeFlate(encodeFlate(new Uint8Array([2, 100, 3, 2, 1, 255, 2, 1, 255])));
    const dict = cosDict({ Filter: cosArray([cosName("FlateDecode"), cosName("Fl")]), DecodeParms: cosArray([
      cosDict({}), cosDict({ Predictor: cosNumber(12), Columns: cosNumber(2) }),
    ]) });
    const expected = decodeStreamObject({ kind: "stream", dict, rawBytes: raw });
    expect(await collect(decodePdfStreamChunks(dict, pieces(raw), { chunkBytes: 7 }))).toEqual(expected);
  });
  it("owns unfiltered output chunks and enforces the same byte budget", async () => {
    const bytes = new Uint8Array(30).fill(7);
    expect(await collect(decodePdfStreamChunks(cosDict({}), pieces(bytes), { chunkBytes: 7 }))).toEqual(bytes);
    await expect(collect(decodePdfStreamChunks(cosDict({}), pieces(bytes), { chunkBytes: 7, maxDecodedBytes: 29 }))).rejects.toMatchObject({ code: "E_LIMIT" });
  });
  it.each([
    ["ASCIIHexDecode", encodeAsciiHex], ["ASCII85Decode", encodeAscii85],
    ["RunLengthDecode", encodeRunLength], ["LZWDecode", encodeLzw],
  ] as const)("streams %s across arbitrary chunk boundaries", async (name, encode) => {
    const bytes = Uint8Array.from({ length: 2000 }, (_, i) => (i * i + i * 47) & 255);
    const raw = encode(bytes);
    const dict = cosDict({ Filter: cosName(name) });
    expect(await collect(decodePdfStreamChunks(dict, pieces(raw), { chunkBytes: 7 }))).toEqual(decodeStreamObject({ kind: "stream", dict, rawBytes: raw }));
    await expect(collect(decodePdfStreamChunks(dict, pieces(raw), { chunkBytes: 7, maxDecodedBytes: 19 }))).rejects.toMatchObject({ code: "E_LIMIT" });
  });

  it.each([
    ["ASCIIHexDecode", [65, 32, 62]], ["ASCII85Decode", [122, 33, 33, 126]],
    ["RunLengthDecode", [254]], ["RunLengthDecode", [3, 7, 9]],
  ] as const)("retains short-stream recovery for %s %j", async (name, values) => {
    const raw = Uint8Array.from(values);
    const dict = cosDict({ Filter: cosName(name) });
    expect(await collect(decodePdfStreamChunks(dict, pieces(raw), { chunkBytes: 7 }))).toEqual(decodeStreamObject({ kind: "stream", dict, rawBytes: raw }));
  });

  it("keeps LZW dictionary resets and KwKwK expansion across byte boundaries", async () => {
    let seed = 17;
    const bytes = Uint8Array.from({ length: 7000 }, (_, i) => {
      seed = Math.imul(seed, 1664525) + 1013904223 | 0;
      return i < 1000 ? 65 : seed >>> 24;
    });
    const encoded = encodeLzw(bytes);
    const dict = cosDict({ Filter: cosName("LZW") });
    expect(await collect(decodePdfStreamChunks(dict, pieces(encoded), { chunkBytes: 7 }))).toEqual(bytes);
  });

  it.each([false, true])("replays the preceding filter stages for CCITT fallback (%s)", async fallback => {
    const raw = fallback ? new Uint8Array([0, 0, 17, 23]) : new Uint8Array([255]);
    const encoded = encodeFlate(raw);
    const dict = cosDict({ Filter: cosArray([cosName("FlateDecode"), cosName("CCF")]), DecodeParms: cosArray([
      cosDict({}), cosDict({ Columns: cosNumber(8), K: cosNumber(fallback ? 0 : -1) }),
    ]) });
    const open = vi.fn(() => pieces(encoded));
    expect(await collect(decodePdfStreamChunks(dict, open, { chunkBytes: 7 }))).toEqual(fallback ? raw : new Uint8Array(8).fill(255));
    expect(open).toHaveBeenCalledTimes(fallback ? 2 : 1);
  });

  it("rejects non-replayable CCITT input before pulling or buffering it", async () => {
    const pull = vi.fn();
    async function* input() { pull(); yield new Uint8Array([0]); }
    const dict = cosDict({ Filter: cosName("CCF") });
    await expect(collect(decodePdfStreamChunks(dict, input(), { chunkBytes: 7 }))).rejects.toThrow("replayable");
    expect(pull).not.toHaveBeenCalled();
  });

});
it("streams raw recovery bytes with ownership and admission before unsupported filters", async () => {
  const raw = new Uint8Array(41).fill(17); const dict = cosDict({ Filter: cosName("Unsupported") });
  expect(await collect(decodePdfStreamChunks(dict, pieces(raw), { raw: true, chunkBytes: 7 }))).toEqual(raw);
  await expect(collect(decodePdfStreamChunks(dict, pieces(raw), { raw: true, chunkBytes: 7, maxDecodedBytes: 40 }))).rejects.toMatchObject({ code: "E_LIMIT" });
});
