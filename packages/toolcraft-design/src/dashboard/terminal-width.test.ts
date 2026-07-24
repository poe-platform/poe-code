import { describe, expect, it } from "vitest";
import { displayWidth, graphemeWidth, truncateToWidth } from "./terminal-width.js";

describe("terminal width", () => {
  it("measures whole graphemes and promotes VS16 emoji presentation", () => {
    expect(graphemeWidth("♥")).toBe(1);
    expect(graphemeWidth("♥️")).toBe(2);
    expect(displayWidth("A♥️B")).toBe(4);
  });

  it("truncates at grapheme boundaries with an ellipsis", () => {
    expect(truncateToWidth("ab🙂cd", 5)).toBe("ab🙂…");
    expect(truncateToWidth("🙂", 1)).toBe("…");
    expect(truncateToWidth("abc", 0)).toBe("");
  });
});
