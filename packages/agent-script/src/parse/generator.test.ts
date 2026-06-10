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
});
