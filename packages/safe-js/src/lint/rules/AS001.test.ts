import { describe, expect, it } from "vitest";

import { AS001 } from "./AS001.js";

describe("AS001", () => {
  const messages = (source: string) => AS001(source).map((diagnostic) => diagnostic.message);

  it.each([
    "first: if (true) { break first; }",
    "second: switch (value) { case 1: break second; }",
    "third: value++;",
    "eval: value++;",
    "exit: { break exit; }",
    "first: second: { break first; }",
    "exit: /* block */ { break exit; }",
    "first: /* nested */ second: /* block */ { break second; }"
  ])("allows supported labeled blocks in %s", source => {
    expect(AS001(source)).toEqual([]);
  });

  it("checks forbidden operations inside labeled statements", () => {
    expect(messages('label: with (context) value')).toContain("Disallowed syntax: with.");
  });

  it.each([
    "new Promise(resolve => resolve(1))",
    "new /* executor */ Promise(() => {})",
    "new RegExp('x')",
    "const Constructor = Promise; new Constructor(() => {});",
    "new constructors.Promise(() => {})",
    "new Map()",
    "new Set()"
  ])("allows constructor expressions in %s", (source) => {
    expect(AS001(source)).toEqual([]);
  });

  it.each(["new PromiseLike()", "new RegExpLike()"])(
    "leaves dynamic constructor resolution to the runtime in %s",
    (source) => {
      expect(messages(source)).toEqual([]);
    }
  );

  it.each(["\n", "\r\n", "\r"])("counts %j line endings in diagnostic spans", (newline) => {
    const source = `const value = 1;${newline}  with (context) value;`;
    expect(AS001(source)).toEqual([
      expect.objectContaining({
        line: 2,
        column: 3,
        span: {
          start: { line: 2, column: 3, offset: source.indexOf("with") },
          end: { line: 2, column: 7, offset: source.indexOf("with") + 4 }
        }
      })
    ]);
  });

  it("reports each disallowed construct with its source span", () => {
    expect(AS001("function example() {}", { filename: "rule.js" })).toEqual([]);
    expect(AS001("function* example() {}")).toEqual([]);

    expect(AS001("class Example {}")).toEqual([]);

    expect(AS001("new Example()")).toEqual([]);

    expect(AS001("this.value")).toEqual([]);
    expect(AS001("var value = 1")).toEqual([]);
    expect(AS001("switch (value) { case 1: break; default: break; }")).toEqual([]);

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

    expect(AS001("label: value")).toEqual([]);

    expect(AS001("/value+/gi")).toEqual([]);

    expect(AS001("eval(value)")).toEqual([]);
    expect(AS001("Function('return 1')")).toEqual([]);
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

    expect(AS001(source)).toEqual([]);
  });

  it("does not confuse division with regex literals", () => {
    expect(AS001("value / total")).toEqual([]);
  });

  it.each([
    "const object = { *items() {} };",
    'const object = { *["items"]() {} };',
    "class Collection { *items() {} }"
  ])("admits synchronous generator methods: %s", (source) => {
    expect(AS001(source)).toEqual([]);
  });

  it("admits async generator shorthand methods", () => {
    expect(AS001("const object = { async *items() {} };")).toEqual([]);
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

    expect(AS001(source)).toEqual([]);
  });

  it("allows dynamic source inside nested expression positions", () => {
    expect(messages("const value = { nested: new Function() };")).toEqual([]);
    expect(messages("const value = `${new Function()}`;")).toEqual([]);
    expect(messages("const read = (value = Function('return 1')) => value;")).toEqual([]);
  });

  it("allows dynamic source in binding defaults and catch patterns", () => {
    expect(messages("const { value = new Function() } = input;")).toEqual([]);
    expect(
      messages("try { work(); } catch ({ recover = Function('return 1') }) { recover(); }")
    ).toEqual([]);
  });

  it("allows dynamic source at file boundaries and exported nested arrows", () => {
    expect(messages("new Function();")).toEqual([]);
    expect(messages("const done = true;\nFunction('return 1')")).toEqual([]);
    expect(messages("export default () => () => eval(value);")).toEqual([]);
  });

  it("allows dynamic source nested inside conditional and logical expressions", () => {
    expect(messages("const value = ready ? ok : new Function();")).toEqual([]);
    expect(messages("const value = ready && Function('return 1');")).toEqual([]);
  });

  it("allows dynamic source inside array binding defaults and computed pattern keys", () => {
    expect(messages("const [value = /fallback/] = input;")).toEqual([]);
    expect(messages("const { [Function('return key')]: value } = input;")).toEqual([]);
  });

  it("allows dynamic source inside exported arrow block bodies", () => {
    expect(messages("export default () => { return class Example { read() { return eval('7'); } }; };")).toEqual([]);
  });
});
