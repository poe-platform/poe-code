import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../buffer.js";
import { computeVisualLines, renderOutputPane } from "./output-pane.js";
import type { OutputItem } from "../types.js";

function rows(buffer: ScreenBuffer): string[] {
  return Array.from({ length: buffer.height }, (_, y) =>
    Array.from({ length: buffer.width }, (_, x) => buffer.get(x, y).ch).join("")
  );
}

describe("output viewport", () => {
  it("does not parse history hidden above a full viewport", () => {
    const hidden: OutputItem = {
      kind: "info",
      ts: 0,
      get text(): string {
        throw new Error("hidden output was parsed");
      }
    };
    const buffer = new ScreenBuffer(20, 2);
    renderOutputPane(buffer, { x: 0, y: 0, width: 20, height: 2 }, [
      hidden,
      { kind: "success", text: "first\nsecond", ts: 1 }
    ]);
    expect(rows(buffer)).toEqual(["◆  first            ", "│  second           "]);
  });

  it("clamps scrolling at the oldest full page and preserves multiline prefixes", () => {
    const buffer = new ScreenBuffer(20, 2);
    const items: OutputItem[] = [
      { kind: "info", text: "one\ntwo\nthree", ts: 0 },
      { kind: "success", text: "four", ts: 1 }
    ];
    const rect = { x: 0, y: 0, width: 20, height: 2 };
    expect(renderOutputPane(buffer, rect, items, 1)).toBe(1);
    expect(rows(buffer)).toEqual(["│  two              ", "│  three            "]);
    expect(renderOutputPane(buffer, rect, items, 100)).toBe(2);
    expect(rows(buffer)).toEqual(["◇  one              ", "│  two              "]);
    expect(renderOutputPane(buffer, { ...rect, height: 0 }, items, 100)).toBe(0);
  });

  it("matches the full renderer for mixed wrapped and styled output", () => {
    const items: OutputItem[] = [
      { kind: "info", text: "an older entry with several wrapped words", ts: 0 },
      { kind: "tool", text: "\u001b[31mred words\u001b[0m\n界界界界", ts: 1 },
      { kind: "success", text: "last line", ts: 2 }
    ];
    for (const width of [5, 12, 30]) {
      for (const height of [1, 3, 20]) {
        const actual = new ScreenBuffer(width, height);
        const expected = new ScreenBuffer(width, height);
        const rect = { x: 0, y: 0, width, height };
        renderOutputPane(actual, rect, items);
        const lines = computeVisualLines(items, width).slice(-height);
        // Each retained visual row must have the same text and prefix as full wrapping.
        for (let y = 0; y < lines.length; y += 1) {
          expected.putInRect(rect, y, lines[y]!.prefix, lines[y]!.prefixStyle);
          expected.putInRect({ ...rect, x: 3, width: width - 3 }, y, lines[y]!.text);
        }
        expect(rows(actual)).toEqual(rows(expected));
      }
    }
  });
});
