import { expect, it } from "vitest";
import { parsePdftkGeometryChunks } from "./info-geometry-stream.js";

it.each(["0 0 612 792", " 1\t 2 3 4 ", "\t 2", "1 2 3 NaN", "1 2 3 4 junk", "0xFF 0b11 0o17 -0", "+0x10 1", ".5 1. 1e2 -2E-3", "Infinity -Infinity +Infinity", "1e 2", ". 2", "- 2", "1\t2 3", "00001 02", "1e+2 1e-2", "0Xff 0B10 0O11", "0x 0b2 0o8"])("matches geometry conversion for %s", async input => {
  async function* chunks() { for (const character of input) yield character; }
  const values = input.trim().split(" ").filter(Boolean).map(Number);
  const result = await parsePdftkGeometryChunks(chunks(), new AbortController().signal);
  expect(result.values).toEqual(values.slice(0, 4)); expect(result.count).toBe(Math.min(5, values.length)); expect(result.finite).toBe(values.every(Number.isFinite));
});

it("rounds long decimal, exponent and radix spellings without full tokens", async () => {
  const samples = ["0." + "0".repeat(4096) + "1e4097", "1" + "0".repeat(4096) + "e-4096", "0x" + "0".repeat(8192) + "1fffffffffffff", "1e" + "0".repeat(8192) + "2", "0x" + "f".repeat(1024)];
  for (const sample of samples) {
    async function* chunks() { for (let i = 0; i < sample.length; i += 37) yield sample.slice(i, i + 37); }
    expect((await parsePdftkGeometryChunks(chunks(), new AbortController().signal)).values).toEqual([Number(sample)]);
  }
});

it("matches Number across generated grammar combinations", async () => {
  let state = 19;
  const alphabet = "0123456789.eExXbBoO+-InfinityNaN\t ";
  for (let sample = 0; sample < 1500; sample++) {
    let input = "";
    for (let i = 0; i < sample % 23; i++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; input += alphabet[state % alphabet.length]; }
    async function* chunks() { yield input; }
    const values = input.trim().split(" ").filter(Boolean).map(Number);
    expect(await parsePdftkGeometryChunks(chunks(), new AbortController().signal), input).toEqual({ values: values.slice(0, 4), count: Math.min(5, values.length), finite: values.every(Number.isFinite) });
  }
});

it("preserves cancellation and closes the producer", async () => {
  const controller = new AbortController(), reason = new Error("cancelled"); let closed = false;
  async function* chunks() { try { yield "0."; controller.abort(reason); yield "0"; } finally { closed = true; } }
  await expect(parsePdftkGeometryChunks(chunks(), controller.signal)).rejects.toBe(reason); expect(closed).toBe(true);
});
