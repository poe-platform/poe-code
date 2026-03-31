import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";

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
