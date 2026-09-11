import { describe, expect, it } from "vitest";

import { DisallowedSyntaxError, parse, parseModule } from "./parser.js";
import { ExportExtractionError, extractTopLevelExports } from "./parse-export.js";

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

    expect(
      parseModule("export default async function run(frontmatter) { return frontmatter; }").body[0]
    ).toMatchObject({
      type: "ExportDefaultDeclaration",
      declaration: {
        type: "FunctionDeclaration",
        async: true,
        id: {
          type: "Identifier",
          name: "run"
        },
        params: [
          {
            type: "Identifier",
            name: "frontmatter"
          }
        ]
      }
    });
  });

  it("extracts exported const handlers by name", () => {
    expect(extractTopLevelExports(parseModule("export const handler = () => {}"))).toMatchObject([
      {
        type: "named",
        name: "handler",
        declaration: {
          type: "VariableDeclarator",
          init: {
            type: "ArrowFunctionExpression"
          }
        }
      }
    ]);
  });

  it("extracts exported const schema declarations by name", () => {
    expect(
      extractTopLevelExports(parseModule("export const schema = { value: true }"))
    ).toMatchObject([
      {
        type: "named",
        name: "schema",
        declaration: {
          type: "VariableDeclarator",
          init: {
            type: "ObjectExpression"
          }
        }
      }
    ]);
  });

  it("extracts default exported arrows", () => {
    expect(extractTopLevelExports(parseModule("export default () => {}"))).toMatchObject([
      {
        type: "default",
        name: "default",
        declaration: {
          type: "ArrowFunctionExpression"
        }
      }
    ]);
  });

  it("extracts every declarator from one exported const declaration", () => {
    expect(extractTopLevelExports(parseModule("export const a = 1, b = 2;"))).toMatchObject([
      {
        type: "named",
        name: "a",
        declaration: {
          type: "VariableDeclarator",
          init: {
            type: "NumericLiteral",
            value: 1
          }
        }
      },
      {
        type: "named",
        name: "b",
        declaration: {
          type: "VariableDeclarator",
          init: {
            type: "NumericLiteral",
            value: 2
          }
        }
      }
    ]);
  });

  it("returns no extracted exports when the module has no exports", () => {
    expect(extractTopLevelExports(parseModule("const handler = () => {}"))).toEqual([]);
  });

  it("rejects unsupported export declarations", () => {
    expect(() => parseModule("export function run() {}")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export class Run {}")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule('export * from "tool"')).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("const handler = () => {}; export { handler };")).toThrowError(
      DisallowedSyntaxError
    );
    expect(parseModule("export default class Run {}").body[0]).toMatchObject({
      type: "ExportDefaultDeclaration",
      declaration: { type: "ClassDeclaration", id: { name: "Run" } }
    });
    expect(() => parseModule("export const { x } = value")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export const [x] = value")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export let x = 1")).toThrowError(DisallowedSyntaxError);
    expect(() => parseModule("export var x = 1")).toThrowError(DisallowedSyntaxError);
  });

  it("parses default export forms that the linter validates", () => {
    expect(parseModule("export default 1").body[0]).toMatchObject({
      type: "ExportDefaultDeclaration",
      declaration: {
        type: "NumericLiteral",
        value: 1
      }
    });

    const extractDuplicateDefault = () =>
      extractTopLevelExports(parseModule("export default () => 1; export default () => 2"));

    expect(extractDuplicateDefault).toThrow(
      "Module contains more than one export default declaration."
    );

    try {
      extractDuplicateDefault();
    } catch (error) {
      expect(error).toBeInstanceOf(ExportExtractionError);
      expect(error).toMatchObject({
        span: {
          start: {
            line: 1,
            column: 25
          }
        }
      });
    }
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
