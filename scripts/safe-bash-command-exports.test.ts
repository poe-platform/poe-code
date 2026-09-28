import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const metadata = JSON.parse(readFileSync(resolve(root, "packages/safe-bash/package.json"), "utf8"));
const commands = Object.entries(metadata.poeCode.integration.privateWorkspaces).filter(([name]) => name.startsWith("safe-bash-command-"));

function exportedNames(file: string, visited = new Set<string>()): Set<string> {
  if (visited.has(file)) return new Set();
  visited.add(file);
  const names = new Set<string>();
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const entry of statement.exportClause.elements) names.add(entry.name.text);
      } else if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text;
        const target = specifier.startsWith(".")
          ? resolve(dirname(file), specifier.endsWith(".js") ? specifier.slice(0, -3) + ".ts" : specifier)
          : resolve(root, "packages", specifier, "src/index.ts");
        if (existsSync(target)) for (const name of exportedNames(target, visited)) names.add(name);
      }
    } else if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      } else if ("name" in statement && statement.name && ts.isIdentifier(statement.name as ts.Node)) names.add((statement.name as ts.Identifier).text);
    }
  }
  return names;
}

const core = exportedNames(resolve(root, "packages/safe-bash/src/core.ts"));
describe("portable command API", () => {
  for (const [workspace, configuration] of commands) {
    const name = workspace.slice("safe-bash-command-".length);
    const capitalized = name[0]!.toUpperCase() + name.slice(1);
    it(`${name} exposes plugin, command factories and options from core`, () => {
      expect(configuration).toHaveProperty("portable", true);
      for (const symbol of [`${name}Commands`, `create${capitalized}Commands`, `create${capitalized}Command`, `${capitalized}CommandsOptions`]) expect(core.has(symbol), symbol).toBe(true);
    });
  }
  for (const name of ["safe-bash-contracts", "safe-bash-csv-engine", "safe-bash-xml-engine", "safe-bash-compression-engine"]) {
    it(`${name} is portable`, () => expect(metadata.poeCode.integration.privateWorkspaces[name]).toHaveProperty("portable", true));
  }
});

const factoryNames = ["exiftool", "fmt", "fold", "imagemagick", "pandoc", "pdfimages", "pdfinfo", "sips", "unrtf", "xz"];
const factoryModules = await Promise.all(factoryNames.map(name => import(`../packages/safe-bash-command-${name}/src/index.ts`)));
describe("command factories agree with plugin registration", () => {
  for (const [index, name] of factoryNames.entries()) {
    it(name, () => {
      const api = factoryModules[index];
      const capitalized = name[0]!.toUpperCase() + name.slice(1);
      const definitions = api[`create${capitalized}Commands`]({ replace: true });
      const registered: string[] = [];
      api[`${name}Commands`]({ replace: true }).setup({ commands: {
        has: () => false,
        register: (command: { name: string }, options: { replace: boolean }) => {
          expect(options.replace).toBe(true);
          registered.push(command.name);
        }
      } });
      expect(registered).toEqual(definitions.map((command: { name: string }) => command.name));
      expect(registered).toContain(api[`create${capitalized}Command`]().name);
      expect(new Set(registered).size).toBe(registered.length);
    });
  }
});
