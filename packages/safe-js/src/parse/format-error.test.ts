import { describe, expect, it } from "vitest";

import { ParseError, formatParseError } from "./format-error.js";

describe("formatParseError", () => {
  it("starts the context window at the file for errors at line 1 column 1", () => {
    const diagnostic = formatParseError(
      ["broken", "still here", "done"].join("\n"),
      "script.agent.ts",
      new Error("Unexpected token 'broken' at line 1, column 1.")
    );

    expect(diagnostic).toMatchObject({
      line: 1,
      column: 1,
      excerpt: ["1 | broken", "2 | still here"].join("\n"),
      caret: "  | ^"
    });
  });

  it("builds a parse diagnostic with surrounding source context", () => {
    const source = [
      "() => {",
      "  const alpha = 1;",
      "  const beta = );",
      "  const delta = 4;",
      "}"
    ].join("\n");
    const diagnostic = formatParseError(
      source,
      "script.agent.ts",
      new Error("Unexpected token ')' at line 3, column 16.")
    );

    expect(diagnostic).toBeInstanceOf(ParseError);
    expect(diagnostic).toMatchObject({
      kind: "ParseError",
      filename: "script.agent.ts",
      line: 3,
      column: 16,
      message: "Unexpected token ')' at line 3, column 16.",
      excerpt: [
        "1 | () => {",
        "2 |   const alpha = 1;",
        "3 |   const beta = );",
        "4 |   const delta = 4;"
      ].join("\n"),
      caret: "  |                ^"
    });
  });

  it("includes the last line when the source has no trailing newline", () => {
    expect(
      formatParseError(
        ["first", "last = )"].join("\n"),
        "script.agent.ts",
        new Error("Unexpected token ')' at line 2, column 8.")
      )
    ).toMatchObject({
      line: 2,
      column: 8,
      excerpt: ["1 | first", "2 | last = )"].join("\n"),
      caret: "  |        ^"
    });
  });

  it("limits context at the start and end of the file", () => {
    const source = ["broken(", "still here", "done"].join("\n");

    expect(
      formatParseError(
        source,
        "script.agent.ts",
        new Error("Unexpected token '(' at line 1, column 7.")
      )
    ).toMatchObject({
      line: 1,
      column: 7,
      excerpt: ["1 | broken(", "2 | still here"].join("\n"),
      caret: "  |       ^"
    });

    expect(
      formatParseError(
        source,
        "script.agent.ts",
        new Error("Unexpected end of input at line 3, column 5.")
      )
    ).toMatchObject({
      line: 3,
      column: 5,
      excerpt: ["1 | broken(", "2 | still here", "3 | done"].join("\n"),
      caret: "  |     ^"
    });
  });

  it("pads gutters for 3-digit line numbers", () => {
    const source = Array.from({ length: 101 }, (_, index) => `line ${index + 1}`).join("\n");

    expect(
      formatParseError(
        source,
        "script.agent.ts",
        new Error("Unexpected token at line 100, column 6.")
      )
    ).toMatchObject({
      line: 100,
      column: 6,
      excerpt: [" 98 | line 98", " 99 | line 99", "100 | line 100", "101 | line 101"].join("\n"),
      caret: "    |      ^"
    });
  });

  it("pads gutters for 4-digit line numbers", () => {
    const source = Array.from({ length: 9_999 }, (_, index) => `line ${index + 1}`).join("\n");

    expect(
      formatParseError(
        source,
        "script.agent.ts",
        new Error("Unexpected token at line 9999, column 6.")
      )
    ).toMatchObject({
      line: 9999,
      column: 6,
      excerpt: ["9997 | line 9997", "9998 | line 9998", "9999 | line 9999"].join("\n"),
      caret: "     |      ^"
    });
  });

  it("pads line numbers and preserves tabs so the caret stays aligned", () => {
    const source = [
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
      "\t\tbroken()",
      "line 11"
    ].join("\n");

    expect(
      formatParseError(
        source,
        "script.agent.ts",
        new Error("Unexpected token '(' at line 10, column 9.")
      )
    ).toMatchObject({
      line: 10,
      column: 9,
      excerpt: [" 8 | line 8", " 9 | line 9", "10 | \t\tbroken()", "11 | line 11"].join("\n"),
      caret: "   | \t\t      ^"
    });
  });

  it("uses character columns for full-width unicode before the error column", () => {
    expect(
      formatParseError(
        "const value = 漢字)",
        "script.agent.ts",
        new Error("Unexpected token ')' at line 1, column 16.")
      )
    ).toMatchObject({
      line: 1,
      column: 16,
      excerpt: "1 | const value = 漢字)",
      caret: "  |                ^"
    });
  });

  it("renders an empty source without panicking", () => {
    expect(
      formatParseError(
        "",
        "script.agent.ts",
        new Error("Unexpected end of input at line 1, column 1.")
      )
    ).toMatchObject({
      line: 1,
      column: 1,
      excerpt: "1 | ",
      caret: "  | ^"
    });
  });

  it("truncates very long single-line excerpts around the error column", () => {
    const source = "a".repeat(5_000) + ")" + "b".repeat(4_999);

    const diagnostic = formatParseError(
      source,
      "script.agent.ts",
      new Error("Unexpected token ')' at line 1, column 5001.")
    );

    expect(diagnostic.excerpt).toHaveLength(124);
    expect(diagnostic.excerpt.startsWith("1 | ...")).toBe(true);
    expect(diagnostic.excerpt.endsWith("...")).toBe(true);
    expect(diagnostic.excerpt).toContain(")");
    expect(diagnostic.caret.startsWith("  | ")).toBe(true);
    expect(diagnostic.caret.indexOf("^")).toBe(diagnostic.excerpt.indexOf(")"));
  });

  it("renders all lines covered by a multiline error span with contiguous caret rules", () => {
    expect(
      formatParseError(
        ["const value = {", "  alpha: 1,", "  beta: 2", "};"].join("\n"),
        "script.agent.ts",
        new Error("Invalid object literal at line 1, column 15 to line 3, column 10.")
      )
    ).toMatchObject({
      line: 1,
      column: 15,
      excerpt: ["1 | const value = {", "2 |   alpha: 1,", "3 |   beta: 2", "4 | };"].join("\n"),
      caret: ["  |               ^", "  | ^^^^^^^^^^^", "  | ^^^^^^^^^"].join("\n")
    });
  });

  it("normalizes CRLF source before aligning carets", () => {
    expect(
      formatParseError(
        "first\r\nsecond = )",
        "script.agent.ts",
        new Error("Unexpected token ')' at line 2, column 10.")
      )
    ).toMatchObject({
      line: 2,
      column: 10,
      excerpt: ["1 | first", "2 | second = )"].join("\n"),
      caret: "  |          ^"
    });
  });

  it("rethrows errors that do not include a parse location", () => {
    const error = new Error("Boom");

    expect(() => formatParseError("source", "script.agent.ts", error)).toThrow(error);
  });
});
