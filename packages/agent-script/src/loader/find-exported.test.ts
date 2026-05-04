import { describe, expect, it } from "vitest";

import {
  parseModule,
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

  it.each(["let", "var"] as const)("returns undefined for %s exports", (kind) => {
    const module = moduleWithExportKind(kind);

    expect(findExportedConstInitializer(module, "schema")).toBeUndefined();
  });

  it("returns undefined when the exported const has multiple declarators", () => {
    const module = parseModule("export const schema = S.Object({});");
    const statement = module.body[0] as ExportNamedDeclaration;
    statement.declaration.declarations.push({
      ...statement.declaration.declarations[0]!,
      id: {
        ...statement.declaration.declarations[0]!.id,
        name: "config"
      }
    });

    expect(findExportedConstInitializer(module, "schema")).toBeUndefined();
  });

  it("returns undefined when the exported const binding is not an identifier", () => {
    const module = parseModule("export const schema = S.Object({});");
    const statement = module.body[0] as ExportNamedDeclaration;
    const destructuring = parseModule("const { schema } = source;").body[0] as VariableDeclaration;
    statement.declaration.declarations[0]!.id = destructuring.declarations[0]!.id;

    expect(findExportedConstInitializer(module, "schema")).toBeUndefined();
  });
});

function moduleWithExportKind(kind: VariableDeclarationKind | "var"): Module {
  const module = parseModule("export const schema = S.Object({});");
  const statement = module.body[0] as ExportNamedDeclaration;
  statement.declaration.kind = kind as VariableDeclarationKind;
  return module;
}
