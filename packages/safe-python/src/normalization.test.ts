import { describe, expect, it, vi } from "vitest";
import { normalizeNfkc } from "./normalization.js";

describe("Unicode 16 NFKC normalization", () => {
  it.each([
    ["ascii_123", "ascii_123"], ["ｉｆ", "if"], ["𝒙", "x"], ["K", "K"], ["ﬃ", "ffi"],
    ["e\u0301", "é"], ["a\u0315\u0300", "à\u0315"], ["\u0301\u0323", "\u0323\u0301"],
    ["\u1100\u1161\u11a8", "각"], ["가\u11a8", "각"], ["\u0344", "\u0308\u0301"],
    ["\u{1ccd6}", "A"], ["\u{1e6c0}", "\u{1e6c0}"], ["\ud800", "\ud800"], ["", ""]
  ])("normalizes %j to %j", (input, output) => { expect(normalizeNfkc(input)).toBe(output); });

  it("does not use the host normalizer", () => {
    // Unicode 16 added this compatibility decomposition; older hosts lack it.
    const host = vi.spyOn(String.prototype, "normalize").mockImplementation(() => { throw new Error("host normalization unavailable"); });
    try { expect(normalizeNfkc("\u{1ccd6}")).toBe("A"); }
    finally { host.mockRestore(); }
  });

  it("orders long combining sequences while retaining stable equal-class order", () => {
    const text = "x" + "\u0315\u0300".repeat(1000);
    expect(normalizeNfkc(text)).toBe("x" + "\u0300".repeat(1000) + "\u0315".repeat(1000));
  });
});
