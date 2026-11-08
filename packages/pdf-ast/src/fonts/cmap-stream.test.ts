import { expect, it, vi } from "vitest";
import { iterateCMapCharacters, parseCharacterCMap, parseToUnicodeCMap, readCMapCharacters } from "./cmap.js";
const bytes = (text: string) => new TextEncoder().encode(text);
const mapping = bytes("2 begincodespacerange <20> <7f> <8000> <80ff> endcodespacerange 2 beginbfchar <41> <0041> <8001> <00660069> endbfchar");

it("decodes one character at a time without copying or visiting the remaining token", () => {
  const cmap = parseCharacterCMap(mapping); const read = vi.spyOn(cmap, "readCharCode");
  let reads = 0;
  const token = new Proxy(new Uint8Array(1000000), { get(target, key) {
    if (key === "length") return target.length;
    if (typeof key === "string" && Number.isInteger(Number(key))) { reads++; return 65; }
    throw new Error("whole-token operation forbidden");
  } });
  const iterator = iterateCMapCharacters(cmap, token);
  expect(reads).toBe(0); expect(read).not.toHaveBeenCalled();
  expect(iterator.next().value).toEqual({ charCode: 65, isSpace: false });
  expect(read).toHaveBeenCalledTimes(1); expect(reads).toBeLessThanOrEqual(5);
  iterator.return(); expect(read).toHaveBeenCalledTimes(1);
});

it("preserves mixed widths, invalid codes, spaces and truncated trailing codes", () => {
  const cmap = parseCharacterCMap(mapping), input = Uint8Array.of(65, 32, 128, 1, 0, 128);
  const expected = [{ charCode: 65, isSpace: false }, { charCode: 32, isSpace: true }, { charCode: 32769, isSpace: false }, { charCode: 0, isSpace: false }];
  expect([...iterateCMapCharacters(cmap, input)]).toEqual(expected);
  expect(readCMapCharacters(cmap, input)).toEqual(expected);
});

it("offers lazy Unicode decoding with the same buffered convenience output", () => {
  const cmap = parseToUnicodeCMap(mapping), input = Uint8Array.of(65, 128, 1, 128);
  const read = vi.spyOn(cmap.map, "get");
  const iterator = cmap.iterateBytes(input); expect(read).not.toHaveBeenCalled();
  const first = iterator.next().value!; expect(first).toEqual({ charCode: 65, unicode: "A" });
  expect(read).toHaveBeenCalledTimes(1);
  expect(iterator.next().value).toEqual({ charCode: 32769, unicode: "fi" });
  expect(iterator.next().done).toBe(true); expect(first).toEqual({ charCode: 65, unicode: "A" });
  const { decodeBytes } = cmap;
  expect(decodeBytes(input)).toEqual([{ charCode: 65, unicode: "A" }, { charCode: 32769, unicode: "fi" }]);
});
