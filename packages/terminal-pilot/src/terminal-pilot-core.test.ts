import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import * as api from "./index.js";
import { keyToSequence, type TerminalKey } from "./keys.js";
import { TerminalBuffer } from "./terminal-buffer.js";
import { TerminalPilot } from "./terminal-pilot.js";
import { TerminalScreen } from "./terminal-screen.js";
import { TerminalSession } from "./terminal-session.js";

const testingDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "testing");
const testCliPath = path.join(testingDirectory, "test-cli.js");

const NAMED_KEYS = [
  ["Enter", "\r"],
  ["Tab", "\t"],
  ["Escape", "\x1b"],
  ["Backspace", "\x7f"],
  ["Delete", "\x1b[3~"],
  ["ArrowUp", "\x1b[A"],
  ["ArrowDown", "\x1b[B"],
  ["ArrowRight", "\x1b[C"],
  ["ArrowLeft", "\x1b[D"],
  ["Home", "\x1b[H"],
  ["End", "\x1b[F"],
  ["PageUp", "\x1b[5~"],
  ["PageDown", "\x1b[6~"],
  ["Space", " "]
] as const satisfies ReadonlyArray<readonly [TerminalKey, string]>;

const CONTROL_LETTERS = "abcdefghijklmnopqrstuvwxyz";

function readLine(buf: TerminalBuffer, row: number): string {
  const cells = buf.displayBuffer.data[row] ?? [];
  return cells.map((c) => c?.[1] ?? " ").join("");
}

function readScreen(buf: TerminalBuffer, rows: number): string[] {
  return Array.from({ length: rows }, (_, i) => readLine(buf, i).trimEnd());
}

function createSessionOptions() {
  return {
    command: process.execPath,
    args: [testCliPath],
    cwd: process.cwd(),
    observe: false
  };
}

function createSession(id: string) {
  return new TerminalSession({
    id,
    command: process.execPath,
    args: [testCliPath],
    cwd: process.cwd(),
    env: process.env,
    cols: 80,
    rows: 24,
    observe: false
  });
}

// === ansi.test.ts ===

describe("stripAnsi", () => {
  it("passes plain text through unchanged", () => {
    expect(stripAnsi("plain text 123")).toBe("plain text 123");
  });

  it("removes SGR color and style sequences", () => {
    expect(stripAnsi("prefix \x1b[31;1mred\x1b[0m suffix")).toBe("prefix red suffix");
  });

  it("removes cursor movement and erase CSI sequences", () => {
    expect(stripAnsi("hello\x1b[2A\x1b[2K\x1b[12;4Hworld\x1b[J")).toBe("helloworld");
  });

  it("removes 8-bit CSI sequences", () => {
    expect(stripAnsi("start\x9b2Kmiddle\x9b1;34mend")).toBe("startmiddleend");
  });

  it("removes OSC sequences terminated by BEL", () => {
    expect(stripAnsi("\x1b]0;Terminal title\x07prompt")).toBe("prompt");
  });

  it("removes OSC sequences terminated by ST", () => {
    expect(stripAnsi("\x1b]2;Another title\x1b\\done")).toBe("done");
  });

  it("removes 8-bit OSC sequences", () => {
    expect(stripAnsi("before\x9d0;Title\x07after")).toBe("beforeafter");
  });

  it("removes non-OSC string commands terminated by ST", () => {
    expect(stripAnsi("A\x1bP1;2|payload\x1b\\B\x9fignored\x9cC")).toBe("ABC");
  });

  it("removes OSC 8 hyperlink markers while preserving linked text", () => {
    expect(stripAnsi("open \x1b]8;;https://example.com\x07docs\x1b]8;;\x07 now")).toBe(
      "open docs now"
    );
  });

  it("removes single-character escape sequences", () => {
    expect(stripAnsi("A\x1b7B\x1b8C\x1bcD")).toBe("ABCD");
  });

  it("drops unfinished control sequences that run to end of input", () => {
    expect(stripAnsi("prefix\x1b[31")).toBe("prefix");
    expect(stripAnsi("prefix\x1b]0;title")).toBe("prefix");
    expect(stripAnsi("prefix\x90payload")).toBe("prefix");
  });

  it("removes nested ANSI sequences while preserving surrounding text", () => {
    expect(stripAnsi("A\x1b[31mred\x1b]0;Title\x07\x1b[1;4m!\x1b[0m\x1b[?25lB")).toBe("Ared!B");
  });
});

// === index.test.ts ===

describe("terminal-pilot public entry point", () => {
  it("re-exports the public runtime API through the package entry point", () => {
    expect(api).toHaveProperty("TerminalPilot", TerminalPilot);
    expect(api).toHaveProperty("TerminalSession", TerminalSession);
    expect(api).toHaveProperty("TerminalScreen", TerminalScreen);
  });

  it("keeps type-only exports out of the runtime namespace", () => {
    expect(api).not.toHaveProperty("TerminalKey");
    expect(api).not.toHaveProperty("NewSessionOptions");
    expect(api).not.toHaveProperty("WaitForOptions");
    expect(api).not.toHaveProperty("HistoryOptions");
  });
});

// === keys.test.ts ===

describe("keyToSequence", () => {
  it.each(NAMED_KEYS)("maps %s to the expected sequence", (key, expected) => {
    expect(keyToSequence(key)).toBe(expected);
  });

  it("maps every Control+<letter> key using the ASCII control-code formula", () => {
    for (const letter of CONTROL_LETTERS) {
      const key = `Control+${letter}` as TerminalKey;
      const expected = String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64);

      expect(keyToSequence(key)).toBe(expected);
      expect(keyToSequence(`Control+${letter.toUpperCase()}` as TerminalKey)).toBe(expected);
    }
  });

  it.each([
    ["Alt+x", "\x1bx"],
    ["Alt+X", "\x1bX"],
    ["Alt+?", "\x1b?"],
    ["Alt+Enter", "\x1b\r"],
    ["Alt+Space", "\x1b "],
    ["Alt+Delete", "\x1b\x1b[3~"],
    ["Alt+ArrowUp", "\x1b\x1b[A"],
    ["Alt+Control+c", "\x1b\x03"],
    ["Alt+Control+Z", "\x1b\x1a"],
    ["Alt+Alt+x", "\x1b\x1bx"]
  ] as const)("prefixes %s with escape", (key, expected) => {
    expect(keyToSequence(key)).toBe(expected);
  });

  it.each([
    ["enter", "\r"],
    ["ENTER", "\r"],
    ["arrowup", "\x1b[A"],
    ["ARROWDOWN", "\x1b[B"],
    ["space", " "],
    ["escape", "\x1b"],
    ["BACKSPACE", "\x7f"]
  ] as const)("maps case-insensitive key %s to expected sequence", (key, expected) => {
    expect(keyToSequence(key as TerminalKey)).toBe(expected);
  });

  it.each([
    ["control+c", "\x03"],
    ["CONTROL+C", "\x03"],
    ["alt+enter", "\x1b\r"],
    ["ALT+ENTER", "\x1b\r"]
  ] as const)("maps case-insensitive modifier key %s to expected sequence", (key, expected) => {
    expect(keyToSequence(key as TerminalKey)).toBe(expected);
  });

  it("maps a single printable character to itself", () => {
    expect(keyToSequence("i" as TerminalKey)).toBe("i");
    expect(keyToSequence("a" as TerminalKey)).toBe("a");
    expect(keyToSequence("Z" as TerminalKey)).toBe("Z");
    expect(keyToSequence("!" as TerminalKey)).toBe("!");
  });

  it.each([
    "Unknown",
    "Control+",
    "Control+1",
    "Control+ab",
    "Control+Enter",
    "Control+?",
    "Alt+",
    "Alt+Unknown",
    "Alt+Control+",
    "Alt+Control+1"
  ])("throws for unsupported key %s", (key) => {
    expect(() => keyToSequence(key as TerminalKey)).toThrow(
      `Unknown terminal key: ${key}. Valid keys:`
    );
  });
});

// === terminal-buffer.test.ts ===

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

    it("attaches combining marks without advancing the cursor", () => {
      const buf = new TerminalBuffer(10, 2);
      buf.write("e\u0301X");

      expect(buf.renderLine(0)).toBe("e\u0301X");
      expect(buf.displayBuffer.cursorX).toBe(2);
      expect(buf.displayBuffer.cursorY).toBe(0);

      const overwrite = new TerminalBuffer(10, 2);
      overwrite.write("e\u0301\u001b[2GZ");

      expect(overwrite.renderLine(0)).toBe("e\u0301Z");
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

    it("uses custom tab stops configured with HTS", () => {
      const buf = new TerminalBuffer(20, 2);
      buf.write("A\x1bH\r\tB");
      expect(readLine(buf, 0).trimEnd()).toBe("AB");
    });
  });

  describe("auto-wrap", () => {
    it("defers wrapping until the next printable character", () => {
      const buf = new TerminalBuffer(5, 5);
      buf.write("ABCDE"); // fills row 0
      expect(buf.displayBuffer.cursorX).toBe(4);
      expect(buf.displayBuffer.cursorY).toBe(0);

      buf.write("F");
      expect(buf.displayBuffer.cursorX).toBe(1);
      expect(buf.displayBuffer.cursorY).toBe(1);
    });

    it("cancels pending wrap before a carriage return rewrite", () => {
      const buf = new TerminalBuffer(3, 2);

      buf.write("abc\rX");

      expect(readScreen(buf, 2)).toEqual(["Xbc", ""]);
      expect(buf.displayBuffer.cursorY).toBe(0);
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

    it("respects DECSET/DECRST auto-wrap mode", () => {
      const buf = new TerminalBuffer(5, 3);

      buf.write("\x1b[?7lABCDE");
      expect(buf.displayBuffer.cursorX).toBe(4);
      expect(buf.displayBuffer.cursorY).toBe(0);

      buf.write("Z");
      expect(readLine(buf, 0).slice(0, 5)).toBe("ABCDZ");
      expect(buf.displayBuffer.cursorX).toBe(4);
      expect(buf.displayBuffer.cursorY).toBe(0);

      buf.write("\x1b[?7hY");
      expect(readLine(buf, 0).slice(0, 5)).toBe("ABCDY");
      expect(buf.displayBuffer.cursorX).toBe(4);
      expect(buf.displayBuffer.cursorY).toBe(0);

      buf.write("Z");
      expect(readLine(buf, 1).slice(0, 1)).toBe("Z");
      expect(buf.displayBuffer.cursorX).toBe(1);
      expect(buf.displayBuffer.cursorY).toBe(1);
    });

    it("restores auto-wrap saved by DEC cursor state", () => {
      const buf = new TerminalBuffer(3, 2);

      buf.write("\x1b[?7l\x1b7\x1b[?7h\x1b8abcd");

      expect(readScreen(buf, 2)).toEqual(["abd", ""]);
    });

    it("restores auto-wrap after full reset", () => {
      const buf = new TerminalBuffer(3, 2);

      buf.write("\x1b[?7l\x1bcabcd");

      expect(readScreen(buf, 2)).toEqual(["abc", "d"]);
    });

    it("restores auto-wrap after DEC soft reset", () => {
      const buf = new TerminalBuffer(3, 2);

      buf.write("\x1b[?7l\x1b[!pabcd");

      expect(readScreen(buf, 2)).toEqual(["abc", "d"]);
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
      buf.write("ABCDE"); // row 0, cursor at col 5
      buf.write("\x1b[1;3H"); // move to row 0, col 2 (0-based)
      buf.write("\x1b[0K"); // erase from col 2 to end
      expect(readLine(buf, 0).trim()).toBe("AB");
    });

    it("CSI 2J clears entire screen", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("hello\r\nworld\r\nfoo");
      buf.write("\x1b[2J");
      expect(readScreen(buf, 3)).toEqual(["", "", ""]);
    });

    it("does not clear the viewport when erasing scrollback", () => {
      const buf = new TerminalBuffer(20, 2);
      buf.write("visible\x1b[3J");
      expect(readLine(buf, 0).trimEnd()).toBe("visible");
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

    it("positions the cursor relative to scroll margins in origin mode", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("top\r\nmid\r\nbot\x1b[2;3r\x1b[?6h\x1b[1;1HX");
      expect(readScreen(buf, 3)).toEqual(["top", "Xid", "bot"]);
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

  describe("DEC controls", () => {
    it("fills the viewport for the alignment test pattern", () => {
      const buf = new TerminalBuffer(4, 2);
      buf.write("X\x1b#8");
      expect(readScreen(buf, 2)).toEqual(["EEEE", "EEEE"]);
    });

    it("inserts printable characters while insert mode is enabled", () => {
      const buf = new TerminalBuffer(8, 2);
      buf.write("ABCDE\x1b[1;3H\x1b[4hX\x1b[4l");
      expect(readLine(buf, 0).trimEnd()).toBe("ABXCDE");
    });

    it("repeats the preceding character for CSI b", () => {
      const buf = new TerminalBuffer(8, 2);
      buf.write("A\x1b[3b");
      expect(readLine(buf, 0).trimEnd()).toBe("AAAA");
    });

    it("renders designated DEC special graphics characters", () => {
      const buf = new TerminalBuffer(8, 2);
      buf.write("\x1b(0q\x1b(Bq");
      expect(readLine(buf, 0).trimEnd()).toBe("─q");
    });

    it("does not replace G0 when designating an inactive charset slot", () => {
      const buf = new TerminalBuffer(8, 2);
      buf.write("\x1b(0q\x1b*Bq");
      expect(readLine(buf, 0).trimEnd()).toBe("──");
    });
  });

  describe("ESC M reverse index", () => {
    it("moves cursor up when not at top margin", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[3;1H"); // row 3
      buf.write("\x1bM"); // reverse index
      expect(buf.displayBuffer.cursorY).toBe(1);
    });

    it("restores rendition saved by DEC cursor state", () => {
      const buf = new TerminalBuffer(10, 2);

      buf.write("A\x1b[31m\x1b7\x1b[0m\x1b[1;5HX\x1b8Y");

      expect(buf.renderLine(0)).toContain("\x1b[31mY");
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
    it.each([
      ["inverse", "7;37", "27;36", "36"],
      ["bold", "1;31", "22;36", "36"],
      ["dim", "2;31", "22;36", "36"],
      ["bold and dim", "1;2;31", "22;36", "36"],
      ["underline", "4;31", "24;36", "36"],
      ["italic", "3;31", "23;36", "36"],
      ["conceal", "8;31", "28;36", "36"],
      ["strikethrough", "9;31", "29;36", "36"],
      ["default foreground", "1;31;44", "39", "1;44"],
      ["default background", "1;31;44", "49", "1;31"],
      ["default colors", "1;31;44", "39;49", "1"],
      ["indexed foreground", "7;38;5;196", "27;38;5;45", "38;5;45"],
      ["truecolor foreground", "7;38;2;255;0;0", "27;38;2;1;255;255", "38;2;1;255;255"]
    ])("round-trips %s disable transitions without leaking prior attributes", (_name, enabled, disabled, expected) => {
      const original = new TerminalBuffer(16, 1);
      original.write(`\x1b[${enabled}mA\x1b[${disabled}mB\x1b[0mC`);

      expect(original.displayBuffer.data[0]?.[1]?.style).toBe(`\x1b[${expected}m`);

      const reconstructed = new TerminalBuffer(16, 1);
      reconstructed.write(original.renderLine(0));

      expect(reconstructed.displayBuffer.data[0]).toEqual(original.displayBuffer.data[0]);
      expect(reconstructed.displayBuffer.data[0]?.map((cell) => cell?.style)).toEqual(
        original.displayBuffer.data[0]?.map((cell) => cell?.style)
      );
      expect(reconstructed.renderLine(0)).toBe(original.renderLine(0));
    });

    it("resets the preceding full style before serializing inverse-off with cyan", () => {
      const buffer = new TerminalBuffer(64, 1);
      buffer.write("\x1b[7;37m INVERSE \x1b[27;36m NORMAL CYAN \x1b[0m DEFAULT ");

      expect(buffer.renderLine(0)).toBe(
        "\x1b[7;37m INVERSE \x1b[0m\x1b[36m NORMAL CYAN \x1b[0m DEFAULT "
      );
    });

    it("preserves SGR styling when reconstructing the visible line", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b[1;31mAB\x1b[0m C\x1b[38;2;162;0;255mD");
      expect(readLine(buf, 0).slice(0, 2)).toBe("AB");
      expect(readLine(buf, 0).slice(0, 4)).toBe("AB C");
      expect(buf.displayBuffer.cursorX).toBe(5);
      expect(buf.renderLine(0)).toBe("\x1b[1;31mAB\x1b[0m C\x1b[38;2;162;0;255mD\x1b[0m");
    });

    it("preserves colon-form truecolor styling", () => {
      const buf = new TerminalBuffer(10, 2);

      buf.write("\x1b[38:2::255:0:0mRED");

      expect(buf.renderLine(0)).toBe("\x1b[38;2;255;0;0mRED\x1b[0m");
    });

    it("does not expose concealed text in visible output", () => {
      const buf = new TerminalBuffer(20, 1);

      buf.write("\x1b[8msecret\x1b[28m");

      expect(buf.renderLine(0)).not.toContain("secret");
    });

    it("OSC sequences are consumed without writing characters", () => {
      const buf = new TerminalBuffer(10, 5);
      buf.write("\x1b]0;My Title\x07hello");
      expect(readLine(buf, 0).slice(0, 5)).toBe("hello");
    });

    it("consumes the complete ST terminator for OSC strings", () => {
      const buf = new TerminalBuffer(20, 2);
      buf.write("before\x1b]0;title\x1b\\after");
      expect(readScreen(buf, 2)).toEqual(["beforeafter", ""]);
    });
  });

  describe("control sequence cancellation", () => {
    it("cancels incomplete CSI sequences on CAN", () => {
      const buf = new TerminalBuffer(20, 2);

      buf.write("before\x1b[31\x18afterm!");

      expect(readScreen(buf, 2)).toEqual(["beforeafterm!", ""]);
    });

    it("cancels OSC strings on CAN", () => {
      const buf = new TerminalBuffer(20, 2);

      buf.write("before\x1b]0;title\x18after\x07!");

      expect(readScreen(buf, 2)).toEqual(["beforeafter!", ""]);
    });

    it("cancels DCS strings on CAN", () => {
      const buf = new TerminalBuffer(20, 2);

      buf.write("before\x1bPpayload\x18after\x9c!");

      expect(readScreen(buf, 2)).toEqual(["beforeafter!", ""]);
    });

    it("keeps DCS strings active across bell characters", () => {
      const buf = new TerminalBuffer(20, 2);

      buf.write("before\x1bPsecret\x07leak\x9c!");

      expect(readScreen(buf, 2)).toEqual(["before!", ""]);
    });

    it("starts a replacement escape sequence after ESC inside CSI", () => {
      const buf = new TerminalBuffer(20, 2);

      buf.write("before\x1b[31\x1b[1Gafter");

      expect(readScreen(buf, 2)).toEqual(["aftere", ""]);
    });

    it("handles C1 next-line without rendering a control character", () => {
      const buf = new TerminalBuffer(10, 2);

      buf.write("A\x85B");

      expect(readScreen(buf, 2)).toEqual(["A", "B"]);
    });

    it("ignores DEL bytes in displayed output", () => {
      const buf = new TerminalBuffer(10, 2);

      buf.write("secret\x7f!");

      expect(readScreen(buf, 2)).toEqual(["secret!", ""]);
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
      buf.write("\x1b[1K"); // erase cols 0-3 inclusive
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
      buf.write("\x1b[L"); // insert 1 line
      expect(readLine(buf, 0).trim()).toBe("row0");
      expect(readLine(buf, 1).trim()).toBe("");
      expect(readLine(buf, 2).trim()).toBe("row1");
      expect(readLine(buf, 3).trim()).toBe("row2"); // row3 scrolled off
    });

    it("CSI M deletes lines at cursor row, pulling content up", () => {
      const buf = new TerminalBuffer(10, 4);
      buf.write("row0\r\nrow1\r\nrow2\r\nrow3");
      buf.write("\x1b[2;1H"); // row 1 (0-based)
      buf.write("\x1b[M"); // delete 1 line
      expect(readLine(buf, 0).trim()).toBe("row0");
      expect(readLine(buf, 1).trim()).toBe("row2");
      expect(readLine(buf, 2).trim()).toBe("row3");
      expect(readLine(buf, 3).trim()).toBe("");
    });

    it("ignores insert-lines outside the active scroll region", () => {
      const buf = new TerminalBuffer(10, 4);
      buf.write("head\r\nrow1\r\nrow2\r\nfoot\x1b[2;3r\x1b[1;1H\x1b[L");
      expect(readScreen(buf, 4)).toEqual(["head", "row1", "row2", "foot"]);
    });
  });

  describe("CSI delete/insert characters", () => {
    it("CSI P deletes characters at cursor, shifting rest left", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("ABCDE");
      buf.write("\x1b[1;2H"); // row 0, col 1 (0-based)
      buf.write("\x1b[2P"); // delete 2 chars
      expect(readLine(buf, 0).trimEnd()).toBe("ADE");
    });

    it("CSI @ inserts blank characters at cursor, shifting rest right and truncating at col boundary", () => {
      const buf = new TerminalBuffer(6, 3); // 6 cols: ABCDE fits with 1 spare
      buf.write("ABCDE");
      buf.write("\x1b[1;2H"); // row 0, col 1 (0-based)
      buf.write("\x1b[2@"); // insert 2 blanks — E shifts to col 6, gets truncated
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
      buf.write("\x1bE"); // next line
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

    it("uses two terminal cells for wide emoji", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("A😀B");
      expect(buf.displayBuffer.cursorX).toBe(4);
      expect(buf.displayBuffer.data[0]?.[1]?.[1]).toBe("😀");
      expect(buf.displayBuffer.data[0]?.[3]?.[1]).toBe("B");
    });

    it("uses two terminal cells for wide CJK glyphs", () => {
      const buf = new TerminalBuffer(3, 2);

      buf.write("测AB");

      expect(readScreen(buf, 2)).toEqual(["测 A", "B"]);
      expect(buf.displayBuffer.cursorY).toBe(1);
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

    it("preserves active scrolling margins during resize", () => {
      const buf = new TerminalBuffer(6, 4);
      buf.write("head\r\nrow1\r\nrow2\r\nfoot\x1b[2;3r");
      buf.resize(6, 4);
      buf.write("\x1b[3;1H\n");
      expect(readScreen(buf, 4)).toEqual(["head", "row2", "", "foot"]);
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

    it("restores the primary screen after leaving alternate screen", () => {
      const buf = new TerminalBuffer(10, 3);
      buf.write("primary");
      buf.write("\x1b[?1049h");
      buf.write("alt content");
      buf.write("\x1b[?1049l"); // leave alt screen
      expect(buf.displayBuffer.cursorX).toBe(7);
      expect(buf.displayBuffer.cursorY).toBe(0);
      expect(readScreen(buf, 3)).toEqual(["primary", "", ""]);
    });
  });
});

// === terminal-pilot.test.ts ===

describe("TerminalPilot", () => {
  const pilots: TerminalPilot[] = [];

  afterEach(async () => {
    await Promise.all(
      pilots.map(async (pilot) => {
        try {
          await pilot.close();
        } catch {
          // noop
        }
      })
    );
    pilots.length = 0;
  });

  it("keeps a session tracked when close fails so shutdown can be retried", async () => {
    const pilot = await TerminalPilot.launch();
    const session = await pilot.newSession(createSessionOptions());
    const close = vi
      .spyOn(session, "close")
      .mockRejectedValueOnce(new Error("close temporarily failed"))
      .mockResolvedValueOnce(0);

    await expect(pilot.close()).rejects.toThrow("close temporarily failed");
    expect(pilot.getSession(session.id)).toBe(session);

    await expect(pilot.close()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
    expect(() => pilot.getSession(session.id)).toThrow(`Session not found: ${session.id}`);
  });

  it("creates multiple sessions, lists them, gets them by id, and closes all sessions", async () => {
    const pilot = await TerminalPilot.launch();
    pilots.push(pilot);

    const first = await pilot.newSession(createSessionOptions());
    expect(first.command).toBe(process.execPath);
    const second = await pilot.newSession({
      ...createSessionOptions(),
      cols: 100,
      rows: 30
    });

    expect(first.id).not.toBe(second.id);

    await Promise.all([first.waitFor("What is your name?"), second.waitFor("What is your name?")]);

    expect(pilot.sessions()).toEqual([first, second]);
    const listedSessions = pilot.sessions();
    listedSessions.length = 0;
    expect(pilot.sessions()).toEqual([first, second]);
    expect(pilot.getSession(first.id)).toBe(first);
    expect(pilot.getSession(second.id)).toBe(second);
    expect(() => pilot.getSession("missing-session")).toThrowError(
      "Session not found: missing-session"
    );

    await Promise.all([first.send("Ada\r"), second.send("Grace\r")]);
    await Promise.all([first.waitFor("Hello, Ada!"), second.waitFor("Hello, Grace!")]);
    await expect(first.screen()).resolves.toMatchObject({
      size: { cols: 120, rows: 40 }
    });

    await pilot.close();

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(pilot.sessions()).toEqual([]);
    expect(() => pilot.getSession(first.id)).toThrowError(`Session not found: ${first.id}`);
  });

  it("removes closed sessions from the active session list", async () => {
    const pilot = await TerminalPilot.launch();
    pilots.push(pilot);

    const first = await pilot.newSession(createSessionOptions());
    const second = await pilot.newSession(createSessionOptions());

    await Promise.all([first.waitFor("What is your name?"), second.waitFor("What is your name?")]);
    await first.send("Ada\r");
    await first.waitFor("Hello, Ada!");

    expect(await first.close()).toBe(0);
    pilot.deleteSession(first.id);
    expect(pilot.sessions()).toEqual([second]);
    expect(() => pilot.getSession(first.id)).toThrowError(`Session not found: ${first.id}`);

    await second.send("Grace\r");
    await second.waitFor("Hello, Grace!");
    expect(await second.close()).toBe(0);
    expect(pilot.sessions()).toEqual([]);
  });

  it("removes sessions that exit on their own from the active session list", async () => {
    const pilot = await TerminalPilot.launch();
    pilots.push(pilot);

    const session = await pilot.newSession(createSessionOptions());

    await session.waitFor("What is your name?");
    await session.send("Ada\r");
    await session.waitFor("Hello, Ada!");
    await expect(session.close()).resolves.toBe(0);

    // sessions() only returns running sessions (exitCode === null)
    expect(pilot.sessions()).toEqual([]);
    // Session remains accessible via getSession until explicitly deleted
    expect(pilot.getSession(session.id)).toBe(session);
    pilot.deleteSession(session.id);
    expect(() => pilot.getSession(session.id)).toThrowError(`Session not found: ${session.id}`);
  });

  it("cleans up every tracked session even when some sessions were already closed", async () => {
    const pilot = await TerminalPilot.launch();
    pilots.push(pilot);

    const first = await pilot.newSession(createSessionOptions());
    const second = await pilot.newSession(createSessionOptions());

    await Promise.all([first.waitFor("What is your name?"), second.waitFor("What is your name?")]);
    await first.send("Ada\r");
    await second.send("Grace\r");
    await Promise.all([first.waitFor("Hello, Ada!"), second.waitFor("Hello, Grace!")]);

    expect(await first.close()).toBe(0);

    await expect(pilot.close()).resolves.toBeUndefined();
    await expect(pilot.close()).resolves.toBeUndefined();

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(pilot.sessions()).toEqual([]);
  });
});

// === terminal-screen.test.ts ===

describe("TerminalScreen", () => {
  it("strips ANSI sequences from visible lines and preserves raw lines", () => {
    const screen = new TerminalScreen({
      lines: ["\x1b[32mready\x1b[0m", "plain"],
      rawLines: ["\x1b[32mready\x1b[0m", "plain"],
      cursor: { row: 1, col: 5 },
      size: { rows: 24, cols: 80 }
    });

    expect(screen.lines).toEqual(["ready", "plain"]);
    expect(screen.rawLines).toEqual(["\x1b[32mready\x1b[0m", "plain"]);
  });

  it("joins visible lines into text", () => {
    const screen = new TerminalScreen({
      lines: ["first", "second", "third"],
      rawLines: ["first", "second", "third"],
      cursor: { row: 2, col: 0 },
      size: { rows: 3, cols: 10 }
    });

    expect(screen.text).toBe("first\nsecond\nthird");
  });

  it("supports positive and negative line indexing", () => {
    const screen = new TerminalScreen({
      lines: ["top", "middle", "bottom"],
      rawLines: ["top", "middle", "bottom"],
      cursor: { row: 0, col: 0 },
      size: { rows: 3, cols: 10 }
    });

    expect(screen.line(0)).toBe("top");
    expect(screen.line(1)).toBe("middle");
    expect(screen.line(-1)).toBe("bottom");
    expect(screen.line(-2)).toBe("middle");
    expect(screen.line(-3)).toBe("top");
  });

  it("throws for out-of-bounds line indexes", () => {
    const screen = new TerminalScreen({
      lines: ["only"],
      rawLines: ["only"],
      cursor: { row: 0, col: 0 },
      size: { rows: 1, cols: 10 }
    });

    expect(() => screen.line(1)).toThrow(RangeError);
    expect(() => screen.line(-2)).toThrow(RangeError);
  });

  it("checks whether the visible text contains a substring", () => {
    const screen = new TerminalScreen({
      lines: ["build", "completed successfully"],
      rawLines: ["build", "completed successfully"],
      cursor: { row: 1, col: 10 },
      size: { rows: 2, cols: 40 }
    });

    expect(screen.contains("completed")).toBe(true);
    expect(screen.contains("build\ncompleted")).toBe(true);
    expect(screen.contains("failed")).toBe(false);
  });

  it("creates an immutable snapshot that does not track later input mutations", () => {
    const lines = ["\x1b[36mhello\x1b[0m", "world"];
    const rawLines = ["\x1b[36mhello\x1b[0m", "world"];
    const cursor = { row: 1, col: 3 };
    const size = { rows: 2, cols: 20 };

    const screen = new TerminalScreen({ lines, rawLines, cursor, size });

    lines[0] = "changed";
    rawLines[0] = "changed";
    cursor.row = 99;
    size.cols = 120;

    expect(screen.lines).toEqual(["hello", "world"]);
    expect(screen.rawLines).toEqual(["\x1b[36mhello\x1b[0m", "world"]);
    expect(screen.cursor).toEqual({ row: 1, col: 3 });
    expect(screen.size).toEqual({ rows: 2, cols: 20 });

    expect(Object.isFrozen(screen.lines)).toBe(true);
    expect(Object.isFrozen(screen.rawLines)).toBe(true);
    expect(Object.isFrozen(screen.cursor)).toBe(true);
    expect(Object.isFrozen(screen.size)).toBe(true);

    expect(() => {
      screen.lines[0] = "mutated";
    }).toThrow(TypeError);
    expect(() => {
      screen.cursor.row = 7;
    }).toThrow(TypeError);
  });
});

// === terminal-session.test.ts ===

describe("TerminalSession", () => {
  const sessions: TerminalSession[] = [];

  afterEach(async () => {
    await Promise.all(
      sessions.map(async (session) => {
        try {
          await session.close();
        } catch {
          // noop
        }
      })
    );
    sessions.length = 0;
  });

  it("spawns a session, types input, presses Enter, waits for output, and exposes screen/history", async () => {
    const session = createSession("session-1");
    sessions.push(session);

    expect(session.id).toBe("session-1");
    expect(session.pid).toBeGreaterThan(0);
    expect(session.exitCode).toBeNull();

    const exitEvents: number[] = [];
    session.on("exit", (code) => {
      exitEvents.push(code);
    });

    await session.waitFor("What is your name?");
    await session.type("Ada");
    await session.press("Enter");

    const matched = await session.waitFor(/Hello, Ada!/);
    expect(matched).toContain("Hello, Ada!");

    await session.waitForQuiet(20);

    const screen = await session.screen();
    expect(screen.contains("Hello, Ada!")).toBe(true);
    expect(screen.text).toContain("What is your name?");

    const history = await session.history();
    expect(history.join("\n")).toContain("What is your name?");
    expect(history.join("\n")).toContain("Hello, Ada!");

    const lastLine = await session.history({ last: 1 });
    expect(lastLine).toHaveLength(1);
    expect(lastLine[0]).toContain("Hello, Ada!");

    const code = await session.close();
    expect(code).toBe(0);
    expect(session.exitCode).toBe(0);
    expect(exitEvents).toContain(0);
  });

  it("supports raw send, waitForQuiet, resize, regexp waits, and idempotent close", async () => {
    const session = createSession("session-2");
    sessions.push(session);

    await session.waitFor("What is your name?");
    await session.resize(100, 30);

    const expression = /Hello, Grace!/g;
    await session.send("Grace\r");

    const matched = await session.waitFor(expression);
    expect(matched).toContain("Hello, Grace!");
    expect(expression.lastIndex).toBe(0);

    await session.waitForQuiet(20);

    const screen = await session.screen();
    expect(screen.size).toEqual({ cols: 100, rows: 30 });
    expect(screen.contains("Hello, Grace!")).toBe(true);

    const history = await session.history();
    expect(history.some((line) => line.includes("What is your name?"))).toBe(true);
    expect(history.some((line) => line.includes("Hello, Grace!"))).toBe(true);

    const recentHistory = await session.history({ last: 3 });
    expect(recentHistory.some((line) => line.includes("Hello, Grace!"))).toBe(true);

    expect(await session.close()).toBe(0);
    expect(await session.close()).toBe(0);
  });

  it("lets a process finish cleanly when close is called during its natural shutdown", async () => {
    const session = createSession("session-2b");
    sessions.push(session);

    await session.waitFor("What is your name?");
    await session.send("Grace\r");
    await session.waitFor("Hello, Grace!");

    expect(await session.close()).toBe(0);
    expect(session.exitCode).toBe(0);
  });

  it("handles signals and surfaces the exit code", async () => {
    const session = createSession("session-3");
    sessions.push(session);

    const exitEvents: number[] = [];
    session.on("exit", (code) => {
      exitEvents.push(code);
    });

    await session.waitFor("What is your name?");
    await session.signal("SIGINT");

    const code = await session.close();
    expect(code).toBe(130);
    expect(session.exitCode).toBe(130);
    expect(exitEvents).toContain(130);
  });

  it("fills text with embedded newline, treating \\n as Enter", async () => {
    const session = createSession("session-4a");
    sessions.push(session);

    await session.waitFor("What is your name?");
    await session.fill("Grace\n");
    await session.waitFor("Hello, Grace!");
  });

  it("fills text at once and rejects when waitFor times out", async () => {
    const session = createSession("session-4");
    sessions.push(session);

    await session.waitFor("What is your name?");
    await session.fill("Grace");
    await session.press("Enter");
    await session.waitFor("Hello, Grace!");

    await expect(session.waitFor("This will never appear", { timeout: 150 })).rejects.toThrow(
      /exited before matching pattern/
    );
  });

  it("preserves ANSI styling in raw screen snapshots", async () => {
    const session = new TerminalSession({
      id: "session-ansi",
      command: process.execPath,
      args: ["-e", 'process.stdout.write("\\u001b[38;2;162;0;255mhello\\u001b[0m world\\n")'],
      cwd: process.cwd(),
      env: process.env,
      cols: 80,
      rows: 24,
      observe: false
    });
    sessions.push(session);

    await session.waitFor("hello world");

    const screen = await session.screen();
    expect(screen.lines[0]).toContain("hello world");
    expect(screen.rawLines[0]).toContain("\u001b[38;2;162;0;255mhello\u001b[0m world");
  });
});
