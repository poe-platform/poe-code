import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const metadata = JSON.parse(readFileSync(resolve(root, "packages/safe-bash/package.json"), "utf8"));
const commands = readdirSync(resolve(root, "packages"), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith("safe-bash-command-"))
  .map(entry => entry.name);

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

const sdk = new Set([
  ...exportedNames(resolve(root, "packages/safe-bash/src/core.ts")),
  ...exportedNames(resolve(root, "packages/safe-bash/src/optional.ts")),
]);
describe("portable command API", () => {
  for (const workspace of commands) {
    const name = workspace.slice("safe-bash-command-".length);
    const title = name.split("-").map(word => word[0]!.toUpperCase() + word.slice(1)).join("");
    const pluginName = title[0]!.toLowerCase() + title.slice(1);
    it(`${name} exposes its portable public command contract`, () => {
      const adapter = name === "xmllint" ? "xml" : name;
      const source = resolve(root, `packages/safe-bash/src/commands/${adapter}/index.ts`);
      const exported = new Set(sdk);
      if (existsSync(source)) {
        expect(metadata.exports).toHaveProperty(`./commands/${adapter}`);
        for (const symbol of exportedNames(source)) exported.add(symbol);
      }
      expect(metadata.poeCode.integration.privateWorkspaces[workspace]).toHaveProperty("portable", true);
      const packageExports = exportedNames(resolve(root, `packages/${workspace}/src/index.ts`));
      for (const symbol of [`${pluginName}Commands`, `create${title}Commands`, `create${title}Command`, `${title}CommandsOptions`]) expect(packageExports.has(symbol), `${workspace}: ${symbol}`).toBe(true);
      for (const symbol of [`${pluginName}Commands`, `create${title}Commands`, `create${title}Command`, `${title}CommandsOptions`]) expect(exported.has(symbol), symbol).toBe(true);
    });
  }
  for (const name of ["safe-bash-contracts", "safe-bash-csv-engine", "safe-bash-xml-engine", "safe-bash-compression-engine"]) {
    it(`${name} is portable`, () => expect(metadata.poeCode.integration.privateWorkspaces[name]).toHaveProperty("portable", true));
  }
});

const factoryNames = ["csvcut", "csvgrep", "csvkit", "diff3", "exiftool", "fmt", "fold", "htmlq", "imagemagick", "mmdc", "op", "pandoc", "pdfimages", "pdfinfo", "pdftk", "pdftoppm", "pdftotext", "qpdf", "sips", "soffice", "ssconvert", "unrtf", "wkhtmltopdf", "xmllint", "xz"];
const factoryModules = await Promise.all(factoryNames.map(name => import(`../packages/safe-bash-command-${name}/src/index.ts`)));
describe("command factories agree with plugin registration", () => {
  for (const [index, name] of factoryNames.entries()) {
    it(name, () => {
      const api = factoryModules[index];
      const capitalized = name[0]!.toUpperCase() + name.slice(1);
      const exports = exportedNames(resolve(root, `packages/safe-bash-command-${name}/src/index.ts`));
      expect(exports.has(`${capitalized}Limits`), `${name}: limits type`).toBe(true);
      const definitions = api[`create${capitalized}Commands`]();
      expect(definitions.length).toBeGreaterThan(0);
      for (const command of definitions) expect(command.execute).toBeTypeOf("function");
      expect(api[`${name}Commands`]().setup).toBeTypeOf("function");
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


describe("standalone XZ alias factories", () => {
  for (const [factory, name] of [["createUnxzCommand", "unxz"], ["createXzcatCommand", "xzcat"]]) {
    it(`${factory} preserves alias defaults and validates limits`, () => {
      const api = factoryModules[factoryNames.indexOf("xz")];
      expect(api[factory]).toBeTypeOf("function");
      expect(api[factory]().name).toBe(name);
      expect(api[factory]().execute).toBeTypeOf("function");
      expect(() => api[factory]({ limits: { maxDecodedBytes: -1 } })).toThrow(RangeError);
      expect(sdk.has(factory)).toBe(true);
    });
  }
});


it("standalone XZ aliases decompress stdin and enforce decoded-byte quotas", async () => {
  const api = factoryModules[factoryNames.indexOf("xz")];
  async function execute(command: CommandDefinition, input: Uint8Array, args: string[] = []) {
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await command.execute({
      command: command.name, args, stdin: toByteSource(input),
      cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
      stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
    });
    return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
  }
  const plain = Buffer.from("standalone aliases\n");
  const encoded = await execute(api.createXzCommand(), plain, ["-c"]);
  expect(encoded.exitCode, encoded.stderr).toBe(0);
  for (const factory of [api.createUnxzCommand, api.createXzcatCommand]) {
    const decoded = await execute(factory(), encoded.stdout);
    expect(decoded.exitCode, decoded.stderr).toBe(0);
    expect(decoded.stdout).toEqual(plain);
    const limited = await execute(factory({ limits: { maxDecodedBytes: 1 } }), encoded.stdout);
    expect(limited.exitCode).not.toBe(0);
    expect(limited.stdout.length).toBeLessThanOrEqual(1);
  }
});
