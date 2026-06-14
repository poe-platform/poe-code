import type { Expression, Module } from "../parse/parser.js";

export function findExportedConstInitializer(module: Module, name: string): Expression | undefined {
  for (const statement of module.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      if (name === "default") {
        return statement.declaration;
      }

      continue;
    }

    if (statement.type !== "ExportNamedDeclaration") {
      continue;
    }

    const declaration = statement.declaration;
    if (declaration.kind !== "const") {
      throw new Error(`Exported '${name}' must be declared with const.`);
    }

    if (declaration.declarations.length !== 1) {
      throw new Error("Exported const declarations must contain exactly one declarator.");
    }

    const declarator = declaration.declarations[0]!;
    if (declarator.id.type !== "Identifier") {
      throw new Error("Destructured exported const bindings are not supported.");
    }

    if (declarator.id.name !== name) {
      continue;
    }

    if (declarator.init === undefined) {
      throw new Error(`Exported const '${name}' must have an initializer.`);
    }

    return declarator.init;
  }

  return undefined;
}
