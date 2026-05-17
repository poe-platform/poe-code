import { describe, expect, it } from "vitest";

import { AS001 } from "./AS001.js";

describe("AS001", () => {
  it("reports each disallowed construct with its source span", () => {
    expect(AS001("function example() {}", { filename: "rule.js" })).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: function.",
        filename: "rule.js",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 9, offset: 8 }
        }
      }
    ]);

    expect(AS001("function* example() {}")).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: function.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 9, offset: 8 }
        }
      },
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: generator.",
        filename: "<input>",
        line: 1,
        column: 9,
        span: {
          start: { line: 1, column: 9, offset: 8 },
          end: { line: 1, column: 10, offset: 9 }
        }
      }
    ]);

    expect(AS001("class Example {}")).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: class.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 6, offset: 5 }
        }
      }
    ]);

    expect(AS001("new Example()")).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: new.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 4, offset: 3 }
        }
      }
    ]);

    expect(AS001("this.value")).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: this.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 5, offset: 4 }
        }
      }
    ]);

    expect(AS001("var value = 1")).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: var.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 4, offset: 3 }
        }
      }
    ]);

    expect(AS001("switch (value) { case 1: break; }")).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: switch.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 7, offset: 6 }
        }
      }
    ]);

    expect(AS001("with (context) value")).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: with.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 5, offset: 4 }
        }
      }
    ]);

    expect(AS001("label: value")).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: label.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 6, offset: 5 }
        }
      }
    ]);

    expect(AS001("/value+/gi")).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: regex literal.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 11, offset: 10 }
        }
      }
    ]);

    expect(AS001("eval(value)")).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: eval.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 5, offset: 4 }
        }
      }
    ]);

    expect(AS001("Function('return 1')")).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: Function.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 9, offset: 8 }
        }
      }
    ]);
  });

  it("allows labels on loops", () => {
    expect(AS001("outer: for (;;) { break outer; }")).toEqual([]);
    expect(AS001("outer: inner: while (ready) { continue inner; }")).toEqual([]);
    expect(AS001("outer: do { break outer; } while (ready);")).toEqual([]);
  });

  it("ignores comments, string content, and property names while scanning code", () => {
    const source = [
      "// function class /value/",
      "const value = {",
      '  function: "class",',
      '  class: "new",',
      '  new: "this",',
      '  this: "var",',
      '  eval: "Function"',
      "};",
      "value.function;",
      "value.class;",
      "value.new;",
      "value.this;",
      "value.eval;",
      "value.Function;",
      "`do ${eval(value)} while`;"
    ].join("\n");

    expect(AS001(source)).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: eval.",
        filename: "<input>",
        line: 15,
        column: 7,
        span: {
          start: { line: 15, column: 7, offset: 217 },
          end: { line: 15, column: 11, offset: 221 }
        }
      }
    ]);
  });

  it("does not confuse division with regex literals", () => {
    expect(AS001("value / total")).toEqual([]);
  });

  it("reports generator shorthand methods", () => {
    expect(AS001("const object = { *items() {} };")).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: generator.",
        filename: "<input>",
        line: 1,
        column: 18,
        span: {
          start: { line: 1, column: 18, offset: 17 },
          end: { line: 1, column: 19, offset: 18 }
        }
      }
    ]);
  });

  it("ignores disallowed identifiers when they are only member names", () => {
    const source = [
      "const object = {",
      "  function() {},",
      "  class() {},",
      "  new() {},",
      "  this() {},",
      "  var() {},",
      "  switch() {},",
      "  with() {},",
      "  eval() {},",
      "  Function() {}",
      "};",
      "class Example {",
      "  static eval() {}",
      "  function() {}",
      "  eval() {}",
      "}"
    ].join("\n");

    expect(AS001(source)).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: class.",
        filename: "<input>",
        line: 12,
        column: 1,
        span: {
          start: { line: 12, column: 1, offset: 145 },
          end: { line: 12, column: 6, offset: 150 }
        }
      }
    ]);
  });
});
