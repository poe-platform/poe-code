import { describe, expect, it } from "vitest";
import { readImageMetadata } from "./index.js";

const input = new TextEncoder().encode("P6\n16384 16384\n255\n");

describe("input pixel limits", () => {
  it("accepts images above the former pixel limit by default", () => {
    expect(readImageMetadata(input)).toMatchObject({ width: 16384, height: 16384 });
  });

  it("enforces explicitly configured limits, including with unlimited enabled", () => {
    for (const unlimited of [false, true]) {
      expect(() => readImageMetadata(input, { limitInputPixels: 268402689, unlimited }))
        .toThrow("Input image exceeds pixel limit");
    }
    expect(readImageMetadata(input, { limitInputPixels: 16384 * 16384 }))
      .toMatchObject({ width: 16384, height: 16384 });
  });

  it.each([false, 0, Infinity])("accepts disabled pixel limit %s", (limitInputPixels) => {
    expect(readImageMetadata(input, { limitInputPixels }))
      .toMatchObject({ width: 16384, height: 16384 });
  });
});
