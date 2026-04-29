import { describe, expect, it } from "vitest";

import { formatInterpreterError } from "./format.js";

describe("formatInterpreterError", () => {
  it("renders the error header, surrounding context, caret, and message", () => {
    const source = [
      "const alpha = 1;",
      "const beta = 2;",
      "return missingValue;",
      "const omega = 4;"
    ].join("\n");

    expect(
      formatInterpreterError(source, {
        kind: "InterpreterError",
        filename: "script.ajs",
        line: 3,
        column: 8,
        message: "Identifier 'missingValue' is not defined."
      })
    ).toBe(
      [
        "InterpreterError: script.ajs:3:8",
        "",
        "1 | const alpha = 1;",
        "2 | const beta = 2;",
        "3 | return missingValue;",
        "4 | const omega = 4;",
        "  |        ^",
        "",
        "Identifier 'missingValue' is not defined."
      ].join("\n")
    );
  });

  it("clips context at file boundaries and preserves tabs for caret alignment", () => {
    const source = ["line 1", "\t\tvalue()", "line 3"].join("\n");

    expect(
      formatInterpreterError(source, {
        kind: "InterpreterError",
        filename: "script.ajs",
        line: 2,
        column: 5,
        message: "Boom."
      })
    ).toBe(
      [
        "InterpreterError: script.ajs:2:5",
        "",
        "1 | line 1",
        "2 | \t\tvalue()",
        "3 | line 3",
        "  | \t\t  ^",
        "",
        "Boom."
      ].join("\n")
    );
  });

  it("renders the first line without negative context and clamps columns below 1", () => {
    const source = ["alpha()", "beta()", "gamma()"].join("\n");

    expect(
      formatInterpreterError(source, {
        kind: "InterpreterError",
        filename: "script.ajs",
        line: 1,
        column: 0,
        message: "Boom."
      })
    ).toBe(
      [
        "InterpreterError: script.ajs:1:0",
        "",
        "1 | alpha()",
        "2 | beta()",
        "  | ^",
        "",
        "Boom."
      ].join("\n")
    );
  });

  it("renders the last line with two preceding lines of context", () => {
    const source = ["line 1", "line 2", "line 3", "line 4"].join("\n");

    expect(
      formatInterpreterError(source, {
        kind: "InterpreterError",
        filename: "script.ajs",
        line: 4,
        column: 6,
        message: "Unexpected token."
      })
    ).toBe(
      [
        "InterpreterError: script.ajs:4:6",
        "",
        "2 | line 2",
        "3 | line 3",
        "4 | line 4",
        "  |      ^",
        "",
        "Unexpected token."
      ].join("\n")
    );
  });

  it("keeps the caret aligned when the reported column is past the end of the line", () => {
    const source = ["short"].join("\n");

    expect(
      formatInterpreterError(source, {
        kind: "InterpreterError",
        filename: "script.ajs",
        line: 1,
        column: 99,
        message: "Past end."
      })
    ).toBe(
      [
        "InterpreterError: script.ajs:1:99",
        "",
        "1 | short",
        "  |      ^",
        "",
        "Past end."
      ].join("\n")
    );
  });

  it("renders a placeholder line when the reported line is outside the source", () => {
    expect(
      formatInterpreterError("", {
        kind: "InterpreterError",
        filename: "script.ajs",
        line: 3,
        column: 4,
        message: "No source."
      })
    ).toBe(
      [
        "InterpreterError: script.ajs:3:4",
        "",
        "3 | ",
        "  |    ^",
        "",
        "No source."
      ].join("\n")
    );
  });

  it("pads multi-digit line numbers correctly", () => {
    const source = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");

    expect(
      formatInterpreterError(source, {
        kind: "InterpreterError",
        filename: "script.ajs",
        line: 10,
        column: 3,
        message: "Tenth line."
      })
    ).toBe(
      [
        "InterpreterError: script.ajs:10:3",
        "",
        " 8 | line 8",
        " 9 | line 9",
        "10 | line 10",
        "11 | line 11",
        "   |   ^",
        "",
        "Tenth line."
      ].join("\n")
    );
  });
});
