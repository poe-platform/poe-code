import { describe, expect, it } from "vitest";

import {
  parseModule,
  type ExportDefaultDeclaration,
  type ExportNamedDeclaration,
  type Module,
  type VariableDeclaration,
  type VariableDeclarationKind
} from "../parse/parser.js";
import { findExportedConstInitializer } from "./find-exported.js";

describe("findExportedConstInitializer", () => {
  it("returns the initializer expression for a matching top-level exported const", () => {
    const module = parseModule("export const schema = S.Object({ value: true });");
    const statement = module.body[0] as ExportNamedDeclaration;

    const initializer = findExportedConstInitializer(module, "schema");

    expect(initializer).toBe(statement.declaration.declarations[0]!.init);
    expect(initializer).toMatchObject({
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: {
          type: "Identifier",
          name: "S"
        },
        property: {
          type: "Identifier",
          name: "Object"
        }
      }
    });
  });

  it("returns the arrow initializer for an exported const handler", () => {
    const module = parseModule("export const handler = () => {};");
    const initializer = findExportedConstInitializer(module, "handler");

    expect(initializer).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false
    });
  });

  it("returns the async arrow initializer for an exported const handler", () => {
    const module = parseModule("export const handler = async () => {};");
    const initializer = findExportedConstInitializer(module, "handler");

    expect(initializer).toMatchObject({
      type: "ArrowFunctionExpression",
      async: true
    });
  });

  it("returns undefined when the export is absent", () => {
    const module = parseModule("const schema = S.Object({});");

    expect(findExportedConstInitializer(module, "schema")).toBeUndefined();
  });

  it("returns undefined when the exported const has a different name", () => {
    const module = parseModule("export const config = S.Object({});");

    expect(findExportedConstInitializer(module, "schema")).toBeUndefined();
  });

  it("does not recurse into nested blocks", () => {
    const nestedExport = parseModule("export const schema = S.Object({});").body[0]!;
    const module = parseModule("if (ready) {}");
    const statement = module.body[0]!;
    if (statement.type !== "IfStatement" || statement.consequent.type !== "BlockStatement") {
      throw new Error("Expected parsed if block fixture.");
    }
    statement.consequent.body = [nestedExport];

    expect(findExportedConstInitializer(module, "schema")).toBeUndefined();
  });

  it("throws a clear error when the matching exported const has no initializer", () => {
    const module = parseModule("export const handler = 1;");
    const statement = module.body[0] as ExportNamedDeclaration;
    delete statement.declaration.declarations[0]!.init;

    expect(() => findExportedConstInitializer(module, "handler")).toThrow(
      "Exported const 'handler' must have an initializer."
    );
  });

  it.each(["let", "var"] as const)("throws a clear error for %s exports", (kind) => {
    const module = moduleWithExportKind(kind);

    expect(() => findExportedConstInitializer(module, "schema")).toThrow(
      "Exported 'schema' must be declared with const."
    );
  });

  it("returns the default arrow expression", () => {
    const module = parseModule("export default () => {};");
    const statement = module.body[0] as ExportDefaultDeclaration;

    expect(findExportedConstInitializer(module, "default")).toBe(statement.declaration);
    expect(findExportedConstInitializer(module, "default")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false
    });
  });

  it("returns the async default arrow expression", () => {
    const module = parseModule("export default async () => {};");

    expect(findExportedConstInitializer(module, "default")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: true
    });
  });

  it("throws a clear error when the exported const binding is not an identifier", () => {
    const module = parseModule("export const schema = S.Object({});");
    const statement = module.body[0] as ExportNamedDeclaration;
    const destructuring = parseModule("const { schema } = source;").body[0] as VariableDeclaration;
    statement.declaration.declarations[0]!.id = destructuring.declarations[0]!.id;

    expect(() => findExportedConstInitializer(module, "schema")).toThrow(
      "Destructured exported const bindings are not supported."
    );
  });

  it("throws a clear error when the exported const has multiple declarators", () => {
    const module = parseModule("export const a = 1, b = 2;");

    expect(() => findExportedConstInitializer(module, "handler")).toThrow(
      "Exported const declarations must contain exactly one declarator."
    );
  });

  it("returns the literal initializer for an exported const handler", () => {
    const module = parseModule("export const handler = 1;");

    expect(findExportedConstInitializer(module, "handler")).toMatchObject({
      type: "NumericLiteral",
      value: 1
    });
  });
});

function moduleWithExportKind(kind: VariableDeclarationKind | "var"): Module {
  const module = parseModule("export const schema = S.Object({});");
  const statement = module.body[0] as ExportNamedDeclaration;
  statement.declaration.kind = kind as VariableDeclarationKind;
  return module;
}
