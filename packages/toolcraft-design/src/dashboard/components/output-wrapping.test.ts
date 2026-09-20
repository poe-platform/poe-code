import { afterEach, describe, expect, it, vi } from "vitest";
import * as terminalWidth from "../terminal-width.js";
import { computeVisualLines } from "./output-pane.js";

afterEach(() => vi.restoreAllMocks());

describe("streamed output wrapping", () => {
  it("measures long paragraphs with work proportional to their text size", () => {
    const measure = vi.spyOn(terminalWidth, "displayWidth");
    const text = "a readable streaming paragraph ".repeat(400);
    const lines = computeVisualLines([{ kind: "info", text, ts: 0 }], 1003);
    expect(lines.map((line) => line.text).join(" ")).toBe(text.trim());
    const measuredCharacters = measure.mock.calls.reduce((sum, [value]) => sum + value.length, 0);
    expect(measuredCharacters).toBeLessThanOrEqual(text.length * 3);
  });

  it("retains graphemes and terminal spacing while wrapping mixed text", () => {
    const lines = computeVisualLines([{ kind: "info", text: "A\t界 e\u0301 👩‍💻 abcdefgh", ts: 0 }], 11);
    expect(lines.map((line) => line.text)).toEqual(["A", "界 e\u0301 👩‍💻", "abcdefgh"]);
    expect(lines.every((line) => terminalWidth.displayWidth(line.text) <= 8)).toBe(true);
  });
});
