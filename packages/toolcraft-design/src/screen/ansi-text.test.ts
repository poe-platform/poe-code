import { describe, expect, it } from "vitest";
import { ansiToCells } from "./ansi-text.js";
import { packStyle } from "./style.js";

describe("ansiToCells", () => {
  it("preserves SGR style and grapheme width", () => {
    expect(ansiToCells("\u001b[31mR\u001b[0m🙂")).toEqual([
      { ch: "R", width: 1, style: packStyle({ fg: 1 }), fg: 1, bg: 0 },
      { ch: "🙂", width: 2, style: 0, fg: 0, bg: 0 }
    ]);
  });
});
