import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi-parser.js";

describe("parseAnsi", () => {
  it("returns a single run for plain text", () => {
    expect(parseAnsi("hello")).toEqual([
      {
        text: "hello",
        fg: null,
        bg: null,
        bold: false,
        italic: false,
        underline: false,
        dim: false
      }
    ]);
  });

  it("parses bold text", () => {
    expect(parseAnsi("\u001b[1mhello")).toEqual([
      {
        text: "hello",
        fg: null,
        bg: null,
        bold: true,
        italic: false,
        underline: false,
        dim: false
      }
    ]);
  });

  it("parses ansi4 foreground colors", () => {
    expect(parseAnsi("\u001b[31mhello")).toEqual([
      {
        text: "hello",
        fg: { type: "ansi4", index: 1 },
        bg: null,
        bold: false,
        italic: false,
        underline: false,
        dim: false
      }
    ]);
  });

  it("parses ansi8 foreground colors", () => {
    expect(parseAnsi("\u001b[38;5;201mhello")).toEqual([
      {
        text: "hello",
        fg: { type: "ansi8", index: 201 },
        bg: null,
        bold: false,
        italic: false,
        underline: false,
        dim: false
      }
    ]);
  });

  it("parses rgb foreground colors", () => {
    expect(parseAnsi("\u001b[38;2;12;34;56mhello")).toEqual([
      {
        text: "hello",
        fg: { type: "rgb", r: 12, g: 34, b: 56 },
        bg: null,
        bold: false,
        italic: false,
        underline: false,
        dim: false
      }
    ]);
  });

  it("parses background colors", () => {
    expect(parseAnsi("\u001b[48;5;42mhello")).toEqual([
      {
        text: "hello",
        fg: null,
        bg: { type: "ansi8", index: 42 },
        bold: false,
        italic: false,
        underline: false,
        dim: false
      }
    ]);
  });

  it("handles nested style changes and reset", () => {
    expect(parseAnsi("a\u001b[1mb\u001b[31mc\u001b[0md")).toEqual([
      {
        text: "a",
        fg: null,
        bg: null,
        bold: false,
        italic: false,
        underline: false,
        dim: false
      },
      {
        text: "b",
        fg: null,
        bg: null,
        bold: true,
        italic: false,
        underline: false,
        dim: false
      },
      {
        text: "c",
        fg: { type: "ansi4", index: 1 },
        bg: null,
        bold: true,
        italic: false,
        underline: false,
        dim: false
      },
      {
        text: "d",
        fg: null,
        bg: null,
        bold: false,
        italic: false,
        underline: false,
        dim: false
      }
    ]);
  });

  it("represents newlines as styled runs", () => {
    expect(parseAnsi("a\n\u001b[1mb\nc")).toEqual([
      {
        text: "a",
        fg: null,
        bg: null,
        bold: false,
        italic: false,
        underline: false,
        dim: false
      },
      {
        text: "\n",
        fg: null,
        bg: null,
        bold: false,
        italic: false,
        underline: false,
        dim: false
      },
      {
        text: "b",
        fg: null,
        bg: null,
        bold: true,
        italic: false,
        underline: false,
        dim: false
      },
      {
        text: "\n",
        fg: null,
        bg: null,
        bold: true,
        italic: false,
        underline: false,
        dim: false
      },
      {
        text: "c",
        fg: null,
        bg: null,
        bold: true,
        italic: false,
        underline: false,
        dim: false
      }
    ]);
  });
});
