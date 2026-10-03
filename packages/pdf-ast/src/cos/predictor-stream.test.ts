import { describe, expect, it, vi } from "vitest";
import { applyPredictor } from "./filters.js";
import { decodePredictorChunks } from "./predictor-stream.js";

async function* pieces(bytes: Uint8Array) {
  const scratch = new Uint8Array(3);
  for (let i = 0; i < bytes.length; i += 3) {
    const slice = bytes.subarray(i, i + 3); scratch.set(slice); yield scratch.subarray(0, slice.length);
  }
}
async function collect(input: AsyncIterable<Uint8Array>) {
  const result: number[] = [];
  for await (const chunk of input) { expect(chunk.buffer.byteLength).toBeLessThanOrEqual(5); result.push(...chunk); }
  return Uint8Array.from(result);
}

describe("streaming PDF predictors", () => {
  it.each([1, 2, 4, 8, 16])("matches packed and multicomponent TIFF rows at %i bits", async BitsPerComponent => {
    const parms = { Predictor: 2, Colors: 3, Columns: 7, BitsPerComponent };
    const size = Math.ceil(21 * BitsPerComponent / 8);
    const bytes = Uint8Array.from({ length: size * 4 + size - 1 }, (_, i) => i * 47 & 255);
    expect(await collect(decodePredictorChunks(pieces(bytes), parms, { chunkBytes: 5 }))).toEqual(applyPredictor(bytes, parms));
  });

  it.each([1, 2, 4, 8, 16])("matches all PNG predictors across %i-bit rows", async BitsPerComponent => {
    const parms = { Predictor: 15, Colors: 3, Columns: 7, BitsPerComponent };
    const size = Math.ceil(21 * BitsPerComponent / 8);
    const bytes = Uint8Array.from({ length: (size + 1) * 5 + 1 }, (_, i) => i * 47 & 255);
    for (let i = 0; i < 5; i++) bytes[i * (size + 1)] = i;
    expect(await collect(decodePredictorChunks(pieces(bytes), parms, { chunkBytes: 5 }))).toEqual(applyPredictor(bytes, parms));
  });

  it("admits intrinsic row storage before pulling input", async () => {
    const pull = vi.fn();
    async function* input() { pull(); yield new Uint8Array([0]); }
    await expect(collect(decodePredictorChunks(input(), { Predictor: 12, Columns: 1000000000 }, { maxRowBytes: 1024, chunkBytes: 5 }))).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(pull).not.toHaveBeenCalled();
  });

  it("closes input on early return and preserves owned output", async () => {
    let closed = false;
    async function* input() { try { yield new Uint8Array([0, 1, 2, 3, 4, 0, 7, 8, 9, 10]); } finally { closed = true; } }
    const iterator = decodePredictorChunks(input(), { Predictor: 12, Columns: 4 }, { chunkBytes: 2 });
    const first = await iterator.next();
    const saved = first.value!.slice();
    await iterator.next(); await iterator.next();
    expect(first.value).toEqual(saved);
    await iterator.return(undefined);
    expect(closed).toBe(true);
  });
});
