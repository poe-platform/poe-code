import { describe, expect, it } from "vitest";
import { packStyle, styleToSgrDelta } from "./style.js";

describe("packed styles", () => {
  it("packs flags and emits only the necessary SGR delta", () => {
    const plain = packStyle({});
    const boldRed = packStyle({ bold: true, fg: 1 });
    expect(styleToSgrDelta(plain, boldRed, true)).toBe("\u001b[1;31m");
    expect(styleToSgrDelta(boldRed, boldRed, true)).toBe("");
    expect(styleToSgrDelta(boldRed, plain, true)).toBe("\u001b[22;39m");
  });
});
