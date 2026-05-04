import type { Expression, Module } from "../parse/parser.js";

export function findExportedConstInitializer(
  module: Module,
  name: string
): Expression | undefined {
  for (const statement of module.body) {
    if (statement.type !== "ExportNamedDeclaration") {
      continue;
    }

    const declaration = statement.declaration;
    if (declaration.kind !== "const" || declaration.declarations.length !== 1) {
      continue;
    }

    const declarator = declaration.declarations[0]!;
    if (declarator.id.type === "Identifier" && declarator.id.name === name) {
      return declarator.init;
    }
  }

  return undefined;
}
