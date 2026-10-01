import { expect, it, vi } from "vitest";
import { isBase64 } from "./base64.js";
import { encodeHeaderValue, decodeHeaderValue } from "./headers.js";

it("validates canonical base64 and round-trips UTF-8 headers without Buffer", () => {
  vi.stubGlobal("Buffer", undefined);
  try {
    for (const value of ["", "hello", "é🚀", "\ufeffhello", " trailing ", "=?base64?test?="])
      expect(decodeHeaderValue(encodeHeaderValue(value))).toBe(value);
    expect(isBase64("8J+agA==")).toBe(true);
    for (const value of ["a", "AA==\n", "AB==", "__==", "!!!!"])
      expect(isBase64(value)).toBe(false);
    expect(decodeHeaderValue("=?base64?AB==?=")).toBeUndefined();
    expect(decodeHeaderValue("=?base64?/w==?=")).toBeUndefined();
    expect(() => encodeHeaderValue("\ud800")).toThrow("Unicode");
  } finally { vi.unstubAllGlobals(); }
});
