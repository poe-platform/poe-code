import { expect, it } from "vitest";
import { FontProgramStore } from "./stored-program.js";
import { readCffDictionary, readCffIndex } from "./stored-cff-records.js";

function source(bytes: Uint8Array) {
  const storage = {
    allocate() {
      throw Error("read only");
    },
    async read(at: number, n: number) {
      expect(n).toBeLessThanOrEqual(4096);
      return bytes.slice(at, at + n);
    },
    async write() {
      throw Error("read only");
    }
  };
  return new FontProgramStore({ storage, position: 0, byteLength: bytes.length }).range();
}
function real(text: string): Uint8Array {
  const nibble = (char: string) =>
    char === "."
      ? 10
      : char === "E" || char === "e"
        ? 11
        : char === "-"
          ? 14
          : char.charCodeAt(0) - 48;
  const values = [...text].map(nibble);
  values.push(15);
  if (values.length % 2) values.push(15);
  const bytes = new Uint8Array(values.length / 2 + 2);
  bytes[0] = 30;
  for (let i = 0; i < values.length; i += 2) bytes[1 + i / 2] = values[i]! * 16 + values[i + 1]!;
  bytes[bytes.length - 1] = 20;
  return bytes;
}

it.each([
  "-0",
  ".125",
  "1.7976931348623157E308",
  "2.4703282292062327E-324",
  "1E",
  "1E-",
  "--1",
  "1.2.3",
  "0." + "0".repeat(10000) + "1E10001",
  "1" + "0".repeat(10000) + "E-10000",
  "1." + "23456789".repeat(150)
])("parses bounded CFF real operands exactly: %s", async (text) => {
  const result = await readCffDictionary(source(real(text)), new Set([20]));
  const expected = parseFloat(text);
  if (Number.isNaN(expected)) expect(result.has(20)).toBe(false);
  else expect(Object.is(result.get(20)!.values[0], expected)).toBe(true);
});

it("retains only useful dictionary operands and preserves native override rules", async () => {
  const bytes = new Uint8Array(10020);
  bytes.fill(139);
  bytes.set([140, 17, 139, 140, 15], 0);
  bytes.set([17, 30, 255, 17], 10016);
  const result = await readCffDictionary(source(bytes), new Set([15, 17]));
  expect(result.get(15)).toEqual({ count: 2, values: [0, 1] });
  expect(result.get(17)!.count).toBe(10011);
  expect(result.get(17)!.values).toHaveLength(6);
});

it("reads CFF INDEX offsets on demand without collecting entries", async () => {
  const bytes = Uint8Array.of(0, 3, 1, 1, 3, 4, 7, 10, 11, 12, 13, 14, 15, 99);
  const index = await readCffIndex(source(bytes), 0);
  expect(index.count).toBe(3);
  expect(index.end).toBe(13);
  const a = await index.get(0),
    b = await index.get(2);
  expect(a!.length).toBe(2);
  expect(await a!.byte(1)).toBe(11);
  expect(b!.length).toBe(3);
  expect(await b!.byte(2)).toBe(15);
  expect(await index.get(3)).toBeUndefined();
});

it("preserves rounding across exact binary64 halfway values and discarded tails", async () => {
  const halfway = (5n ** 1075n).toString();
  const exact = "0." + "0".repeat(1075 - halfway.length) + halfway;
  for (const text of [
    exact,
    exact + "0".repeat(900) + "1",
    "1." + "0".repeat(799) + "1",
    "-" + exact,
    "-" + exact + "0".repeat(900) + "1"
  ]) {
    const parsed = await readCffDictionary(source(real(text)), new Set([20]));
    expect(Object.is(parsed.get(20)!.values[0], parseFloat(text))).toBe(true);
  }
});

it("matches native dictionary numbers and prefix recovery", async () => {
  const { CFFParser, Stream } = await import("../vendor/pdfjs-fonts.mjs");
  const parser = new CFFParser(new Stream(new Uint8Array()), {}, false) as unknown as {
    parseDict(bytes: Uint8Array): Array<[number, number[]]>;
  };
  let seed = 31;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 128; i++) {
    const chars = "0123456789.E-";
    let text = "";
    for (let j = 0, length = next() % 1000; j < length; j++) text += chars[next() % chars.length];
    const bytes = real(text),
      expected = parser.parseDict(bytes)[0]![1][0]!;
    const actual = await readCffDictionary(source(bytes), new Set([20]));
    if (Number.isNaN(expected)) expect(actual.has(20)).toBe(false);
    else expect(Object.is(actual.get(20)!.values[0], expected)).toBe(true);
  }
});

it("preserves native dictionary reads extending beyond a short operand view", async () => {
  const bytes = Uint8Array.of(28, 0, 123, 20);
  const range = source(bytes).subarray(0, 1);
  // PDF.js constructs the parser DataView through the containing program.
  const { CFFParser, Stream } = await import("../vendor/pdfjs-fonts.mjs");
  const parser = new CFFParser(new Stream(bytes), {}, false) as unknown as {
    parseDict(bytes: Uint8Array): unknown;
  };
  expect(parser.parseDict(bytes.subarray(0, 1))).toEqual([]);
  await expect(readCffDictionary(range, new Set([20]))).resolves.toEqual(new Map());
});
