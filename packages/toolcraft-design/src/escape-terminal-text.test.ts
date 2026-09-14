import { describe, expect, it } from "vitest";
import { escapeTerminalText } from "./escape-terminal-text.js";

describe("escapeTerminalText", () => {
  it("preserves ordinary Unicode and literal punctuation", () => {
    const text = "Résumé 日本語 😀 e\u0301 /draft [ready] \\u001b";
    expect(escapeTerminalText(text)).toBe(text);
    expect(escapeTerminalText("")).toBe("");
  });

  it("makes every C0, DEL and C1 control visible", () => {
    const codes = [
      ...Array.from({ length: 32 }, (_, index) => index),
      ...Array.from({ length: 33 }, (_, index) => index + 127)
    ];
    for (const code of codes) {
      expect(escapeTerminalText(`before${String.fromCodePoint(code)}after`))
        .toBe(`before\\u${code.toString(16).padStart(4, "0")}after`);
    }
  });

  it("neutralizes screen and hyperlink escape sequences without discarding evidence", () => {
    expect(escapeTerminalText("\u001b[2J\u001b]8;;https://example.invalid\u0007label\u001b]8;;\u001b\\"))
      .toBe("\\u001b[2J\\u001b]8;;https://example.invalid\\u0007label\\u001b]8;;\\u001b\\");
  });

  it("escapes directional marks, embeddings, overrides and isolates", () => {
    const codes = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
    for (const code of codes) {
      expect(escapeTerminalText(`report${String.fromCodePoint(code)}.docx`))
        .toBe(`report\\u${code.toString(16).padStart(4, "0")}.docx`);
    }
  });
});
