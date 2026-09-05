import { describe, expect, it } from "vitest";

import { parse, parseModule } from "./parser.js";
import { tokenize } from "./tokenizer.js";

describe("generator parsing", () => {
  it("reserves yield as a keyword", () => {
    expect(tokenize("yield")[0]).toMatchObject({ type: "keyword", value: "yield" });
    expect(() => parse("const yield = 1")).toThrow();
    expect(() => parse("function* values(yield) {}")).toThrow();
  });

  it("parses generator declarations and expressions", () => {
    expect(parse("function* values(input) { yield input; return yield* rest; }")).toMatchObject({
      type: "FunctionDeclaration",
      async: false,
      generator: true,
      id: { name: "values" },
      body: {
        body: [
          {
            type: "ExpressionStatement",
            expression: {
              type: "YieldExpression",
              delegate: false,
              argument: { type: "Identifier", name: "input" }
            }
          },
          {
            type: "ReturnStatement",
            argument: {
              type: "YieldExpression",
              delegate: true,
              argument: { type: "Identifier", name: "rest" }
            }
          }
        ]
      }
    });

    expect(parse("const values = function* named() { yield; }")).toMatchObject({
      declarations: [
        {
          init: {
            type: "FunctionExpression",
            async: false,
            generator: true,
            id: { name: "named" },
            body: {
              body: [
                {
                  expression: {
                    type: "YieldExpression",
                    argument: undefined,
                    delegate: false
                  }
                }
              ]
            }
          }
        }
      ]
    });
  });

  it("keeps yield scoped to the current generator body", () => {
    expect(() => parse("yield 1")).toThrowError("yield is only valid inside a generator body");
    expect(() => parse("function regular() { yield 1; }")).toThrowError(
      "yield is only valid inside a generator body"
    );
    expect(() => parse("function* outer() { function inner() { yield 1; } }")).toThrowError(
      "yield is only valid inside a generator body"
    );
    expect(() => parse("function* outer() { const inner = () => yield 1; }")).toThrowError(
      "yield is only valid inside a generator body"
    );
  });

  it("applies yield line terminator rules", () => {
    expect(parse("function* values() { yield\nitem; }")).toMatchObject({
      body: {
        body: [
          {
            expression: {
              type: "YieldExpression",
              argument: undefined,
              delegate: false
            }
          },
          {
            expression: { type: "Identifier", name: "item" }
          }
        ]
      }
    });
    expect(() => parse("function* values() { yield\n* items; }")).toThrow();
  });

  it("rejects unsupported generator forms with targeted errors", () => {
    expect(() => parse("function* values() { await task(); }")).toThrowError(
      "generators cannot await; use a regular async function"
    );
    expect(() => parse("async function* values() {}")).toThrowError(
      "async function* is not supported"
    );
    expect(() => parse("({ *values() {} })")).toThrowError(
      "Generator shorthand methods are not supported"
    );
    expect(() => parse("({ async *values() {} })")).toThrowError(
      "Generator shorthand methods are not supported"
    );
    expect(() => parse("*() => 1")).toThrow();
  });

  it("assigns node ids to yield expressions and their arguments", () => {
    const declaration = parseModule("function* values() { yield item; }").body[0];
    expect(declaration).toMatchObject({
      nodeId: 1,
      body: {
        body: [
          {
            expression: {
              type: "YieldExpression",
              nodeId: expect.any(Number),
              argument: {
                type: "Identifier",
                nodeId: expect.any(Number)
              }
            }
          }
        ]
      }
    });
  });

  it.each([
    "`${yield 1}`",
    "tag`${yield 1}`",
    "`${`${yield 1}`}`",
    "tag`${`${yield 1}`}`",
    "`${tag`${yield 1}`}`",
    "`${yield* [1, 2]}`",
    "`${yield}`",
    "`${yield 1}${yield 2}`"
  ])("inherits generator context in %s", (expression) => {
    // ECMAScript 2026 13.2.8 passes ?Yield into every substitution.
    expect(() => parse(`function* values() { return ${expression}; }`)).not.toThrow();
  });

  it.each([
    "`${yield 1}`",
    "function regular() { return `${yield 1}`; }",
    "function* outer() { return `${(() => yield 1)()}`; }",
    "function* outer() { return `${(function() { return yield 1; })()}`; }",
    "function* outer() { return `${({ method() { return yield 1; } }).method()}`; }",
    "function* values(input = `${yield 1}`) {}",
    "function* values() { return `${await task()}`; }",
    "function* values() { return tag`${await task()}`; }",
    "function* values() { return `${`${await task()}`}`; }"
  ])("does not bypass function boundaries through templates: %s", (source) => {
    expect(() => parse(source)).toThrow();
  });

  it.each([
    "function* values() { return `${(async () => await task())()}`; }",
    "function* values() { return `${(async function() { return await task(); })()}`; }",
    "function regular() { return `${(function*() { yield 1; })().next().value}`; }",
    "function* values() { return `${(() => 1)()}${yield 2}`; }"
  ])("restores context after a nested function: %s", (source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it("rebases template yield spans and assigns node ids", () => {
    expect(parseModule("function* values() {\n  return `${yield 1}`;\n}").body[0]).toMatchObject({
      body: {
        body: [{
          argument: {
            type: "TemplateLiteral",
            expressions: [{
              type: "YieldExpression",
              nodeId: expect.any(Number),
              span: { start: { line: 2, column: 13 }, end: { line: 2, column: 20 } }
            }]
          }
        }]
      }
    });
  });

  it.each([
    "function(value = yield 1) {}",
    "(value = yield 1) => value",
    "({ method(value = yield 1) {} })",
    "function* nested(value = yield 1) {}",
    "function({ [yield 1]: value }) {}",
    "function(value = `${yield 1}`) {}"
  ].flatMap(expression => [false, true].map(template => ({ expression, template }))))(
    "rejects parameter yield in $expression, template=$template", ({ expression, template }) => {
      const value = template ? "`${" + expression + "}`" : expression;
      expect(() => parse(`function* outer() { const value = ${value}; }`)).toThrow();
    }
  );

  it.each([
    "function f(value = await 1) {}",
    "async function f(value = await 1) {}",
    "const f = (value = await 1) => value",
    "const f = async (value = await 1) => value",
    "function* f(value = await 1) {}",
    "function f(value = `${await 1}`) {}"
  ])("rejects direct await in function parameters: %s", source => {
    expect(() => parse(source)).toThrow();
  });

  it.each([
    "function f(value = function*() { yield 1; }) {}",
    "function f(value = async () => await 1) {}",
    "function* outer() { const f = (value = function*() { return `${yield 1}`; }) => value; yield 2; }",
    "function* outer() { return `${function(value = async () => await 1) {}}`; }"
  ])("allows nested function bodies inside parameters: %s", source => {
    expect(() => parse(source)).not.toThrow();
  });
});
