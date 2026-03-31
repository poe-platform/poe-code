import { describe, expect, it } from "vitest";
import { keyToSequence, type TerminalKey } from "./keys.js";

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

describe("keyToSequence", () => {
  it.each(NAMED_KEYS)("maps %s to the expected sequence", (key, expected) => {
    expect(keyToSequence(key)).toBe(expected);
  });

  it("maps every Control+<letter> key using the ASCII control-code formula", () => {
    for (const letter of CONTROL_LETTERS) {
      const key = `Control+${letter}` as TerminalKey;
      const expected = String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64);

      expect(keyToSequence(key)).toBe(expected);
      expect(keyToSequence(`Control+${letter.toUpperCase()}` as TerminalKey)).toBe(
        expected
      );
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
    "Unknown",
    "enter",
    "Control+",
    "Control+1",
    "Control+ab",
    "Control+Enter",
    "Control+?",
    "Alt+",
    "Alt+Unknown",
    "Alt+Control+",
    "Alt+Control+1",
    "Alt+enter"
  ])("throws for unsupported key %s", (key) => {
    expect(() => keyToSequence(key as TerminalKey)).toThrow(
      `Unknown terminal key: ${key}`
    );
  });
});
