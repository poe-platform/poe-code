import { expect, it, vi } from "vitest";
import { parseCharacterCMap, parseToUnicodeCMap } from "./cmap.js";
const bytes = (text: string) => new TextEncoder().encode(text);

it.each(["1 begincidrange <0000> <0fff> 0 endcidrange", "1 beginbfrange <0000> <0fff> <0041> endbfrange"])("admits compact range expansion before mapping entries: %s", source => {
  const original = Map.prototype.set; let mapped = 0;
  const spy = vi.spyOn(Map.prototype, "set").mockImplementation(function(this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (typeof key === "number") mapped++;
    return original.call(this, key, value);
  });
  let failure: unknown;
  try { parseCharacterCMap(bytes(source), { maxWorkingBytes: 8192 }); } catch (error) { failure = error; }
  finally { spy.mockRestore(); }
  expect(failure).toMatchObject({ code: "E_LIMIT" }); expect(mapped).toBe(0);
});

it("does not swallow the containing font owner's allocation rejection", () => {
  const failure = new Error("font owner exhausted"); let requested = 0;
  expect(() => parseCharacterCMap(bytes("1 begincidrange <0000> <0fff> 0 endcidrange"), {
    onAllocation(size) { requested += size; if (requested > 8192) throw failure; },
  })).toThrow(failure);
});

it("retains oversized-range recovery without charging rejected range expansion", () => {
  const cmap = parseToUnicodeCMap(bytes("1 begincidrange <00000000> <ffffffff> 0 endcidrange 1 begincidrange <0000> <0001> 5 endcidrange"), { maxWorkingBytes: 8192 });
  expect(cmap.map.get(0)).toBe("\x05"); expect(cmap.map.get(1)).toBe("\x06"); expect(cmap.map.size).toBe(2);
});

it("charges both character mapping and Unicode conversion to one owner", () => {
  const input = bytes("1 beginbfrange <0000> <000f> <0041> endbfrange");
  expect(() => parseCharacterCMap(input, { maxWorkingBytes: 4600 })).not.toThrow();
  expect(() => parseToUnicodeCMap(input, { maxWorkingBytes: 4600 })).toThrow(expect.objectContaining({ code: "E_LIMIT" }));
});

it.each([NaN, undefined, null, 0, ""])("preserves arbitrary owner rejection values: %s", failure => {
  let refused = false, caught = false;
  try {
    parseCharacterCMap(bytes("1 begincidrange <0000> <0fff> 0 endcidrange"), {
      onAllocation(size) { if (!refused && size > 10000) { refused = true; throw failure; } },
    });
  } catch (error) { caught = true; expect(Object.is(error, failure)).toBe(true); }
  expect(refused).toBe(true); expect(caught).toBe(true);
});
