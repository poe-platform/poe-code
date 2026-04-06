import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

function readLine(buf: TerminalBuffer, row: number): string {
  const cells = buf.displayBuffer.data[row] ?? [];
  return cells.map((c) => c?.[1] ?? " ").join("");
}

function readScreen(buf: TerminalBuffer, rows: number): string[] {
  return Array.from({ length: rows }, (_, i) => readLine(buf, i).trimEnd());
}

describe("TerminalBuffer", () => {
  describe("basic writes", () => {
    it("writes characters at cursor and advances cursor", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("hi");
      expect(buf.displayBuffer.cursorX).toBe(2);
      expect(buf.displayBuffer.cursorY).toBe(0);
      expect(readLine(buf, 0).slice(0, 2)).toBe("hi");
    });

    it("exposes character at correct position", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("AB");
      const data = buf.displayBuffer.data;
      expect(data[0]?.[0]).toEqual([65, "A"]);
      expect(data[0]?.[1]).toEqual([66, "B"]);
    });
  });

  describe("control characters", () => {
    it("CR resets cursor to column 0", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("hello\r");
      expect(buf.displayBuffer.cursorX).toBe(0);
      expect(buf.displayBuffer.cursorY).toBe(0);
    });

    it("LF moves cursor down without changing column", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("AB\nC");
      expect(buf.displayBuffer.cursorY).toBe(1);
      expect(buf.displayBuffer.cursorX).toBe(3); // A, B advanced to 2, \n kept x=2, C advanced to 3
    });

    it("CR+LF moves to next line column 0", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("hello\r\nworld");
      expect(buf.displayBuffer.cursorY).toBe(1);
      expect(buf.displayBuffer.cursorX).toBe(5);
      expect(readLine(buf, 0).slice(0, 5)).toBe("hello");
      expect(readLine(buf, 1).slice(0, 5)).toBe("world");
    });

    it("BS moves cursor left without erasing", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("AB\x08");
      expect(buf.displayBuffer.cursorX).toBe(1);
    });

    it("BS at column 0 does nothing", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x08");
      expect(buf.displayBuffer.cursorX).toBe(0);
    });

    it("TAB advances to next 8-column boundary", () => {
      const buf = new TerminalBuffer(40, 5);
      buf.write("\t");
      expect(buf.displayBuffer.cursorX).toBe(8);
      buf.write("A\t");
      expect(buf.displayBuffer.cursorX).toBe(16);
    });
  });

  describe("auto-wrap", () => {
    it("wraps cursor to next line when writing past end of column", () => {
      const buf = new TerminalBuffer(5, 5);
      buf.write("ABCDE"); // fills row 0
      expect(buf.displayBuffer.cursorX).toBe(0);
      expect(buf.displayBuffer.cursorY).toBe(1);
    });

    it("scrolls when wrapping at bottom row", () => {
      const buf = new TerminalBuffer(5, 3);
      // Fill all 3 rows
      buf.write("AAAAA"); // row 0
      buf.write("BBBBB"); // row 1
      buf.write("CCCCC"); // row 2 — next char should scroll
      buf.write("D");
      expect(readLine(buf, 0).slice(0, 5)).toBe("BBBBB");
      expect(readLine(buf, 1).slice(0, 5)).toBe("CCCCC");
      expect(readLine(buf, 2).slice(0, 1)).toBe("D");
    });
  });

  describe("scrolling", () => {
    it("scrolls up when LF at bottom margin", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("line1\r\nline2\r\nline3\r\n");
      // After 3 lines + LF, line1 should be gone
      const lines = readScreen(buf, 3);
      expect(lines[0]).toBe("line2");
      expect(lines[1]).toBe("line3");
      expect(lines[2]).toBe("");
    });
  });

  describe("CSI cursor movement", () => {
    it("CSI A moves cursor up", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[3B"); // down 3
      buf.write("\x1b[2A"); // up 2
      expect(buf.displayBuffer.cursorY).toBe(1);
    });

    it("CSI B moves cursor down", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[2B");
      expect(buf.displayBuffer.cursorY).toBe(2);
    });

    it("CSI C moves cursor right", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[3C");
      expect(buf.displayBuffer.cursorX).toBe(3);
    });

    it("CSI D moves cursor left", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[5C\x1b[2D");
      expect(buf.displayBuffer.cursorX).toBe(3);
    });

    it("CSI H positions cursor at row;col", () => {
      const buf = new TerminalBuffer(10, 10);
      buf.write("\x1b[3;5H"); // row 3, col 5 (1-based)
      expect(buf.displayBuffer.cursorY).toBe(2);
      expect(buf.displayBuffer.cursorX).toBe(4);
    });

    it("CSI H with no params goes to 1;1", () => {
      const buf = new TerminalBuffer(10, 10);
      buf.write("\x1b[3;5H\x1b[H");
      expect(buf.displayBuffer.cursorY).toBe(0);
      expect(buf.displayBuffer.cursorX).toBe(0);
    });

    it("CSI G sets cursor column", () => {
      const buf = new TerminalBuffer(20, 5);
      buf.write("\x1b[10G");
      expect(buf.displayBuffer.cursorX).toBe(9);
    });

    it("cursor movement is clamped to screen bounds", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[100A"); // can't go above row 0
      expect(buf.displayBuffer.cursorY).toBe(0);
      buf.write("\x1b[100B"); // can't go below row 4
      expect(buf.displayBuffer.cursorY).toBe(4);
      buf.write("\x1b[100D"); // can't go left of col 0
      expect(buf.displayBuffer.cursorX).toBe(0);
      buf.write("\x1b[100C"); // can't go right of col 9
      expect(buf.displayBuffer.cursorX).toBe(9);
    });
  });

  describe("CSI erase", () => {
    it("CSI 2K erases entire line", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("hello");
      buf.write("\x1b[2K");
      expect(readLine(buf, 0).trim()).toBe("");
    });

    it("CSI 0K erases from cursor to end of line", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("ABCDE");      // row 0, cursor at col 5
      buf.write("\x1b[1;3H"); // move to row 0, col 2 (0-based)
      buf.write("\x1b[0K");   // erase from col 2 to end
      expect(readLine(buf, 0).trim()).toBe("AB");
    });

    it("CSI 2J clears entire screen", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("hello\r\nworld\r\nfoo");
      buf.write("\x1b[2J");
      expect(readScreen(buf, 3)).toEqual(["", "", ""]);
    });
  });

  describe("CSI scroll region", () => {
    it("scrolling respects top/bottom margin set by CSI r", () => {
      const buf = new TerminalBuffer(10, 5);
      // Set scroll region to rows 2-4 (1-based), then scroll up
      buf.write("\x1b[2;4r"); // scroll region rows 2-4
      // Cursor is reset to 0,0 after setting scroll region
      buf.write("\x1b[2;1H"); // move to row 2
      buf.write("LINE2");
      buf.write("\x1b[3;1H");
      buf.write("LINE3");
      buf.write("\x1b[4;1H");
      buf.write("LINE4");
      buf.write("\x1b[S"); // scroll up 1 within region
      // LINE2 should be gone, LINE3 and LINE4 shifted up
      expect(readLine(buf, 1).trim()).toBe("LINE3");
      expect(readLine(buf, 2).trim()).toBe("LINE4");
      expect(readLine(buf, 3).trim()).toBe("");
    });
  });

  describe("ESC save/restore cursor", () => {
    it("ESC 7 / ESC 8 save and restore cursor", () => {
      const buf = new TerminalBuffer(10, 10);
      buf.write("\x1b[5;7H"); // position at row 5, col 7
      buf.write("\x1b7"); // save
      buf.write("\x1b[H"); // move to origin
      buf.write("\x1b8"); // restore
      expect(buf.displayBuffer.cursorY).toBe(4);
      expect(buf.displayBuffer.cursorX).toBe(6);
    });
  });

  describe("ESC M reverse index", () => {
    it("moves cursor up when not at top margin", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[3;1H"); // row 3
      buf.write("\x1bM"); // reverse index
      expect(buf.displayBuffer.cursorY).toBe(1);
    });

    it("scrolls down when at top margin", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("row0\r\nrow1\r\nrow2");
      buf.write("\x1b[1;1H"); // go to top
      buf.write("\x1bM"); // reverse index — should scroll down
      expect(readLine(buf, 1).trim()).toBe("row0");
      expect(readLine(buf, 2).trim()).toBe("row1");
    });
  });

  describe("ESC c full reset", () => {
    it("clears screen and resets cursor", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("hello\r\nworld");
      buf.write("\x1bc");
      expect(buf.displayBuffer.cursorX).toBe(0);
      expect(buf.displayBuffer.cursorY).toBe(0);
      expect(readScreen(buf, 3)).toEqual(["", "", ""]);
    });
  });

  describe("SGR and OSC passthrough", () => {
    it("preserves SGR styling when reconstructing the visible line", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[1;31mAB\x1b[0m C\x1b[38;2;162;0;255mD");
      expect(readLine(buf, 0).slice(0, 2)).toBe("AB");
      expect(readLine(buf, 0).slice(0, 4)).toBe("AB C");
      expect(buf.displayBuffer.cursorX).toBe(5);
      expect(buf.renderLine(0)).toBe(
        "\x1b[1;31mAB\x1b[0m C\x1b[38;2;162;0;255mD\x1b[0m"
      );
    });

    it("OSC sequences are consumed without writing characters", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b]0;My Title\x07hello");
      expect(readLine(buf, 0).slice(0, 5)).toBe("hello");
    });
  });

  describe("resize", () => {
    it("expands rows and cols", () => {
      const buf = new TerminalBuffer(5, 3);
      buf.write("hi");
      buf.resize(10, 6);
      expect(buf.displayBuffer.data.length).toBe(6);
      expect(buf.displayBuffer.data[0]?.length).toBe(10);
      // Existing content preserved
      expect(readLine(buf, 0).slice(0, 2)).toBe("hi");
    });

    it("clamps cursor into new bounds", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[5;10H"); // bottom-right corner
      buf.resize(5, 3);
      expect(buf.displayBuffer.cursorX).toBe(4);
      expect(buf.displayBuffer.cursorY).toBe(2);
    });
  });

  describe("displayBuffer reactivity", () => {
    it("cursorX and cursorY reflect current state after writes", () => {
      const buf = new TerminalBuffer(10, 5);
      const db = buf.displayBuffer;
      buf.write("ABC");
      expect(db.cursorX).toBe(3);
      buf.write("\r\n");
      expect(db.cursorY).toBe(1);
      expect(db.cursorX).toBe(0);
    });

    it("data reflects current screen state", () => {
      const buf = new TerminalBuffer(10, 5);
      const db = buf.displayBuffer;
      buf.write("X");
      expect(db.data[0]?.[0]).toEqual([88, "X"]);
    });

    it("data reflects new screen after ESC c reset", () => {
      const buf = new TerminalBuffer(10, 3);
      const db = buf.displayBuffer;
      buf.write("hello");
      buf.write("\x1bc");
      expect(db.data[0]?.[0]).toBeNull();
    });
  });

  describe("CSI erase variants", () => {
    it("CSI 1K erases from line start to cursor inclusive", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("ABCDE");
      buf.write("\x1b[1;4H"); // row 0, col 3 (0-based)
      buf.write("\x1b[1K");   // erase cols 0-3 inclusive
      expect(readLine(buf, 0).trimEnd()).toBe("    E");
    });

    it("CSI 0J erases from cursor to end of screen", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("AAA\r\nBBB\r\nCCC");
      buf.write("\x1b[2;2H"); // row 1, col 1 (0-based)
      buf.write("\x1b[0J");
      expect(readLine(buf, 0).trim()).toBe("AAA");
      expect(readLine(buf, 1).trimEnd()).toBe("B");
      expect(readLine(buf, 2).trim()).toBe("");
    });

    it("CSI 1J erases from screen start to cursor", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("AAA\r\nBBB\r\nCCC");
      buf.write("\x1b[2;2H"); // row 1, col 1 (0-based)
      buf.write("\x1b[1J");
      expect(readLine(buf, 0).trim()).toBe("");
      expect(readLine(buf, 1).trimEnd()).toBe("  B");
      expect(readLine(buf, 2).trim()).toBe("CCC");
    });
  });

  describe("CSI insert/delete lines", () => {
    it("CSI L inserts blank lines at cursor row, pushing content down", () => {
      const buf = new TerminalBuffer(10, 4);
      buf.write("row0\r\nrow1\r\nrow2\r\nrow3");
      buf.write("\x1b[2;1H"); // row 1 (0-based)
      buf.write("\x1b[L");   // insert 1 line
      expect(readLine(buf, 0).trim()).toBe("row0");
      expect(readLine(buf, 1).trim()).toBe("");
      expect(readLine(buf, 2).trim()).toBe("row1");
      expect(readLine(buf, 3).trim()).toBe("row2"); // row3 scrolled off
    });

    it("CSI M deletes lines at cursor row, pulling content up", () => {
      const buf = new TerminalBuffer(10, 4);
      buf.write("row0\r\nrow1\r\nrow2\r\nrow3");
      buf.write("\x1b[2;1H"); // row 1 (0-based)
      buf.write("\x1b[M");   // delete 1 line
      expect(readLine(buf, 0).trim()).toBe("row0");
      expect(readLine(buf, 1).trim()).toBe("row2");
      expect(readLine(buf, 2).trim()).toBe("row3");
      expect(readLine(buf, 3).trim()).toBe("");
    });
  });

  describe("CSI delete/insert characters", () => {
    it("CSI P deletes characters at cursor, shifting rest left", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("ABCDE");
      buf.write("\x1b[1;2H"); // row 0, col 1 (0-based)
      buf.write("\x1b[2P");  // delete 2 chars
      expect(readLine(buf, 0).trimEnd()).toBe("ADE");
    });

    it("CSI @ inserts blank characters at cursor, shifting rest right and truncating at col boundary", () => {
      const buf = new TerminalBuffer(6, 3); // 6 cols: ABCDE fits with 1 spare
      buf.write("ABCDE");
      buf.write("\x1b[1;2H"); // row 0, col 1 (0-based)
      buf.write("\x1b[2@");  // insert 2 blanks — E shifts to col 6, gets truncated
      expect(readLine(buf, 0).trimEnd()).toBe("A  BCD");
    });
  });

  describe("CSI scroll down", () => {
    it("CSI T scrolls content down within scroll region", () => {
      const buf = new TerminalBuffer(10, 4);
      buf.write("row0\r\nrow1\r\nrow2\r\nrow3");
      buf.write("\x1b[T"); // scroll down 1
      expect(readLine(buf, 0).trim()).toBe("");
      expect(readLine(buf, 1).trim()).toBe("row0");
      expect(readLine(buf, 2).trim()).toBe("row1");
      expect(readLine(buf, 3).trim()).toBe("row2"); // row3 pushed off
    });
  });

  describe("CSI cursor next/previous line", () => {
    it("CSI E moves cursor down and to column 0", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[3C"); // cursor right to col 3
      buf.write("\x1b[2E"); // cursor next line x2
      expect(buf.displayBuffer.cursorY).toBe(2);
      expect(buf.displayBuffer.cursorX).toBe(0);
    });

    it("CSI F moves cursor up and to column 0", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[4B"); // cursor down to row 4
      buf.write("\x1b[3C"); // cursor right to col 3
      buf.write("\x1b[2F"); // cursor preceding line x2
      expect(buf.displayBuffer.cursorY).toBe(2);
      expect(buf.displayBuffer.cursorX).toBe(0);
    });
  });

  describe("ESC D/E index", () => {
    it("ESC D moves cursor down (index), scrolling if at bottom", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("row0\r\nrow1\r\nrow2");
      buf.write("\x1bD"); // index — at bottom, should scroll
      expect(readLine(buf, 0).trim()).toBe("row1");
      expect(readLine(buf, 1).trim()).toBe("row2");
      expect(readLine(buf, 2).trim()).toBe("");
    });

    it("ESC E moves cursor to start of next line", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[3C"); // col 3
      buf.write("\x1bE");   // next line
      expect(buf.displayBuffer.cursorY).toBe(1);
      expect(buf.displayBuffer.cursorX).toBe(0);
    });
  });

  describe("VT and FF treated as LF", () => {
    it("VT (0x0b) moves cursor down", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("A\x0bB");
      expect(buf.displayBuffer.cursorY).toBe(1);
    });

    it("FF (0x0c) moves cursor down", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("A\x0cB");
      expect(buf.displayBuffer.cursorY).toBe(1);
    });
  });

  describe("Unicode", () => {
    it("writes multi-byte Unicode characters as single cells", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("héllo");
      expect(buf.displayBuffer.cursorX).toBe(5);
      expect(readLine(buf, 0).slice(0, 5)).toBe("héllo");
    });

    it("writes emoji as a single cell", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("A😀B");
      // for...of iterates code points, so emoji is one step
      expect(buf.displayBuffer.cursorX).toBe(3);
      expect(buf.displayBuffer.data[0]?.[1]?.[1]).toBe("😀");
    });
  });

  describe("overwrite", () => {
    it("overwrites existing content when cursor is repositioned", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("hello");
      buf.write("\x1b[1;1H"); // back to start
      buf.write("world");
      expect(readLine(buf, 0).trim()).toBe("world");
    });

    it("partial overwrite leaves rest intact", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("ABCDE");
      buf.write("\x1b[1;1H"); // back to start
      buf.write("XY");
      expect(readLine(buf, 0).slice(0, 5)).toBe("XYCDE");
    });
  });

  describe("resize shrink", () => {
    it("truncates rows when shrinking", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("line0\r\nline1\r\nline2");
      buf.resize(10, 2);
      expect(buf.displayBuffer.data.length).toBe(2);
    });

    it("truncates cols when shrinking", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("ABCDEFGH");
      buf.resize(5, 3);
      expect(buf.displayBuffer.data[0]?.length).toBe(5);
      expect(readLine(buf, 0)).toBe("ABCDE");
    });
  });

  describe("alternate screen", () => {
    it("entering alternate screen clears and resets cursor", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("hello\r\nworld");
      buf.write("\x1b[?1049h"); // enter alt screen
      expect(buf.displayBuffer.cursorX).toBe(0);
      expect(buf.displayBuffer.cursorY).toBe(0);
      expect(readScreen(buf, 3)).toEqual(["", "", ""]);
    });

    it("leaving alternate screen also clears and resets cursor", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("\x1b[?1049h");
      buf.write("alt content");
      buf.write("\x1b[?1049l"); // leave alt screen
      expect(buf.displayBuffer.cursorX).toBe(0);
      expect(buf.displayBuffer.cursorY).toBe(0);
      expect(readScreen(buf, 3)).toEqual(["", "", ""]);
    });
  });
});
