import { describe, expect, it } from "vitest";
import { tokenfill } from "./tokenfill.js";

describe("tokenfill", () => {
  it("returns text and exact actualTokens for requested count", () => {
    const result = tokenfill(25);

    expect(result.actualTokens).toBe(25);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("throws when token count is not a non-negative integer", () => {
    expect(() => tokenfill(-1)).toThrow(/non-negative integer/i);
    expect(() => tokenfill(1.5)).toThrow(/non-negative integer/i);
  });

  it("is deterministic for repeated calls", () => {
    const first = tokenfill(55);
    const second = tokenfill(55);

    expect(first).toEqual(second);
  });

  it("returns smaller token counts as prefixes of larger ones", () => {
    const smaller = tokenfill(30);
    const larger = tokenfill(70);

    expect(larger.text.startsWith(smaller.text)).toBe(true);
  });

  it("throws when token request exceeds corpus size", () => {
    expect(() => tokenfill(Number.MAX_SAFE_INTEGER)).toThrow(/exceeds built-in corpus size/i);
  });

  it("accepts an explicit encoding option", () => {
    const implicit = tokenfill(20);
    const explicit = tokenfill(20, { encoding: "cl100k_base" });

    expect(explicit).toEqual(implicit);
  });
});
