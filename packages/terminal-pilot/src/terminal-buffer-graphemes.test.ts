import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("terminal grapheme cells", () => {
  for (const chunked of [false, true]) {
    for (const grapheme of ["👩‍💻", "🚀", "👩🏽‍💻", "🇺🇸", "❤️", "1️⃣"]) {
      it(`redraws ${grapheme} without stale cells (${chunked ? "split" : "whole"} writes)`, () => {
        const terminal = new TerminalBuffer(16, 3);
        const input = `|A${grapheme}B|`;
        for (const chunk of chunked ? Array.from(input) : [input]) terminal.write(chunk);
        expect(terminal.displayBuffer.cursorX).toBe(6);
        expect(terminal.renderLine(0)).toBe(input);
        terminal.write("\x1b[1;3H  ");
        expect(terminal.renderLine(0)).toBe("|A  B|");
      });
    }
  }

  it("keeps a joined emoji in one styled leading cell", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("\x1b[31m👩‍💻\x1b[0mX");
    expect(terminal.displayBuffer.data[0]?.[0]?.[1]).toBe("👩‍💻");
    expect(terminal.displayBuffer.data[0]?.[0]?.style).toBe("\x1b[31m");
    expect(terminal.displayBuffer.data[0]?.[1]).toBeNull();
    expect(terminal.renderLine(0)).toBe("\x1b[31m👩‍💻\x1b[0mX");
  });

  it("clears an old wide glyph when overwriting its trailing cell", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("A🚀B\x1b[1;3HX");
    expect(terminal.renderLine(0)).toBe("A XB");
  });

  it("does not add a serialized blank after a wide glyph", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("A界B");
    expect(terminal.renderLine(0)).toBe("A界B");
    expect(terminal.displayBuffer.cursorX).toBe(4);
  });

  it("preserves combining marks without adding columns", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("Ae");
    terminal.write("\u0301B");
    expect(terminal.renderLine(0)).toBe("AéB");
    expect(terminal.displayBuffer.cursorX).toBe(3);
  });

  it("joins across writes before consuming pending wrap", () => {
    const terminal = new TerminalBuffer(4, 3);
    terminal.write("AB👩");
    terminal.write("‍💻X");
    expect(terminal.renderLine(0)).toBe("AB👩‍💻");
    expect(terminal.renderLine(1)).toBe("X");
  });

  it("clears a partial wide glyph when erasing its trailing cell", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("A🚀B\x1b[1;3H\x1b[X");
    expect(terminal.renderLine(0)).toBe("A  B");
  });

  it("clears a wide glyph split by character insertion", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("A🚀B\x1b[1;3H\x1b[@");
    expect(terminal.renderLine(0)).toBe("A   B");
  });

  it("clears a wide glyph split by character deletion", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("A🚀B\x1b[1;3H\x1b[P");
    expect(terminal.renderLine(0)).toBe("A B");
  });

  it("clears a wide glyph split by insert-mode output", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("A🚀B\x1b[1;3H\x1b[4hX");
    expect(terminal.renderLine(0)).toBe("A X B");
  });

  it("clears a wide glyph clipped by resize", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("A🚀B");
    terminal.resize(2, 3);
    expect(terminal.renderLine(0)).toBe("A");
  });

  it("preserves complete wide cells when inserting before them", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("A🚀B\x1b[1;2H\x1b[@");
    expect(terminal.renderLine(0)).toBe("A 🚀B");
  });

  it("relocates a growing grapheme at the right margin", () => {
    const terminal = new TerminalBuffer(4, 3);
    terminal.write("ABC❤");
    terminal.write("️X");
    expect(terminal.renderLine(0)).toBe("ABC");
    expect(terminal.renderLine(1)).toBe("❤️X");
    expect(terminal.displayBuffer.cursorX).toBe(3);
  });

  it("repeats a complete grapheme with its full width", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("❤️\x1b[2bX");
    expect(terminal.renderLine(0)).toBe("❤️❤️❤️X");
    expect(terminal.displayBuffer.cursorX).toBe(7);
  });

  it("keeps concealed wide graphemes at their occupied width", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("\x1b[8m👩‍💻\x1b[0mX");
    expect(terminal.renderLine(0)).toBe("\x1b[8m  \x1b[0mX");
    expect(terminal.displayBuffer.cursorX).toBe(3);
  });

  it("clears a wide glyph clipped by insert-mode output", () => {
    const terminal = new TerminalBuffer(4, 3);
    terminal.write("AB界\x1b[1;1H\x1b[4hX");
    expect(terminal.renderLine(0)).toBe("XAB");
  });

  it("clears a wide glyph clipped by blank insertion", () => {
    const terminal = new TerminalBuffer(4, 3);
    terminal.write("AB界\x1b[1;1H\x1b[@");
    expect(terminal.renderLine(0)).toBe(" AB");
  });

  it("retains columns when round-tripping styled joined emoji", () => {
    const terminal = new TerminalBuffer(16, 3);
    terminal.write("\x1b[31mA👩‍💻\x1b[36m❤️B\x1b[0m|");
    const reconstructed = new TerminalBuffer(16, 3);
    reconstructed.write(terminal.renderLine(0));
    expect(reconstructed.displayBuffer.data[0]).toEqual(terminal.displayBuffer.data[0]);
    expect(reconstructed.displayBuffer.data[0]?.map(cell => cell?.style)).toEqual(
      terminal.displayBuffer.data[0]?.map(cell => cell?.style)
    );
    expect(reconstructed.displayBuffer.cursorX).toBe(terminal.displayBuffer.cursorX);
  });

  it.each(["👩‍💻", "🚀", "👩🏽‍💻", "🇺🇸", "❤️", "1️⃣"])(
    "accepts %s split across UTF-16 code units",
    grapheme => {
      const terminal = new TerminalBuffer(16, 3);
      for (const unit of `A${grapheme}B`.split("")) terminal.write(unit);
      expect(terminal.renderLine(0)).toBe(`A${grapheme}B`);
      expect(terminal.displayBuffer.cursorX).toBe(4);
    }
  );
});
