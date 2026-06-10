import { describe, expect, it } from "vitest";

import { AS001 } from "./AS001.js";

describe("AS001", () => {
  const messages = (source: string) => AS001(source).map((diagnostic) => diagnostic.message);

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

    expect(AS001("/value+/gi")).toEqual([]);

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

  it("reports disallowed syntax inside nested expression positions", () => {
    expect(messages("const value = { nested: new Example() };")).toEqual([
      "Disallowed syntax: new."
    ]);
    expect(messages("const value = `${new Example()}`;")).toEqual(["Disallowed syntax: new."]);
    expect(messages("const read = (value = Function('return 1')) => value;")).toEqual([
      "Disallowed syntax: Function."
    ]);
  });

  it("reports disallowed syntax in binding defaults and catch patterns", () => {
    expect(messages("const { value = new Example() } = input;")).toEqual([
      "Disallowed syntax: new."
    ]);
    expect(
      messages("try { work(); } catch ({ recover = Function('return 1') }) { recover(); }")
    ).toEqual(["Disallowed syntax: Function."]);
  });

  it("reports disallowed syntax at file boundaries and exported nested arrows", () => {
    expect(messages("new Example();")).toEqual(["Disallowed syntax: new."]);
    expect(messages("const done = true;\nFunction('return 1')")).toEqual([
      "Disallowed syntax: Function."
    ]);
    expect(messages("export default () => () => this.value;")).toEqual([
      "Disallowed syntax: this."
    ]);
  });

  it("reports disallowed syntax nested inside conditional and logical expressions", () => {
    expect(messages("const value = ready ? ok : new Example();")).toEqual([
      "Disallowed syntax: new."
    ]);
    expect(messages("const value = ready && Function('return 1');")).toEqual([
      "Disallowed syntax: Function."
    ]);
  });

  it("reports disallowed syntax inside array binding defaults and computed pattern keys", () => {
    expect(messages("const [value = /fallback/] = input;")).toEqual([]);
    expect(messages("const { [Function('return key')]: value } = input;")).toEqual([
      "Disallowed syntax: Function."
    ]);
  });

  it("reports disallowed syntax inside exported arrow block bodies", () => {
    expect(messages("export default () => { return class Example {}; };")).toEqual([
      "Disallowed syntax: class."
    ]);
  });
});
