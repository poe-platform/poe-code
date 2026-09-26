import { expect, it } from "vitest";
import { byteTextCases, byteTextLeadCases } from "./byte-text-fixtures.js";
import { byteTextLength, encodeByteText, sliceByteText } from "./byte-text.js";
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], value => parseInt(value, 16));
const hex = (value: Uint8Array | undefined) => value && Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("");
it.each(byteTextCases)("counts native non-UTF8 bytes $id", vector => {
  expect(byteTextLength(bytes(vector.inputHex), () => {})).toBe(vector.length);
});
it.each(byteTextCases)("slices native non-UTF8 bytes $id", vector => {
  const input = bytes(vector.inputHex);
  expect(hex(sliceByteText(input, "left", 1, 1, () => {}))).toBe(vector.leftHex);
  expect(hex(sliceByteText(input, "right", 1, 1, () => {}))).toBe(vector.rightHex);
  expect(hex(sliceByteText(input, "mid", 2, 3, () => {}))).toBe(vector.midHex);
});
it("preserves C-string boundaries, owned results and clipped cursor safety", () => {
  const source = Uint8Array.of(65, 0, 66);
  const result = sliceByteText(source, "left", 1, 100, () => {});
  expect(result).toEqual(Uint8Array.of(65));
  source[0] = 90;
  expect(result).toEqual(Uint8Array.of(65));
  expect(byteTextLength(source, () => {})).toBe(1);
  expect(sliceByteText(Uint8Array.of(0xc2), "left", 1, 1, () => {})).toEqual(Uint8Array.of(0xc2));
  expect(sliceByteText(Uint8Array.of(0x80), "right", 1, 1, () => {})).toEqual(Uint8Array.of(0x80));
});
it("keeps scalar argument errors and zero counts", () => {
  const source = Uint8Array.of(65);
  expect(sliceByteText(source, "left", 1, -1, () => {})).toBeUndefined();
  expect(sliceByteText(source, "mid", 0, 1, () => {})).toBeUndefined();
  expect(sliceByteText(source, "left", 1, 0, () => {})).toEqual(new Uint8Array());
  expect(sliceByteText(source, "mid", 100, 1, () => {})).toEqual(new Uint8Array());
});
it("observes work/cancellation callbacks while scanning and traversing", () => {
  for (const action of [byteTextLength, (input: Uint8Array, tick: () => void) => sliceByteText(input, "right", 1, 5, tick)]) {
    let work = 0;
    expect(() => action(new Uint8Array(100).fill(65), () => { if (++work === 9) throw new Error("owned cancellation"); })).toThrow("owned cancellation");
    expect(work).toBe(9);
  }
});

it.each(["LEN", "LEFT", "MID", "RIGHT"])("public %s observes cooperative cancellation during source traversal", async name => {
  const { textFunctions } = await import("../formulas/functions/text.js");
  let work = 0;
  const host = { scalar(value: unknown) { return value; }, tick() { if (++work === 9) throw new Error("public text cancellation"); } } as unknown as import("../formulas/functions/types.js").FunctionHost;
  const args = [{ kind: "string" as const, value: "a".repeat(100) }, { kind: "number" as const, value: 1 }, { kind: "number" as const, value: 3 }];
  expect(() => textFunctions[name]!(args, host)).toThrow("public text cancellation");
  expect(work).toBe(9);
});

it.each(byteTextLeadCases)("matches executed GLib lead-byte profile $lead", vector => {
  const input = bytes(vector.inputHex);
  expect(byteTextLength(input, () => {})).toBe(vector.length);
  expect(hex(sliceByteText(input, "left", 1, 1, () => {}))).toBe(vector.leftHex);
  expect(hex(sliceByteText(input, "right", 1, 1, () => {}))).toBe(vector.rightHex);
  expect(hex(sliceByteText(input, "mid", 2, 3, () => {}))).toBe(vector.midHex);
});

it("does not silently replacement-encode malformed host UTF-16 text", async () => {
  const { textFunctions } = await import("../formulas/functions/text.js");
  const host = { scalar(value: unknown) { return value; }, tick() {} } as unknown as import("../formulas/functions/types.js").FunctionHost;
  expect(() => textFunctions.LEFT!([{ kind: "string", value: "\ud800" }, { kind: "number", value: 1 }], host)).toThrow("text byte representation");
});

it("admits Unicode and the visible C-string prefix without replacing host text", () => {
  expect(encodeByteText("ä😀", () => {})).toEqual(Uint8Array.of(0xc3, 0xa4, 0xf0, 0x9f, 0x98, 0x80));
  expect(encodeByteText("a\0\ud800", () => {})).toEqual(Uint8Array.of(97));
  expect(() => encodeByteText("\udc00", () => {})).toThrow("text byte representation");
  let work = 0;
  expect(() => encodeByteText("abc", () => { if (++work === 2) throw new Error("encoding cancelled"); })).toThrow("encoding cancelled");
  expect(work).toBe(2);
});
