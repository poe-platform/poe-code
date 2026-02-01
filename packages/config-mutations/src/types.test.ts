import { describe, it, expect } from "vitest";
import { isConfigObject } from "./types.js";

describe("isConfigObject", () => {
  it("returns true for plain objects", () => {
    expect(isConfigObject({ key: "value" })).toBe(true);
  });

  it("returns false for arrays", () => {
    expect(isConfigObject(["value"])).toBe(false);
  });

  it("returns false for null", () => {
    expect(isConfigObject(null)).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isConfigObject("value")).toBe(false);
    expect(isConfigObject(42)).toBe(false);
    expect(isConfigObject(true)).toBe(false);
  });
});
