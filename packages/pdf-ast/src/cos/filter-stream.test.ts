import { describe, expect, it } from "vitest";
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

});
