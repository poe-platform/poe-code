import { expect, it } from "vitest";
import { StringStream, Type1Parser } from "../vendor/pdfjs-fonts.mjs";
import { StoredFontBytes } from "./stored-font-bytes.js";
import { StoredType1Converter } from "./stored-type1-convert.js";

it.each([
  [
    139,
    248,
    136,
    13,
    139,
    140,
    12,
    16,
    ...Array.from({ length: 7 }, () => [140, 141, 21]).flat(),
    149,
    159,
    169,
    142,
    139,
    12,
    16,
    12,
    17,
    12,
    17,
    12,
    33,
    14
  ],
  [139, 248, 136, 13, 149, 139, 21, 140, 139, 5, 14],
  [139, 248, 136, 13, 139, 149, 159, 204, 247, 86, 12, 6],
  [139, 248, 136, 13, 139, 10, 14],
  [139, 248, 136, 13, 140, 10, 14],
  [139, 248, 136, 13, 159, 149, 12, 12, 22, 14]
])("converts Type1 operators with native bytes and metrics: %j", async (...code) => {
  const subr = [140, 139, 5, 11],
    text = String.fromCharCode;
  const plain = `/lenIV -1 def /Subrs 1 array dup 0 ${subr.length} RD ${text(...subr)} ND def /CharStrings 1 dict dup begin /A ${code.length} RD ${text(...code)} ND end`;
  const expected = new Type1Parser(new StringStream(plain), false, true).extractFontProgram({})
    .charstrings[0]!;
  const data = new Uint8Array(131072);
  let end = 0;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      expect(n).toBeLessThanOrEqual(4096);
      return data.slice(at, at + n);
    },
    async write(at: number, bytes: Uint8Array) {
      expect(bytes.length).toBeLessThanOrEqual(4096);
      data.set(bytes, at);
    }
  };
  const programs = new StoredFontBytes(storage),
    output = new StoredFontBytes(storage);
  await programs.push(...code, ...subr);
  const converter = new StoredType1Converter(programs, output, storage);
  const result = await converter.convert(0, code.length, {
    async get(index) {
      return index === 0 ? { start: code.length, length: subr.length } : undefined;
    }
  });
  const actual = [];
  for (let i = 0; i < result.code.length; i++) actual.push(await result.code.byte(i));
  expect(actual).toEqual(expected.charstring);
  expect(result.width).toBe(expected.width);
  expect(result.lsb).toBe((expected as unknown as { lsb: number }).lsb);
  expect(result.seac).toEqual((expected as unknown as { seac: unknown }).seac);
});

it("keeps deep Type1 subroutine return positions in caller storage", async () => {
  const data = new Uint8Array(2 * 1024 * 1024);
  let end = 0,
    reads = 0,
    writes = 0;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      expect(n).toBeLessThanOrEqual(4096);
      reads++;
      return data.slice(at, at + n);
    },
    async write(at: number, bytes: Uint8Array) {
      expect(bytes.length).toBeLessThanOrEqual(4096);
      writes++;
      data.set(bytes, at);
    }
  };
  const programs = new StoredFontBytes(storage),
    output = new StoredFontBytes(storage),
    count = 1024;
  await programs.push(139, 248, 136, 13, 139, 10, 14);
  for (let i = 0; i < count; i++) {
    const next = i + 1;
    await programs.push(
      ...(next === count
        ? [140, 139, 5, 11]
        : [255, next >>> 24, (next >>> 16) & 255, (next >>> 8) & 255, next & 255, 10, 11])
    );
  }
  const converter = new StoredType1Converter(programs, output, storage);
  const result = await converter.convert(0, 7, {
    async get(i) {
      return i >= 0 && i < count
        ? { start: 7 + i * 7, length: i === count - 1 ? 4 : 7 }
        : undefined;
    }
  });
  const actual = [];
  for (let i = 0; i < result.code.length; i++) actual.push(await result.code.byte(i));
  expect(actual).toEqual([28, 1, 244, 28, 0, 0, 22, 28, 0, 1, 28, 0, 0, 5, 14]);
  expect(result.width).toBe(500);
  expect(reads).toBeGreaterThan(5);
  expect(writes).toBeGreaterThan(5);
});
