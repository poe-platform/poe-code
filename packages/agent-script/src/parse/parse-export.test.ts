import { describe, expect, it } from "vitest";

import { DisallowedSyntaxError, parse, parseModule } from "./parser.js";

describe("parse exports", () => {
  it("parses supported top-level export declarations in modules", () => {
    expect(parseModule("export const x = 1").body[0]).toMatchObject({
      type: "ExportNamedDeclaration",
      declaration: {
        type: "VariableDeclaration",
        kind: "const",
        declarations: [
          {
            type: "VariableDeclarator",
            id: {
              type: "Identifier",
              name: "x"
            },
            init: {
              type: "NumericLiteral",
              value: 1
            }
          }
        ]
      }
    });

    expect(parseModule("export const schema = S.Object({})").body[0]).toMatchObject({
      type: "ExportNamedDeclaration",
      declaration: {
        type: "VariableDeclaration",
        kind: "const",
        declarations: [
          {
            type: "VariableDeclarator",
            id: {
              type: "Identifier",
              name: "schema"
            },
            init: {
              type: "CallExpression"
            }
          }
        ]
      }
    });

    expect(parseModule("export default async () => 1").body[0]).toMatchObject({
      type: "ExportDefaultDeclaration",
      declaration: {
        type: "ArrowFunctionExpression",
        async: true,
        expression: true
      }
    });

    expect(parseModule("export default () => {}").body[0]).toMatchObject({
      type: "ExportDefaultDeclaration",
      declaration: {
        type: "ArrowFunctionExpression",
        async: false,
        expression: false
      }
    });

    expect(parseModule("export default async x => x").body[0]).toMatchObject({
      type: "ExportDefaultDeclaration",
      declaration: {
        type: "ArrowFunctionExpression",
        async: true,
        expression: true,
        params: [
          {
            type: "Identifier",
            name: "x"
          }
        ]
      }
    });
  });

  it("rejects unsupported export declarations", () => {
    expect(() => parseModule("export function run() {}")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export class Run {}")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule('export * from "tool"')).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export { x }")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export default function () {}")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export default class Run {}")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export default 1")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export const a = 1, b = 2")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export const { x } = value")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export const [x] = value")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export let x = 1")).toThrowError(DisallowedSyntaxError);
  });

  it("rejects duplicate default exports in the same module", () => {
    expect(() => parseModule("export default () => 1; export default () => 2")).toThrowError(
      DisallowedSyntaxError
    );
  });

  it("rejects exports outside module top level", () => {
    expect(() => parse("export const x = 1")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("if (ready) { export const x = 1 }")).toThrowError(
      DisallowedSyntaxError
    );
    expect(() => parseModule("const run = () => { export const x = 1 }")).toThrowError(
      DisallowedSyntaxError
    );
  });
});
