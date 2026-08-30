import { describe, expect, it } from "vitest";

import { AS_UNREACHABLE } from "./AS-unreachable.js";

function codes(source: string): string[] {
  return AS_UNREACHABLE(source, { filename: "rule.js" }).map((diagnostic) => diagnostic.code);
}

describe("AS_UNREACHABLE", () => {
  it("reports a statement after return", () => {
    expect(codes("const run = () => { return 1; log('unreachable'); };")).toEqual([
      "AS-UNREACHABLE"
    ]);
  });

  it("reports a statement after throw", () => {
    expect(codes("const run = () => { throw 'stop'; log('unreachable'); };")).toEqual([
      "AS-UNREACHABLE"
    ]);
  });

  it("reports a statement after break inside a for-of body", () => {
    const source = "for (const value of values) { break; log(value); }";

    expect(codes(source)).toEqual(["AS-UNREACHABLE"]);
  });

  it("reports a statement after continue inside a for-of body", () => {
    const source = "for (const value of values) { continue; log(value); }";

    expect(codes(source)).toEqual(["AS-UNREACHABLE"]);
  });

  it("reports a trailing statement after an if where both branches return", () => {
    const source =
      "const run = () => { if (ok) { return 1; } else { return 2; } log('unreachable'); };";

    expect(codes(source)).toEqual(["AS-UNREACHABLE"]);
  });

  it("allows a trailing statement after an if where only one branch returns", () => {
    const source = "const run = () => { if (ok) { return 1; } log('reachable'); };";

    expect(codes(source)).toEqual([]);
  });

  it("allows a trailing statement after try when try returns but catch does not", () => {
    const source =
      "const run = () => { try { return 1; } catch (error) { log(error); } log('reachable'); };";

    expect(codes(source)).toEqual([]);
  });

  it("reports a trailing statement after try/finally when try returns and there is no catch", () => {
    const source =
      "const run = () => { try { return 1; } finally { log('cleanup'); } log('unreachable'); };";

    expect(codes(source)).toEqual(["AS-UNREACHABLE"]);
  });

  it("reports a statement after a labeled break to an enclosing loop", () => {
    const source = [
      "outer: for (const value of values) {",
      "  for (const item of value.items) {",
      "    break outer;",
      "    log(item);",
      "  }",
      "}"
    ].join("\n");

    expect(codes(source)).toEqual(["AS-UNREACHABLE"]);
  });

  it("allows an empty block after return", () => {
    const source = "const run = () => { return 1; {} };";

    expect(codes(source)).toEqual([]);
  });

  it("reports a span covering only the first unreachable statement", () => {
    const source = "const run = () => { return 1; first(); second(); };";
    const diagnostic = AS_UNREACHABLE(source, { filename: "rule.js" })[0];
    const start = source.indexOf("first()");

    expect(diagnostic).toEqual({
      code: "AS-UNREACHABLE",
      severity: "warning",
      message: "Statement is unreachable because a prior statement in the same block always exits.",
      filename: "rule.js",
      line: 1,
      column: 31,
      span: {
        start: { line: 1, column: 31, offset: start },
        end: { line: 1, column: 38, offset: start + "first()".length }
      }
    });
  });

  it("understands switch fallthrough and terminal cases", () => {
    expect(
      codes(
        "switch (value) { case 1: first(); case 2: second(); break; unreachable(); default: fallback(); }"
      )
    ).toEqual(["AS-UNREACHABLE"]);
  });

  it("allows a case to flow into the next case", () => {
    expect(
      codes("switch (value) { case 1: first(); case 2: second(); break; default: fallback(); }")
    ).toEqual([]);
  });
});
