import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {expect, it} from "vitest";
import ts from "typescript";
import {Volume} from "memfs";
import * as bundling from "./bundle-safe-bash.mjs";
import {CommandRegistry} from "../packages/safe-bash/src/contracts/command.js";

const root = path.resolve(import.meta.dirname, "..");
it("publishes the SDK and explicit plugin from the root package with their type closures", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  expect(manifest.exports["./pandoc"]).toEqual({types: "./packages/pandoc/dist/index.d.ts", import: "./packages/pandoc/dist/public/sdk.js"});
  expect(manifest.exports["./safe-bash/commands/pandoc"]).toEqual({types: "./packages/safe-bash/dist/commands/pandoc/index.d.ts", import: "./packages/pandoc/dist/public/command.js"});
  expect(manifest.files).toContain("packages/pandoc/dist/**/*.d.ts");
  expect(manifest.files).toContain("packages/pandoc/dist/public");
});
it("ships portable public entries without loading Office engines for text conversion", async () => {
  const options = bundling.resolvePandocBuild(root);
  expect(options).toMatchObject({platform: "browser", bundle: true, splitting: true, write: false, external: ["poe-code/safe-fs/core"]});
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const artifacts = new Volume();
  const visited = new Set<string>();
  let presentationEngine = false;
  const optionalImports = new Set<string>();
  async function inspect(file: string): Promise<void> {
    if (visited.has(file)) return;
    visited.add(file);
    const contents = await readFile(file, "utf8");
    const map = JSON.parse(await readFile(`${file}.map`, "utf8")) as {sources: string[]};
    for (const source of map.sources) {
      const original = path.resolve(path.dirname(file), source);
      expect(original.startsWith(path.join(root, "packages/docx/src"))).toBe(false);
      if (original.startsWith(path.join(root, "packages/pptx/"))) presentationEngine = true;
    }
    artifacts.mkdirSync(path.dirname(file), {recursive: true});
    artifacts.writeFileSync(file, contents);
    const imports: string[] = [];
    for (const reference of ts.preProcessFile(contents, true, false).importedFiles) {
      // esbuild emits dynamic import literals immediately after the call opening.
      if (contents.slice(0, reference.pos).trimEnd().endsWith("(")) {
        expect(reference.fileName.startsWith(".")).toBe(true);
        optionalImports.add(path.resolve(path.dirname(file), reference.fileName));
      } else imports.push(reference.fileName);
    }
    const scanner = ts.createScanner(ts.ScriptTarget.ES2022, true, ts.LanguageVariant.Standard, contents);
    const forbidden: string[] = [];
    let previous: ts.SyntaxKind | undefined;
    let previousText = "";
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (token === ts.SyntaxKind.OpenParenToken) {
        if (previous === ts.SyntaxKind.Identifier && ["fetch", "require"].includes(previousText)) forbidden.push(previousText);
      }
      previous = token;
      previousText = scanner.getTokenText();
    }
    expect(forbidden).toEqual([]);
    for (const specifier of imports) {
      if (specifier.startsWith(".")) await inspect(path.resolve(path.dirname(file), specifier));
      else expect(specifier).toBe("poe-code/safe-fs/core");
    }
  }
  for (const route of ["./pandoc", "./safe-bash/commands/pandoc"]) await inspect(path.resolve(root, manifest.exports[route].import));
  expect(artifacts.existsSync(path.resolve(root, manifest.exports["./pandoc"].import))).toBe(true);
  expect(presentationEngine).toBe(false);
  expect(optionalImports.size).toBeGreaterThan(0);
  for (const file of optionalImports) await inspect(file);
  expect(presentationEngine).toBe(true);
});
it("runs conversion and explicit registration from packaged public entries, preserving collisions", async () => {
  const require = createRequire(import.meta.url);
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const api = {...require(path.resolve(root, manifest.exports["./pandoc"].import)), ...require(path.resolve(root, manifest.exports["./safe-bash/commands/pandoc"].import))};
  const conversion = await api.convert([{bytes: new TextEncoder().encode("# Original\n")}], {from: "commonmark", to: "plain"}, {});
  expect(conversion.text).toContain("Original");
  const host = {commands: new CommandRegistry(),
    use() {throw new Error("unexpected middleware");},
    registerFileSystem() {throw new Error("unexpected filesystem");}
  };
  expect(host.commands.has("pandoc")).toBe(false);
  api.pandocCommands().setup(host);
  const first = host.commands.get("pandoc");
  expect(() => api.pandocCommands().setup(host)).toThrow("Command already registered: pandoc");
  expect(host.commands.get("pandoc")).toBe(first);
  api.pandocCommands({replace: true}).setup(host);
  expect(host.commands.get("pandoc")).not.toBe(first);
});
