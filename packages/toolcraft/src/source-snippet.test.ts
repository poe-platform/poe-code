import { afterEach, describe, expect, it } from "vitest";
import { resetOutputFormatCache } from "toolcraft-design";
import { renderSourceSnippet } from "./source-snippet.js";

describe("renderSourceSnippet", () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalStderrIsTTY = process.stderr.isTTY;

  afterEach(() => {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: originalStderrIsTTY
    });
    resetOutputFormatCache();
  });

  it("renders a top-of-file context block with an aligned caret", () => {
    expect(
      renderSourceSnippet({
        source: "abcd\nsecond\nthird",
        line: 1,
        column: 5
      })
    ).toBe(["  |", "1 | abcd", "  |     ^", "2 | second", "3 | third", "  |"].join("\n"));
  });

  it("uses the requested context around line 100 in a large file", () => {
    const source = Array.from({ length: 1000 }, (_, index) => `line ${index + 1}`).join("\n");

    expect(
      renderSourceSnippet({
        source,
        line: 100,
        column: 3,
        context: 2
      })
    ).toBe(
      ["    |", " 98 | line 98", " 99 | line 99", "100 | line 100", "    |   ^", "101 | line 101", "102 | line 102", "    |"].join(
        "\n"
      )
    );
  });

  it("omits the caret line when the column is omitted", () => {
    expect(
      renderSourceSnippet({
        source: "one\ntwo\nthree",
        line: 2,
        context: 1
      })
    ).toBe(["  |", "1 | one", "2 | two", "3 | three", "  |"].join("\n"));
  });

  it("does not emit ANSI styling when stderr is not a TTY", () => {
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: false
    });
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();

    const snippet = renderSourceSnippet({
      source: "one\ntwo",
      line: 2,
      column: 1
    });

    expect(snippet).not.toContain("\u001b[");
  });

  it("keeps the caret source column stable with multi-digit line numbers", () => {
    const source = Array.from({ length: 101 }, (_, index) => `line ${index + 1}`).join("\n");

    const firstLineSnippet = renderSourceSnippet({
      source,
      line: 1,
      column: 3,
      context: 0
    });
    const hundredthLineSnippet = renderSourceSnippet({
      source,
      line: 100,
      column: 3,
      context: 0
    });

    const firstCaretLine = firstLineSnippet.split("\n").find((line) => line.includes("^")) ?? "";
    const hundredthCaretLine =
      hundredthLineSnippet.split("\n").find((line) => line.includes("^")) ?? "";

    expect(firstCaretLine.indexOf("^") - firstCaretLine.indexOf("|")).toBe(
      hundredthCaretLine.indexOf("^") - hundredthCaretLine.indexOf("|")
    );
  });
});
