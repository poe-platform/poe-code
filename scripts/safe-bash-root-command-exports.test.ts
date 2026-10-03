import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createWorkspaceBuildPlan } from "./build-workspaces.mjs";

const root = resolve(import.meta.dirname, "..");
const metadata = JSON.parse(readFileSync(resolve(root, "packages/safe-bash/package.json"), "utf8"));
const commands = createWorkspaceBuildPlan(root).workspaces
  .filter(workspace => workspace.name.startsWith("safe-bash-command-"));

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
        const parts = specifier.split("/");
        const packageName = parts.splice(0, specifier.startsWith("@") ? 2 : 1).join("/");
        const directory = resolve(root, "packages", packageName.split("/").at(-1)!);
        const manifestPath = resolve(directory, "package.json");
        const manifest = !specifier.startsWith(".") && existsSync(manifestPath)
          ? JSON.parse(readFileSync(manifestPath, "utf8")) : undefined;
        const entry = manifest?.exports?.[parts.length ? "./" + parts.join("/") : "."];
        const runtime = typeof entry === "string" ? entry : entry?.import;
        const target = specifier.startsWith(".")
          ? resolve(dirname(file), specifier.endsWith(".js") ? specifier.slice(0, -3) + ".ts" : specifier)
          : resolve(directory, typeof runtime === "string" ? runtime.replace("./dist/", "./src/").replace(".js", ".ts") : "src/index.ts");
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
const index = exportedNames(resolve(root, "packages/safe-bash/src/index.ts"));
const playwright = exportedNames(resolve(root, "packages/safe-bash/src/commands/playwright/index.ts"));
describe("root command API", () => {
  for (const { name: workspace } of commands) {
    const name = workspace.slice("safe-bash-command-".length);
    const title = name.split("-").map(word => word[0]!.toUpperCase() + word.slice(1)).join("");
    const pluginName = title[0]!.toLowerCase() + title.slice(1);
    it(`${name} exposes its command contract from the supported public surfaces`, () => {
      if (name === "playwright-cli") {
        for (const symbol of ["createPlaywrightCli", "PlaywrightCliOptions"]) {
          expect(playwright.has(symbol), `playwright: ${symbol}`).toBe(true);
        }
        return;
      }
      const symbols = name === "safejs"
        ? ["createSafeJsCommands", "safeJsCommands", "SafeJsCommandsOptions", "SafeJsCommandLimitError"]
        : name === "python"
          ? ["pythonCommands", "createPythonCommands", "PythonCommandsOptions", "pythonExecutorCommands", "createPythonExecutorCommands"]
          : [`${pluginName}Commands`, `create${title}Commands`, `create${title}Command`, `${title}CommandsOptions`];
      const surfaces: Record<string, Set<string>> = name === "ast-grep"
        ? {
            "ast-grep": exportedNames(resolve(root, "packages/safe-bash/src/ast-grep.ts")),
            "commands/ast-grep": exportedNames(resolve(root, "packages/safe-bash/src/commands/ast-grep/index.ts"))
          }
        : { core, root: index };
      for (const [surface, names] of Object.entries(surfaces)) {
        for (const symbol of symbols) expect(names.has(symbol), `${surface}: ${symbol}`).toBe(true);
      }
    });
  }
});

it("registers every command and engine as a qualified portable workspace", () => {
  for (const { name, manifest } of createWorkspaceBuildPlan(root).workspaces) {
    if (!name.startsWith("safe-bash-command-") && !(name.startsWith("safe-bash-") && name.endsWith("-engine"))) continue;
    expect(metadata.poeCode.integration.privateWorkspaces[name], name).toMatchObject({
      portable: true,
      version: manifest.version,
      dependencies: manifest.dependencies ?? {},
      devDependencies: manifest.devDependencies ?? {},
    });
  }
});

it("inherits portable path helpers from core without a root override", () => {
  const file = resolve(root, "packages/safe-bash/src/index.ts");
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const exports = source.statements.filter(ts.isExportDeclaration);
  expect(exports.some(entry => !entry.exportClause && entry.moduleSpecifier &&
    ts.isStringLiteral(entry.moduleSpecifier) && entry.moduleSpecifier.text === "./core.js")).toBe(true);
  for (const entry of exports) {
    if (entry.exportClause && ts.isNamedExports(entry.exportClause)) {
      expect(entry.exportClause.elements.map(element => element.name.text)).not.toContain("posixPath");
    }
    if (entry.moduleSpecifier && ts.isStringLiteral(entry.moduleSpecifier)) {
      expect(["path", "node:path"]).not.toContain(entry.moduleSpecifier.text);
    }
  }
  expect(core.has("posixPath")).toBe(true);
});
