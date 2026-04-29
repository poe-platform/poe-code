import { describe, expect, it } from "vitest";

import { ParseError, formatParseError } from "./format-error.js";

describe("formatParseError", () => {
  it("builds a parse diagnostic with surrounding source context", () => {
    const source = ["() => {", "  const alpha = 1;", "  const beta = );", "  const delta = 4;", "}"].join("\n");
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
      excerpt: ["1 | () => {", "2 |   const alpha = 1;", "3 |   const beta = );", "4 |   const delta = 4;"].join("\n"),
      caret: "  |                ^"
    });
  });

  it("limits context at the start and end of the file", () => {
    const source = ["broken(", "still here", "done"].join("\n");

    expect(
      formatParseError(source, "script.agent.ts", new Error("Unexpected token '(' at line 1, column 7."))
    ).toMatchObject({
      line: 1,
      column: 7,
      excerpt: ["1 | broken(", "2 | still here"].join("\n"),
      caret: "  |       ^"
    });

    expect(
      formatParseError(source, "script.agent.ts", new Error("Unexpected end of input at line 3, column 5."))
    ).toMatchObject({
      line: 3,
      column: 5,
      excerpt: ["1 | broken(", "2 | still here", "3 | done"].join("\n"),
      caret: "  |     ^"
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
      formatParseError(source, "script.agent.ts", new Error("Unexpected token '(' at line 10, column 9."))
    ).toMatchObject({
      line: 10,
      column: 9,
      excerpt: [" 8 | line 8", " 9 | line 9", "10 | \t\tbroken()", "11 | line 11"].join("\n"),
      caret: "   | \t\t      ^"
    });
  });

  it("rethrows errors that do not include a parse location", () => {
    const error = new Error("Boom");

    expect(() => formatParseError("source", "script.agent.ts", error)).toThrow(error);
  });
});
