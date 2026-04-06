import { describe, expect, it } from "vitest";
import { parseAnsi, type StyledRun } from "./ansi-parser.js";

function createRun(text: string, overrides: Partial<StyledRun> = {}): StyledRun {
  return {
    text,
    fg: null,
    bg: null,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    dim: false,
    ...overrides
  };
}

describe("parseAnsi", () => {
  it("returns a single run for plain text", () => {
    expect(parseAnsi("hello")).toEqual([createRun("hello")]);
  });

  it("parses bold text", () => {
    expect(parseAnsi("\u001b[1mhello")).toEqual([createRun("hello", { bold: true })]);
  });

  it("parses ansi4 foreground colors", () => {
    expect(parseAnsi("\u001b[31mhello")).toEqual([
      createRun("hello", { fg: { type: "ansi4", index: 1 } })
    ]);
  });

  it("parses ansi8 foreground colors", () => {
    expect(parseAnsi("\u001b[38;5;201mhello")).toEqual([
      createRun("hello", { fg: { type: "ansi8", index: 201 } })
    ]);
  });

  it("parses rgb foreground colors", () => {
    expect(parseAnsi("\u001b[38;2;12;34;56mhello")).toEqual([
      createRun("hello", { fg: { type: "rgb", r: 12, g: 34, b: 56 } })
    ]);
  });

  it("parses background colors", () => {
    expect(parseAnsi("\u001b[48;5;42mhello")).toEqual([
      createRun("hello", { bg: { type: "ansi8", index: 42 } })
    ]);
  });

  it("handles nested style changes and reset", () => {
    expect(parseAnsi("a\u001b[1mb\u001b[31mc\u001b[0md")).toEqual([
      createRun("a"),
      createRun("b", { bold: true }),
      createRun("c", { fg: { type: "ansi4", index: 1 }, bold: true }),
      createRun("d")
    ]);
  });

  it("represents newlines as styled runs", () => {
    expect(parseAnsi("a\n\u001b[1mb\nc")).toEqual([
      createRun("a"),
      createRun("\n"),
      createRun("b", { bold: true }),
      createRun("\n", { bold: true }),
      createRun("c", { bold: true })
    ]);
  });

  it("resets individual styles and colors without a full sgr reset", () => {
    expect(parseAnsi("\u001b[35m\u001b[1mhead\u001b[39m\u001b[22m body")).toEqual([
      createRun("head", { fg: { type: "ansi4", index: 5 }, bold: true }),
      createRun(" body")
    ]);
  });

  it("parses strikethrough and clears it with sgr 29", () => {
    expect(parseAnsi("a\u001b[9mb\u001b[29mc")).toEqual([
      createRun("a"),
      createRun("b", { strikethrough: true }),
      createRun("c")
    ]);
  });
});
