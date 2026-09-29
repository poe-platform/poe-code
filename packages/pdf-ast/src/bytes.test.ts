// Cases ported from Mozilla PDF.js test/unit/util_spec.js (Apache-2.0).
import { describe, expect, it } from "vitest";
import { bytesToString, stringToBytes } from "./bytes.js";

describe("PDF.js byte strings", () => {
  it("rejects non-array arguments", () => {
    // @ts-expect-error Upstream runtime validation case.
    expect(() => bytesToString(null)).toThrow("Invalid argument for bytesToString");
  });
  it("handles empty and short arrays", () => {
    expect(bytesToString(new Uint8Array())).toBe("");
    expect(bytesToString(Uint8Array.of(102, 111, 111))).toBe("foo");
  });
  it("handles arrays beyond the maximum argument count", () => {
    expect(bytesToString(new Uint8Array(10000).fill(97))).toBe("a".repeat(10000));
  });
  it("rejects non-string arguments", () => {
    // @ts-expect-error Upstream runtime validation case.
    expect(() => stringToBytes(null)).toThrow("Invalid argument for stringToBytes");
  });
  it("handles string arguments", () => {
    expect(stringToBytes("")).toEqual(new Uint8Array());
    expect(stringToBytes("foo")).toEqual(Uint8Array.of(102, 111, 111));
  });
  it("preserves all byte values across chunk boundaries", () => {
    const bytes = Uint8Array.from({ length: 20000 }, (_, i) => i % 256);
    expect(stringToBytes(bytesToString(bytes))).toEqual(bytes);
  });
});
