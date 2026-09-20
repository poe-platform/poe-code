import fs from "node:fs";
import path from "node:path";
import { parse } from "shell-quote";
import ts from "typescript";

export function workspaceTestExclusions(root, fileSystem = fs) {
  return workspaceUnitSelections(root, fileSystem).flatMap(selection => selection.exclusions);
}

export function workspaceUnitSelections(root, fileSystem = fs) {
  const selections = [];
  for (const directory of fileSystem.readdirSync(path.join(root, "packages"), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const prefix = `packages/${directory.name}/`;
    const manifest = path.join(root, prefix, "package.json");
    if (!fileSystem.existsSync(manifest)) continue;
    const scripts = JSON.parse(fileSystem.readFileSync(manifest, "utf8")).scripts ?? {};
    const script = scripts["test:unit"];
    if (typeof script !== "string") continue;
    const tokens = parse(script, () => undefined);
    if (tokens.length === 4 && tokens[0] === "vitest" && tokens[1] === "run" && tokens[2] === "--config" && typeof tokens[3] === "string") {
      const config = tokens[3];
      if (path.isAbsolute(config) || config.split("/").some(segment => segment === ".." || !segment)) continue;
      const filename = path.join(root, prefix, config);
      if (!fileSystem.existsSync(filename) || fileSystem.lstatSync(filename).isSymbolicLink()) continue;
      const source = ts.createSourceFile(filename, fileSystem.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
      const imported = source.statements.some(statement => ts.isImportDeclaration(statement)
        && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "vitest/config"
        && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
        && statement.importClause.namedBindings.elements.some(element => element.name.text === "defineConfig"
          && (element.propertyName?.text ?? element.name.text) === "defineConfig"));
      if (!imported || source.parseDiagnostics.length) continue;
      const exported = source.statements.find(statement => ts.isExportAssignment(statement) && !statement.isExportEquals);
      if (!exported || !ts.isCallExpression(exported.expression) || !ts.isIdentifier(exported.expression.expression)
        || exported.expression.expression.text !== "defineConfig" || exported.expression.arguments.length !== 1) continue;
      const configuration = exported.expression.arguments[0];
      if (!ts.isObjectLiteralExpression(configuration)) continue;
      const properties = object => {
        const entries = new Map();
        for (const property of object.properties) {
          if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
            || entries.has(property.name.text)) return null;
          entries.set(property.name.text, property.initializer);
        }
        return entries;
      };
      const settings = properties(configuration);
      if (!settings || settings.has("root") || settings.has("projects")) continue;
      const test = settings.get("test");
      if (!test || !ts.isObjectLiteralExpression(test) || test.properties.some(property => !ts.isPropertyAssignment(property))) continue;
      const unit = properties(test);
      if (!unit || unit.has("dir") || unit.has("projects")) continue;
      const include = unit.get("include");
      if (!include || !ts.isArrayLiteralExpression(include) || !include.elements.length || !include.elements.every(ts.isStringLiteral)) continue;
      const patterns = include.elements.map(element => element.text);
      if (patterns.some(pattern => path.isAbsolute(pattern) || pattern.startsWith("!") || pattern.includes("\\") || pattern.split("/").some(segment => !segment || segment === "." || segment === ".."))) continue;
      selections.push({ path: prefix.slice(0, -1), selectors: [], exclusions: patterns.map(pattern => prefix + pattern),
        passWithNoTests: unit.get("passWithNoTests")?.kind === ts.SyntaxKind.TrueKeyword,
        hasHooks: scripts["pretest:unit"] !== undefined || scripts["posttest:unit"] !== undefined,
        requiresNativePool: true });
      continue;
    }
    if (tokens[0] !== "cd" || tokens[1] !== "../.." || tokens[2]?.op !== "&&" || tokens[3] !== "vitest" || tokens[4] !== "run") continue;
    const owned = [];
    const selectors = [];
    let passWithNoTests = false;
    let supported = true;
    let requiresNativePool = false;
    for (let index = 5; index < tokens.length; index++) {
      const selector = tokens[index];
      if (typeof selector === "string" && (selector === "--pool" || selector.startsWith("--pool="))) {
        const pool = selector === "--pool" ? tokens[++index] : selector.slice("--pool=".length);
        if (!["threads", "forks", "vmThreads", "vmForks"].includes(pool)) {
          supported = false;
          break;
        }
        requiresNativePool = true;
        continue;
      }
      if (selector === "--passWithNoTests") {
        passWithNoTests = true;
        continue;
      }
      if (selector === "--config" && tokens[index + 1] === "vitest.config.ts") {
        index++;
        continue;
      }
      if (typeof selector !== "string" || !(selector + "/").startsWith(prefix) || selector.split("/").includes("..")) {
        supported = false;
        break;
      }
      if (["*", "?", "[", "]", "{", "}", "(", ")", "!", "\\"].some(character => selector.includes(character))) {
        supported = false;
        break;
      }
      const filename = path.join(root, selector);
      if (!fileSystem.existsSync(filename)) {
        supported = false;
        break;
      }
      const metadata = fileSystem.statSync(filename);
      if (metadata.isDirectory()) owned.push(`${selector.endsWith("/") ? selector : selector + "/"}**`);
      else if (metadata.isFile()) owned.push(selector);
      else { supported = false; break; }
      selectors.push(selector);
    }
    if (supported && selectors.length) selections.push({
      path: `packages/${directory.name}`,
      selectors,
      exclusions: owned,
      passWithNoTests,
      requiresNativePool,
      hasHooks: scripts["pretest:unit"] !== undefined || scripts["posttest:unit"] !== undefined
    });
  }
  return selections;
}
