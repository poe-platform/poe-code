import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { resolveBrowserShellBuild, resolvePrivateCommandBuild } from "./bundle-safe-bash.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";
import { build, transformSync, type BuildOptions, type Plugin } from "esbuild";
import { packageSafeLibraries, parsePackageSafeArguments, rewriteModuleSpecifiers } from "./package-safe.mjs";

it("packages isolated root SafeJS exports from canonical workspace artifacts", async () => {
  const { volume, options } = optionalLeftovers();
  const root = JSON.parse(volume.readFileSync("/repo/package.json", "utf8") as string);
  const source = JSON.parse(volume.readFileSync("/repo/packages/safe-js/package.json", "utf8") as string);
  for (const [route, entry] of [["./safe-js", "index"], ["./safe-js/core", "core"], ["./safe-js/cli", "cli"]]) {
    source.exports[route === "./safe-js" ? "." : route.replace("./safe-js", ".")] = {
      types: `./dist/${entry}.d.ts`, import: `./dist/${entry}.js`,
    };
    root.exports[route] = {
      types: { default: `./packages/safe-js/dist/${entry}.d.ts` },
      browser: null,
      import: `./dist/shared/safe-js/${entry}.js`,
    };
    volume.writeFileSync(`/repo/packages/safe-js/dist/${entry}.js`, 'export { value } from "./value.js";\n');
    volume.writeFileSync(`/repo/packages/safe-js/dist/${entry}.d.ts`, 'export { value } from "./value.js";\n');
  }
  volume.writeFileSync("/repo/packages/safe-js/dist/value.js", "export const value = 42;\n");
  volume.writeFileSync("/repo/packages/safe-js/dist/value.d.ts", "export declare const value: 42;\n");
  volume.writeFileSync("/repo/package.json", JSON.stringify(root));
  volume.writeFileSync("/repo/packages/safe-js/package.json", JSON.stringify(source));
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const manifest = JSON.parse(volume.readFileSync("/output/safe-js/package.json", "utf8") as string);
  for (const [route, entry] of [[".", "index"], ["./core", "core"], ["./cli", "cli"]]) {
    expect(manifest.exports[route]).toEqual({
      types: { default: `./dist/safe-js/${entry}.d.ts` }, browser: null, import: `./dist/safe-js/${entry}.js`,
    });
    expect(volume.readFileSync(`/output/safe-js/dist/safe-js/${entry}.js`, "utf8")).toContain('"./value.js"');
  }
  expect(volume.readFileSync("/output/safe-js/dist/safe-js/value.js", "utf8")).toBe("export const value = 42;\n");
  expect(volume.readFileSync("/output/safe-js/dist/safe-js/value.d.ts", "utf8")).toBe("export declare const value: 42;\n");
  expect(volume.existsSync("/output/safe-js/dist/shared")).toBe(false);
});

it.each([false, true])("treats bare relative asset URLs as URLs rather than dependencies (asset present: %s)", async present => {
  const { volume, options } = optionalLeftovers();
  const source = 'export const locate = () => new URL("runtime.wasm", import.meta.url);';
  volume.writeFileSync("/repo/packages/safe-js/dist/index.js", source);
  const bytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  if (present) volume.writeFileSync("/repo/packages/safe-js/dist/runtime.wasm", bytes);
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const manifest = JSON.parse(volume.readFileSync("/output/safe-js/package.json", "utf8") as string);
  expect(manifest.dependencies?.["runtime.wasm"]).toBeUndefined();
  expect(volume.readFileSync("/output/safe-js/dist/safe-js/index.js", "utf8")).toBe(
    present ? source.replace('"runtime.wasm"', '"./runtime.wasm"') : source,
  );
  if (present) expect(volume.readFileSync("/output/safe-js/dist/safe-js/runtime.wasm")).toEqual(bytes);
});

const bashManifest = JSON.parse(readFileSync(new URL("../packages/safe-bash/package.json", import.meta.url), "utf8"));
it.each(["csplit", "llm"])("keeps portable %s adapters linked to their canonical owner", async command => {
  const { volume, options } = optionalLeftovers();
  const name = `safe-bash-command-${command}`;
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces[name] = { version: "0.0.1", dependencies: {}, devDependencies: {} };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({
    name, private: true, type: "module", version: "0.0.1",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  volume.writeFileSync(`/repo/packages/${name}/dist/index.js`, "export function createCsplitCommand() {}\n");
  volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, "export declare function createCsplitCommand(): void;\n");
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const recipe = options.bundle.mock.calls.map(([settings]) => settings as BuildOptions)
    .find(settings => Object.hasOwn(settings.entryPoints ?? {}, "core.browser"))!;
  const filename = (recipe.entryPoints as Record<string, string>)[`commands/${command}/index.browser`]!;
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await build({
    entryPoints: [filename.replace("/repo/", root)], bundle: true, write: false,
    platform: "browser", format: "esm", metafile: true,
    external: Object.keys(bashManifest.poeCode.integration.privateWorkspaces),
  });
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect(imports.length).toBeGreaterThan(0);
  for (const imported of imports) expect(imported).toEqual({ path: name, kind: "import-statement", external: true });
  expect(Object.keys(result.metafile!.inputs)).toEqual([`packages/safe-bash/src/commands/${command}/index.ts`]);
});

it.each(["xan", "numfmt", "apply-patch", "diff", "patch", "gzip"])("bundles %s runtime and declarations behind its public export", async command => {
  const { volume, options } = optionalLeftovers();
  const name = `safe-bash-command-${command}`;
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces[name] = { version: "0.0.1", dependencies: {}, devDependencies: {} };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({
    name, private: true, type: "module", version: "0.0.1",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  volume.writeFileSync(`/repo/packages/${name}/dist/index.js`, "export function createCommand() {}\n");
  volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, "export declare function createCommand(): void;\n");
  volume.mkdirSync(`/repo/packages/safe-bash/dist/commands/${command}`, { recursive: true });
  for (const extension of ["js", "d.ts"]) {
    volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/${command}/index.${extension}`, `export * from "${name}";\n`);
  }
  await packageSafeLibraries({ ...options, outDir: "/output" });
  for (const extension of ["js", "d.ts"]) {
    const adapter = volume.readFileSync(`/output/safe-bash/dist/safe-bash/commands/${command}/index.${extension}`, "utf8");
    expect(adapter).toContain(`"../../../safe-bash-command-${command}/index.js"`);
    expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash-command-${command}/index.${extension}`, "utf8")).toContain("createCommand");
  }
  const packed = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8") as string);
  expect(packed.dependencies?.[name]).toBeUndefined();
  expect(packed.exports[`./commands/${command}`]).toBeDefined();
});

it("keeps truncate declarations private behind both established public routes", async () => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-truncate";
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = { [name]: { version: "0.0.1", dependencies: {}, devDependencies: {} } };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({
    name, private: true, type: "module", version: "0.0.1",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  volume.writeFileSync(`/repo/packages/${name}/dist/index.js`, "export function createTruncateCommand() {}\n");
  volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, "export declare function createTruncateCommand(): void;\n");
  volume.writeFileSync("/repo/packages/safe-bash/dist/index.d.ts", `export * from "${name}";\n`);
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const packed = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8") as string);
  expect(packed.dependencies?.[name]).toBeUndefined();
  expect(packed.exports["./commands/truncate"]).toEqual(expect.objectContaining(packed.exports["./truncate"]));
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/index.d.ts", "utf8")).toContain("../safe-bash-command-truncate/index.js");
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash-command-truncate/index.d.ts", "utf8")).toContain("createTruncateCommand");
});

it("omits orphaned on-disk browser chunks and wasm from safe-bash when core.browser.js is bundled", async () => {
  const { volume, options } = optionalLeftovers();
  volume.mkdirSync("/repo/packages/safe-bash/dist/chunks", { recursive: true });
  volume.writeFileSync("/repo/packages/safe-bash/dist/chunks/orphaned-unexternalized.js", "export const orphaned = 1;\n");
  volume.writeFileSync("/repo/packages/safe-bash/dist/git_rust-ORPHANED.wasm", Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  await packageSafeLibraries({
    ...options,
    outDir: "/output",
    bundle: async (settings: BuildOptions) =>
      settings.outdir === "/repo/packages/safe-bash/dist"
        ? {
            outputFiles: [
              { path: "/repo/packages/safe-bash/dist/core.browser.js", contents: Buffer.from("export { shared } from \"./chunks/bundled-chunk.js\";\n") },
              { path: "/repo/packages/safe-bash/dist/chunks/bundled-chunk.js", contents: Buffer.from("export const shared = 42;\n") },
            ],
          }
        : options.bundle(settings as { outdir?: string }),
  });
  expect(volume.existsSync("/output/safe-bash/dist/safe-bash/chunks/orphaned-unexternalized.js")).toBe(false);
  expect(volume.existsSync("/output/safe-bash/dist/safe-bash/git_rust-ORPHANED.wasm")).toBe(false);
  expect(volume.existsSync("/output/safe-bash/dist/safe-bash/chunks/bundled-chunk.js")).toBe(true);
  expect(volume.existsSync("/output/safe-bash/dist/safe-bash/core.browser.js")).toBe(true);
});

it.each(["contract", "companion"])("keeps canonical %s functions external in the actual scoped browser recipe", async kind => {
  const { volume, options } = optionalLeftovers();
  const specifier = kind === "contract" ? "safe-bash-contracts/command" : "@poe-code/spreadsheet-engine";
  const binding = kind === "contract" ? "getCommandArguments" : "createEngine";
  if (kind === "companion") {
    const directory = "/repo/packages/spreadsheet-engine";
    volume.mkdirSync(directory + "/dist", { recursive: true });
    volume.writeFileSync(directory + "/package.json", JSON.stringify({
      name: specifier, private: true, type: "module",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      poeCode: { safeLibraryExports: { "safe-bash": { "./ssconvert/core": "." } } },
    }));
    volume.writeFileSync(directory + "/dist/index.js", "export function createEngine() {}\n");
    volume.writeFileSync(directory + "/dist/index.d.ts", "export declare function createEngine(): void;\n");
  }
  let browser: BuildOptions | undefined;
  await packageSafeLibraries({ ...options, outDir: "/output", bundle: async (recipe: BuildOptions) => {
    if (Object.hasOwn(recipe.entryPoints ?? {}, "core.browser")) browser = recipe;
    return options.bundle(recipe);
  } });
  expect(browser).toBeDefined();
  const repository = fileURLToPath(new URL("../", import.meta.url));
  const artifact = await build({ ...browser, absWorkingDir: repository,
    alias: Object.fromEntries(Object.entries(browser!.alias ?? {}).map(([name, target]) => [name, target.replace("/repo/", repository)])),
    inject: browser!.inject?.map(filename => filename.replace("/repo/", repository)),
    entryPoints: undefined, splitting: false, sourcemap: false,
    stdin: { contents: `export { ${binding} } from ${JSON.stringify(specifier)};`, resolveDir: repository },
  });
  expect(Object.values(artifact.metafile!.outputs).flatMap(output => output.imports))
    .toContainEqual({ path: specifier, kind: "import-statement", external: true });
  const consumer = await build({ stdin: { contents: artifact.outputFiles[0]!.text, resolveDir: repository },
    bundle: true, write: false, platform: "browser", format: "cjs",
    plugins: [{ name: "canonical-runtime", setup(builder) {
      builder.onResolve({ filter: /^@poe-platform\/safe-fs\/core$/ }, () => ({ path: "fs", namespace: "canonical" }));
      builder.onResolve({ filter: /^(safe-bash-contracts\/command|@poe-code\/spreadsheet-engine)$/ }, () => ({ path: "command", namespace: "canonical" }));
      builder.onLoad({ filter: /.*/, namespace: "canonical" }, args => ({ contents: args.path === "fs"
        ? "export class FsError extends Error {} export const posixPath = {};"
        : `export const ${binding} = globalThis.canonicalArguments;` }));
    } }],
  });
  const canonicalArguments = () => undefined;
  const realm = createContext({ canonicalArguments, TextEncoder, TextDecoder, module: { exports: {} } });
  runInContext(consumer.outputFiles[0]!.text, realm);
  expect(realm.module.exports[binding]).toBe(canonicalArguments);
});
it.each(["workspace", "root", "undeclared-root"])("admits only declared portable ffmpeg %s contract edges", async runtime => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-ffmpeg";
  const commandManifest = JSON.parse(readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), "utf8"));
  expect(bashManifest.devDependencies[name]).toBe("*");
  expect(bashManifest.poeCode.integration.privateWorkspaces[name]).toEqual({
    version: commandManifest.version, dependencies: {}, devDependencies: commandManifest.devDependencies, portable: true,
  });
  expect(commandManifest.files).toEqual(["dist", "LICENSE"]);
  expect(commandManifest.scripts.test).toBe("node --import tsx --test src/*.test.ts");
  const adapter = ts.createSourceFile("ffmpeg.ts", readFileSync(new URL("../packages/safe-bash/src/commands/ffmpeg/index.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest);
  expect(adapter.statements.some(statement => ts.isExportDeclaration(statement)
    && statement.exportClause === undefined && statement.moduleSpecifier
    && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === name)).toBe(true);
  volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify(commandManifest));
  volume.writeFileSync(`/repo/packages/${name}/LICENSE`, "MIT\n");
  const runtimeSpecifier = runtime === "workspace" ? "safe-bash-contracts/command" : "../../../dist/shared/safe-bash-contracts/command.js";
  volume.writeFileSync(`/repo/packages/${name}/dist/index.js`, `export { commandRuntimeIdentity } from ${JSON.stringify(runtimeSpecifier)};`);
  volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, 'export type { CommandDefinition } from "safe-bash-contracts/command";');
  const contracts = { name: "safe-bash-contracts", version: "0.0.1", private: true, type: "module", dependencies: {}, devDependencies: {}, poeCode: { bundle: { sharedRuntime: runtime !== "undeclared-root" } }, exports: { "./command": { types: "./dist/command.d.ts", import: "./dist/command.js" } } };
  volume.mkdirSync("/repo/packages/safe-bash-contracts/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/safe-bash-contracts/package.json", JSON.stringify(contracts));
  volume.writeFileSync("/repo/packages/safe-bash-contracts/dist/command.js", "export const commandRuntimeIdentity = {};");
  volume.writeFileSync("/repo/packages/safe-bash-contracts/dist/command.d.ts", "export interface CommandDefinition { name: string }");
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces["safe-bash-contracts"] = { version: "0.0.1", dependencies: {}, devDependencies: {} };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/ffmpeg/index.${suffix}`, `export * from "${name}";`);
  if (runtime === "undeclared-root") {
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Not a built package file");
    return;
  }
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const read = (file: string) => volume.readFileSync("/output/safe-bash/" + file, "utf8");
  expect(JSON.parse(read("package.json")).exports["./commands/ffmpeg"]).toEqual({ types: "./dist/safe-bash/commands/ffmpeg/index.d.ts", workerd: "./dist/safe-bash/commands/ffmpeg/index.js", browser: "./dist/safe-bash/commands/ffmpeg/index.js", import: "./dist/safe-bash/commands/ffmpeg/index.js" });
  for (const suffix of ["js", "d.ts"]) {
    expect(read(`dist/safe-bash/commands/ffmpeg/index.${suffix}`)).toContain('"../../../safe-bash-command-ffmpeg/index.js"');
    expect(read(`dist/${name}/index.${suffix}`)).toContain('"../safe-bash-contracts/command.js"');
  }
});
const dtsTranspileCache = new Map<string, string>();
function getCachedDeclaration(distPath: string, source: string, compilerOptions: ts.CompilerOptions): string {
  if (existsSync(distPath)) return readFileSync(distPath, "utf8");
  const cached = dtsTranspileCache.get(source);
  if (cached !== undefined) return cached;
  const emitted = ts.transpileDeclaration(source, { compilerOptions }).outputText;
  dtsTranspileCache.set(source, emitted);
  return emitted;
}

it.each(["index", "undeclared"])("stages only declared root-owned SafeJS runtime exports: %s", async entry => {
  const { volume, options } = optionalLeftovers();
  const manifest = JSON.parse(volume.readFileSync("/repo/package.json", "utf8").toString());
  manifest.exports["./safe-js"] = {
    types: "./packages/safe-js/dist/index.d.ts", browser: null,
    import: `./dist/shared/safe-js/${entry}.js`
  };
  volume.writeFileSync("/repo/package.json", JSON.stringify(manifest));
  volume.mkdirSync("/repo/dist/shared/safe-js", { recursive: true });
  volume.writeFileSync("/repo/dist/shared/safe-js/index.js", "throw new Error('root runtime must not enter scoped archive');");
  volume.writeFileSync("/repo/packages/safe-js/dist/index.js", "export const scopedIdentity = {};\n");
  if (entry === "undeclared") {
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Not a built package file");
    return;
  }
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const published = JSON.parse(volume.readFileSync("/output/safe-js/package.json", "utf8").toString());
  expect(published.exports["."]).toEqual({ types: "./dist/safe-js/index.d.ts", browser: null, import: "./dist/safe-js/index.js" });
  expect(volume.readFileSync("/output/safe-js/dist/safe-js/index.js", "utf8")).toBe("export const scopedIdentity = {};\n");
});

it("embeds the declared ssconvert SDK behind its legacy CLI subpath without a CLI dependency", async () => {
  const { volume, options } = optionalLeftovers();
  volume.mkdirSync("/repo/packages/safe-bash-command-ssconvert/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/package.json", JSON.stringify({
    ...JSON.parse(readFileSync(new URL("../packages/safe-bash-command-ssconvert/package.json", import.meta.url), "utf8")),
    files: ["dist"],
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./commands": { types: "./dist/commands.d.ts", import: "./dist/commands.js" },
    },
  }));
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/dist/index.js", "export const createEngine = () => 'spreadsheet';");
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/dist/index.d.ts", "export declare const createEngine: () => string;");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync("/repo/packages/safe-bash/dist/commands/ssconvert/index." + suffix,
    'export { createEngine } from "poe-code/ssconvert";');
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/dist/commands.js", "export const createSsconvertCommand = () => ({ name: 'ssconvert' });");
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/dist/commands.d.ts", "export declare const createSsconvertCommand: () => { name: string };");
  await packageSafeLibraries({ ...options, outDir: "/output" });
  expect(JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8")).exports["./ssconvert/commands"])
    .toEqual({ types: "./dist/safe-bash-command-ssconvert/commands.d.ts", import: "./dist/safe-bash-command-ssconvert/commands.js" });
  for (const suffix of ["js", "d.ts"]) expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/commands/ssconvert/index." + suffix, "utf8"))
    .toContain('"../../../safe-bash-command-ssconvert/index.js"');
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash-command-ssconvert/index.d.ts", "utf8")).toContain("createEngine");
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash-command-ssconvert/index.js", "utf8")).toContain("spreadsheet");
  const dependencies = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8")).dependencies;
  expect(dependencies).not.toHaveProperty("poe-code");
  expect(dependencies).not.toHaveProperty("safe-bash-command-ssconvert");
});

it("ships the spreadsheet command SDK without a CLI dependency", async () => {
  const { volume, options } = optionalLeftovers();
  const command = ts.createSourceFile("index.ts", readFileSync(new URL("../packages/safe-bash/src/commands/ssconvert/index.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const exported = command.statements.find(ts.isExportDeclaration)!.moduleSpecifier as ts.StringLiteral;
  volume.mkdirSync("/repo/packages/safe-bash-command-ssconvert/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/package.json", JSON.stringify({
    ...JSON.parse(readFileSync(new URL("../packages/safe-bash-command-ssconvert/package.json", import.meta.url), "utf8")),
    files: ["dist"],
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./commands": { types: "./dist/commands.d.ts", import: "./dist/commands.js" },
    },
  }));
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/dist/index.js", 'export const createSsconvertCommand = () => ({ name: "ssconvert" });');
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/dist/index.d.ts", "export declare const createSsconvertCommand: () => { name: string };");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync("/repo/packages/safe-bash/dist/commands/ssconvert/index." + suffix, `export { createSsconvertCommand } from ${JSON.stringify(exported.text)};`);
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/dist/commands.js", "export const createSsconvertCommand = () => ({ name: 'ssconvert' });");
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/dist/commands.d.ts", "export declare const createSsconvertCommand: () => { name: string };");
  await packageSafeLibraries({ ...options, outDir: "/output" });
  expect(JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8")).exports["./ssconvert/commands"])
    .toEqual({ types: "./dist/safe-bash-command-ssconvert/commands.d.ts", import: "./dist/safe-bash-command-ssconvert/commands.js" });
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/commands/ssconvert/index.js", "utf8")).toContain('"../../../safe-bash-command-ssconvert/index.js"');
  expect(JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8")).dependencies).not.toHaveProperty("poe-code");
});

it("maps the standalone spreadsheet contracts facade to the scoped canonical runtime", async () => {
  const { volume, options } = optionalLeftovers();
  const manifest = structuredClone(bashManifest);
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {} };
  manifest.poeCode.integration.privateWorkspaces["safe-bash-contracts"] = profile;
  manifest.poeCode.integration.privateWorkspaces["safe-bash-command-ssconvert"] = profile;
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  for (const name of ["safe-bash-contracts", "safe-bash-command-ssconvert"]) {
    volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
    volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({
      name, ...profile, private: true, type: "module", files: ["dist"],
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    }));
  }
  volume.writeFileSync("/repo/packages/safe-bash-contracts/dist/index.js", "export const sharedBudget = {};");
  volume.writeFileSync("/repo/packages/safe-bash-contracts/dist/index.d.ts", "export declare const sharedBudget: object;");
  for (const suffix of ["js", "d.ts"]) {
    volume.writeFileSync(`/repo/packages/safe-bash-command-ssconvert/dist/index.${suffix}`,
      'export { sharedBudget } from "poe-code/safe-bash/contracts";');
    volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/ssconvert/index.${suffix}`,
      'export * from "safe-bash-command-ssconvert";');
  }
  let privateRecipe: BuildOptions | undefined;
  await packageSafeLibraries({ ...options, outDir: "/output", bundle: async (recipe: BuildOptions) => {
    if (Object.hasOwn(recipe.entryPoints ?? {}, "safe-bash-command-ssconvert/dist/index")) privateRecipe = recipe;
    return options.bundle(recipe);
  } });
  expect(privateRecipe?.alias?.["poe-code/safe-bash/contracts"]).toBe("safe-bash-contracts");
  expect(privateRecipe?.external).toContain("safe-bash-contracts");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const filesystemConsumer = await build({ ...privateRecipe, absWorkingDir: root, entryPoints: undefined,
    stdin: { contents: 'export { retainFileSystemCleanup } from "poe-code/safe-fs/core";', resolveDir: root },
    metafile: true, write: false,
  });
  expect(Object.keys(filesystemConsumer.metafile!.inputs)).toEqual(["<stdin>"]);
  expect(Object.values(filesystemConsumer.metafile!.outputs).flatMap(output => output.imports))
    .toEqual([expect.objectContaining({ path: "@poe-platform/safe-fs/core", external: true })]);
  for (const suffix of ["js", "d.ts"]) {
    expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash-command-ssconvert/index.${suffix}`, "utf8"))
      .toContain('"../safe-bash-contracts/index.js"');
  }
});

it.each(["csvkit", "zip", "cp"])("ships the private %s command SDK with its runtime graph", async name => {
  const workspace = `safe-bash-command-${name}`;
  const { volume, options } = optionalLeftovers();
  const manifest = structuredClone(bashManifest);
  manifest.devDependencies[workspace] = "*";
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync(`/repo/packages/${workspace}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${workspace}/package.json`, JSON.stringify({
    ...JSON.parse(readFileSync(new URL(`../packages/${workspace}/package.json`, import.meta.url), "utf8")),
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  volume.writeFileSync(`/repo/packages/${workspace}/dist/index.js`, "export const commands = ['csvcut'];");
  volume.writeFileSync(`/repo/packages/${workspace}/dist/index.d.ts`, "export declare const commands: string[];");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/${name}/index.${suffix}`, `export { commands } from "${workspace}";`);
  volume.writeFileSync(`/repo/packages/${workspace}/LICENSE`, "Fixture license\n");
  await packageSafeLibraries({ ...options, outDir: "/output" });
  expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash/commands/${name}/index.js`, "utf8")).toContain(`"../../../${workspace}/index.js"`);
  expect(volume.readFileSync(`/output/safe-bash/dist/${workspace}/index.js`, "utf8")).toContain("csvcut");
  expect(JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8")).dependencies).not.toHaveProperty(workspace);
});

it("packages declared private Node exports and their conditional declarations", async () => {
  const { volume, options } = optionalLeftovers();
  const manifest = structuredClone(bashManifest);
  manifest.devDependencies["@poe-code/private-sdk"] = "*";
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync("/repo/packages/private-sdk/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/private-sdk/package.json", JSON.stringify({
    name: "@poe-code/private-sdk", private: true, type: "module",
    exports: { "./server": {
      types: { browser: "./dist/unavailable.d.ts", node: "./dist/server.d.ts", default: "./dist/unavailable.d.ts" },
      browser: null, node: "./dist/server.js", default: null,
    } },
  }));
  volume.writeFileSync("/repo/packages/private-sdk/dist/server.js", "export const server = 1;");
  volume.writeFileSync("/repo/packages/private-sdk/dist/server.d.ts", "export declare const server: number;");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync("/repo/packages/safe-bash/dist/index." + suffix, 'export { server } from "@poe-code/private-sdk/server";');
  await packageSafeLibraries({ ...options, outDir: "/output" });
  for (const suffix of ["js", "d.ts"]) {
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/index." + suffix, "utf8")).toContain('from "../private-sdk/server.js"');
    expect(volume.existsSync("/output/safe-bash/dist/private-sdk/server." + suffix)).toBe(true);
  }
  expect(JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8")).dependencies).not.toHaveProperty("@poe-code/private-sdk");
});

it("embeds declared private SDKs with portable conditional exports", async () => {
  const { volume, options } = optionalLeftovers();
  const manifest = structuredClone(bashManifest);
  manifest.devDependencies["@poe-code/private-sdk"] = "*";
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync("/repo/packages/private-sdk/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/private-sdk/package.json", JSON.stringify({
    name: "@poe-code/private-sdk", private: true, type: "module",
    exports: { ".": {
      types: { browser: "./dist/index.d.ts", default: "./dist/index.d.ts" },
      workerd: "./dist/index.js", browser: "./dist/index.js", node: "./dist/index.js", default: "./dist/index.js",
    } },
  }));
  volume.writeFileSync("/repo/packages/private-sdk/dist/index.js", "export const commands = ['csvcut'];");
  volume.writeFileSync("/repo/packages/private-sdk/dist/index.d.ts", "export declare const commands: string[];");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync("/repo/packages/safe-bash/dist/commands/csvkit/index." + suffix, 'export { commands } from "@poe-code/private-sdk";');
  await packageSafeLibraries({ ...options, outDir: "/output" });
  for (const suffix of ["js", "d.ts"]) expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/commands/csvkit/index." + suffix, "utf8")).toContain('"../../../private-sdk/index.js"');
  expect(volume.readFileSync("/output/safe-bash/dist/private-sdk/index.js", "utf8")).toContain("csvcut");
  expect(volume.readFileSync("/output/safe-bash/dist/private-sdk/index.d.ts", "utf8")).toContain("commands");
});

it.each([
  { types: "./dist/index.d.ts", import: null, default: "./dist/index.js" },
  { types: "./dist/index.d.ts", import: { import: null, default: "./dist/index.js" } },
  { types: { import: null, default: "./dist/index.d.ts" }, import: "./dist/index.js" },
])("refuses private SDK export conditions explicitly blocked by null: %j", async (exported) => {
  const { volume, options } = optionalLeftovers();
  const manifest = structuredClone(bashManifest);
  manifest.devDependencies["@poe-code/private-sdk"] = "*";
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync("/repo/packages/private-sdk/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/private-sdk/package.json", JSON.stringify({
    name: "@poe-code/private-sdk", private: true, type: "module",
    exports: { ".": exported }
  }));
  volume.writeFileSync("/repo/packages/private-sdk/dist/index.js", "export const commands = [];");
  volume.writeFileSync("/repo/packages/private-sdk/dist/index.d.ts", "export declare const commands: string[];");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync("/repo/packages/safe-bash/dist/commands/csvkit/index." + suffix, 'export { commands } from "@poe-code/private-sdk";');
  await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Missing private workspace");
});

it("preserves public contract exports when the browser bundle externalizes their canonical runtime", async () => {
  const entry = readFileSync(new URL("../packages/safe-bash/src/core.browser.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("core.browser.ts", entry, ts.ScriptTarget.Latest, true);
  const coreNames = parsed.statements.filter(ts.isExportDeclaration).flatMap(statement =>
    statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "./core.js"
      && statement.exportClause && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.map(element => element.name.text) : []);
  const publicContracts = {
    command: ["CommandArgumentIdentityError", "createCommandArguments", "getCommandArguments", "commandRuntimeIdentity", "CommandRegistry", "validateExitCode"],
    "command-requirements": ["evaluateCommandSupport", "assertCommandRequirements"],
    errors: ["isErrnoCode", "isFsError", "toFsError", "FsError"],
    filesystem: ["ACCESS_MODES"],
    io: ["InputByteBudget", "collectBytes", "readBytes", "toByteSource", "outputFailure", "createBytePipe", "writeText", "writeBytes", "pipeBytes", "collectText"],
    output: ["createOutputOperation"],
    plugin: ["composeMiddleware"],
  };
  const forwarding = Object.keys(publicContracts).map(name => `export * from "safe-bash-contracts/${name}";`).join("\n");
  const coreEntry = readFileSync(new URL("../packages/safe-bash/src/core.ts", import.meta.url), "utf8");
  const coreParsed = ts.createSourceFile("core.ts", coreEntry, ts.ScriptTarget.Latest, true);
  const contractExports = coreParsed.statements.filter(ts.isExportDeclaration).filter(statement =>
    statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text.startsWith("safe-bash-contracts/") && !statement.isTypeOnly)
    .map(statement => statement.getText(coreParsed)).join("\n");
  const modules = new Map([
    ["shell", forwarding + "\n" + contractExports + "\n" + coreNames.map(name => `export const ${name} = {};`).join("\n")],
    ["safe-bash-contracts", forwarding + '\nexport const shellValueBytes = {};'],
    ...Object.entries(publicContracts).map(([subpath, names]) => [
      "safe-bash-contracts/" + subpath, names.map(name => `export const ${name} = {};`).join("\n"),
    ] as [string, string]),
  ]);
  const plugin = {
    name: "canonical-contract-fixture",
    setup(builder: import("esbuild").PluginBuild) {
      builder.onResolve({ filter: /.*/ }, args => {
        const filename = args.path === "./core.js" ? "shell" : args.path;
        return modules.has(filename) || filename === "artifact" ? { path: filename, namespace: "fixture" } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: modules.get(args.path)!, loader: "js" }));
    },
  } satisfies import("esbuild").Plugin;
  const artifact = await build({
    stdin: { contents: entry, resolveDir: process.cwd() }, bundle: true, write: false,
    format: "esm", platform: "browser", plugins: [{
      name: "external-canonical-contracts",
      setup(builder) {
        builder.onResolve({ filter: /^safe-bash-contracts(?:\/|$)/ }, args => ({ path: args.path, external: true }));
      },
    }, plugin],
  });
  modules.set("artifact", artifact.outputFiles[0]!.text);
  const consumer = await build({
    stdin: { contents: 'import * as api from "artifact"; import * as canonical from "safe-bash-contracts"; export { api, canonical };' },
    bundle: true, write: false, format: "cjs", platform: "browser", plugins: [plugin],
  });
  const output = { exports: {} as { api: Record<string, unknown>; canonical: Record<string, unknown> } };
  new Function("module", consumer.outputFiles[0]!.text)(output);
  const names = Object.values(publicContracts).flat();
  expect(Object.keys(output.exports.api).sort()).toEqual([...names, ...coreNames].sort());
  for (const name of names) expect(output.exports.api[name]).toBe(output.exports.canonical[name]);
});

it.each([false, true])("keeps copied command WASM inside the standalone artifact (portable=%s)", async portable => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-wasm";
  const manifest = structuredClone(bashManifest);
  manifest.devDependencies[name] = "*";
  manifest.poeCode.integration.privateWorkspaces = {
    [name]: { version: "0.0.1", dependencies: {}, devDependencies: {}, ...(portable ? { portable: true } : {}) },
  };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({
    name, version: "0.0.1", private: true, type: "module", dependencies: {}, devDependencies: {},
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  volume.writeFileSync(`/repo/packages/${name}/dist/engine.wasm`, wasm);
  volume.writeFileSync(`/repo/packages/${name}/dist/index.js`, 'import engine from "./engine.wasm"; export { engine };');
  volume.mkdirSync(`/repo/packages/${name}/src`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/src/index.ts`, 'import engine from "../dist/engine.wasm"; export { engine };');
  volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, "export declare const engine: unknown;");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/exiftool/index.${suffix}`, `export * from "${name}";`);
  volume.mkdirSync("/repo/packages/safe-bash/browser", { recursive: true });
  const plugin: Plugin = { name: "copied-wasm-fixture", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
      contents: Buffer.from(volume.readFileSync(args.path)), resolveDir: path.dirname(args.path),
      loader: args.path.endsWith(".wasm") ? "copy" : "js",
    }));
  } };
  await packageSafeLibraries({ ...options, outDir: "/output", bundle: async (settings: BuildOptions) =>
    settings.outdir === "/repo/packages" ? build({ ...settings, plugins: [plugin] }) : options.bundle(settings),
  });
  const entry = `/output/safe-bash/dist/${name}/index.js`;
  const source = ts.createSourceFile(entry, volume.readFileSync(entry, "utf8").toString(), ts.ScriptTarget.Latest);
  const reference = source.statements.find(statement => ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.endsWith(".wasm"));
  if (!reference || !ts.isImportDeclaration(reference) || !ts.isStringLiteral(reference.moduleSpecifier)) throw new Error("Packaged command lost its WASM import");
  const asset = path.resolve(path.dirname(entry), reference.moduleSpecifier.text);
  expect(asset.startsWith("/output/safe-bash/dist/")).toBe(true);
  expect(volume.readFileSync(asset)).toEqual(wasm);
});

it("ships the ExifTool implementation and declarations without an unpublished dependency", async () => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-exiftool";
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = {
    [name]: { version: "0.0.1", portable: true, dependencies: {}, devDependencies: { "safe-bash-contracts": "*", "@poe-code/safe-fs": "*" }, assets: ["./dist/profile.bin"] },
  };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  const commandManifest = JSON.parse(readFileSync(new URL("../packages/safe-bash-command-exiftool/package.json", import.meta.url), "utf8"));
  volume.mkdirSync("/repo/packages/" + name + "/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/" + name + "/package.json", JSON.stringify(commandManifest));
  volume.writeFileSync("/repo/packages/" + name + "/LICENSE", "Original first-party implementation\n");
  volume.writeFileSync("/repo/packages/" + name + "/dist/profile.bin", Buffer.from([0, 255, 254]));
  // Exercise a real source module through the artifact rather than an empty export.
  const scalarSource = readFileSync(new URL("../packages/safe-bash-command-exiftool/src/scalar.ts", import.meta.url), "utf8");
  volume.writeFileSync("/repo/packages/" + name + "/dist/index.js", 'export { encodeJsonScalar } from "./scalar.js";');
  volume.writeFileSync("/repo/packages/" + name + "/dist/index.d.ts", 'export { encodeJsonScalar } from "./scalar.js";');
  volume.writeFileSync("/repo/packages/" + name + "/dist/scalar.js", ts.transpileModule(scalarSource, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  volume.writeFileSync("/repo/packages/" + name + "/dist/scalar.d.ts", "export declare function encodeJsonScalar(value: string): string;");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync("/repo/packages/safe-bash/dist/commands/exiftool/index." + suffix, 'export * from "safe-bash-command-exiftool";');
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const read = (path: string) => volume.readFileSync("/output/safe-bash/" + path, "utf8");
  const shipped = JSON.parse(read("package.json"));
  expect(shipped.dependencies).toEqual({});
  expect(read("dist/" + name + "/LICENSE")).toBe("Original first-party implementation\n");
  expect(volume.readFileSync("/output/safe-bash/dist/" + name + "/profile.bin")).toEqual(Buffer.from([0, 255, 254]));
  expect(shipped.exports["./commands/exiftool"]).toEqual({ types: "./dist/safe-bash/commands/exiftool/index.d.ts", workerd: "./dist/safe-bash/commands/exiftool/index.js", browser: "./dist/safe-bash/commands/exiftool/index.js", import: "./dist/safe-bash/commands/exiftool/index.js" });
  expect(read("dist/safe-bash/commands/exiftool/index.js")).toContain('"../../../safe-bash-command-exiftool/index.js"');
  expect(read("dist/safe-bash/commands/exiftool/index.d.ts")).toContain('"../../../safe-bash-command-exiftool/index.js"');
  const consumer = await import("data:text/javascript;base64," + Buffer.from(read("dist/safe-bash-command-exiftool/scalar.js")).toString("base64"));
  expect(consumer.encodeJsonScalar("1e999")).toBe("1e999");
  expect(consumer.encodeJsonScalar("a\0b\x7f")).toBe('"ab\\u007F"');
});

{
  // Prepare the real package graph once before the timed consumer assertions.
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-exiftool";
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = {
    [name]: { version: "0.0.1", portable: true, dependencies: {}, devDependencies: { "safe-bash-contracts": "*", "@poe-code/safe-fs": "*" } },
  };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/package.json`, readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), "utf8"));
  volume.writeFileSync(`/repo/packages/${name}/LICENSE`, readFileSync(new URL(`../packages/${name}/LICENSE`, import.meta.url)));
  const scalar = readFileSync(new URL(`../packages/${name}/src/scalar.ts`, import.meta.url), "utf8");
  volume.writeFileSync(`/repo/packages/${name}/dist/index.js`, 'export { encodeJsonScalar } from "./scalar.js";');
  volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, 'export { encodeJsonScalar } from "./scalar.js";');
  const scalarJs = new URL(`../packages/${name}/dist/scalar.js`, import.meta.url);
  volume.writeFileSync(`/repo/packages/${name}/dist/scalar.js`, existsSync(scalarJs)
    ? readFileSync(scalarJs, "utf8") : transformSync(scalar, { loader: "ts", format: "esm", target: "es2022" }).code);
  volume.writeFileSync(`/repo/packages/${name}/dist/scalar.d.ts`, getCachedDeclaration(
    fileURLToPath(new URL(`../packages/${name}/dist/scalar.d.ts`, import.meta.url)), scalar,
    { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  ));
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/exiftool/index.${suffix}`, `export * from "${name}";`);
  volume.mkdirSync("/repo/packages/safe-bash/browser", { recursive: true });
  volume.writeFileSync("/repo/packages/safe-bash/browser/buffer.mjs", "export {};\n");
  const bundle = async (settings: BuildOptions) => {
    if (settings.outdir !== "/repo/packages") return options.bundle(settings);
    return build({ ...settings, plugins: [{ name: "private-build-inputs", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => ({ path: new URL(args.path, pathToFileURL(args.resolveDir + "/")).pathname, namespace: "private" }));
      builder.onLoad({ filter: /.*/, namespace: "private" }, args => {
        // Fixtures use source-equivalent JS for both build input and copied
        // artifacts; production recipes now enter the original source graph.
        const input = args.path.includes("/src/") ? args.path.replace("/src/", "/dist/").slice(0, -3) + ".js" : args.path;
        return { contents: volume.readFileSync(input, "utf8").toString(), resolveDir: input.slice(0, input.lastIndexOf("/")), loader: "js" };
      });
    } }] });
  };
  await packageSafeLibraries({ ...options, bundle, outDir: "/output" });
  it("bundles a real private command behind its packed subpath", async () => {
  const prefix = `/output/safe-bash/dist/${name}/`;
  // Runtime source is bundled; declarations retain their rewritten relative closure.
  expect(volume.existsSync(prefix + "scalar.js")).toBe(false);
  expect(volume.existsSync(prefix + "scalar.d.ts")).toBe(true);
  const consumer = await import("data:text/javascript;base64," + Buffer.from(volume.readFileSync(prefix + "index.js")).toString("base64"));
  expect(consumer.encodeJsonScalar("1e999")).toBe("1e999");
  expect(volume.existsSync(`/output/safe-bash/node_modules/${name}`)).toBe(false);
  volume.rmSync("/repo", { recursive: true });
  volume.mkdirSync("/consumer/node_modules/@poe-platform", { recursive: true });
  volume.writeFileSync("/consumer/index.mts", 'import { encodeJsonScalar } from "@poe-platform/safe-bash/commands/exiftool"; const result: string = encodeJsonScalar("1e999"); void result;');
  // Check the packed declarations and consumer, not TypeScript's own libraries.
  const compilerOptions = { noEmit: true, strict: true, skipDefaultLibCheck: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const host = ts.createCompilerHost(compilerOptions);
  const packedPath = (filename: string) => filename.replace("/consumer/node_modules/@poe-platform/safe-bash", "/output/safe-bash");
  const toolRoot = path.dirname(ts.getDefaultLibFilePath(compilerOptions));
  host.fileExists = filename => volume.existsSync(packedPath(filename)) || filename.startsWith(toolRoot + path.sep) && ts.sys.fileExists(filename);
  host.directoryExists = filename => volume.existsSync(packedPath(filename)) || filename.startsWith(toolRoot) && ts.sys.directoryExists(filename);
  host.readFile = filename => volume.existsSync(packedPath(filename)) ? volume.readFileSync(packedPath(filename), "utf8").toString()
    : filename.startsWith(toolRoot + path.sep) ? ts.sys.readFile(filename) : undefined;
  host.getSourceFile = (filename, languageVersion) => {
    const source = host.readFile(filename);
    return source === undefined ? undefined : ts.createSourceFile(filename, source, languageVersion);
  };
  expect(ts.getPreEmitDiagnostics(ts.createProgram(["/consumer/index.mts"], compilerOptions, host)).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  });
}

it.each(["missing", "symlink", "excluded", "traversal", "outside-dist"])("refuses inadmissible declared private assets: %s", async kind => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-example";
  const directory = `/repo/packages/${name}`;
  const asset = kind === "traversal" ? "./dist/../source.bin" : kind === "outside-dist" ? "./source.bin" : "./dist/profile.bin";
  volume.mkdirSync(directory + "/dist", { recursive: true });
  volume.writeFileSync(directory + "/package.json", JSON.stringify({
    name, private: true, type: "module", version: "0.0.1", dependencies: {}, devDependencies: {},
    files: kind === "excluded" ? ["dist", "!dist/profile.bin"] : ["dist"],
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync(directory + "/dist/index." + suffix, "export {};\n");
  if (kind === "symlink") volume.symlinkSync("/unowned.bin", directory + "/dist/profile.bin");
  if (kind === "excluded") volume.writeFileSync(directory + "/dist/profile.bin", "excluded");
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = { [name]: { version: "0.0.1", dependencies: {}, devDependencies: {}, assets: [asset] } };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow();
  expect(volume.existsSync(`/output/safe-bash/dist/${name}/profile.bin`)).toBe(false);
});

it.each(["admitted", "drift", "required", "unknown"])("preserves only explicitly admitted parent optional peers: %s", async kind => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-peer-fixture";
  const peers = { yaml: "2.9.0" };
  const metadata = { yaml: { optional: true } };
  const directory = `/repo/packages/${name}`;
  volume.mkdirSync(directory + "/dist", { recursive: true });
  volume.writeFileSync(directory + "/dist/profile.bin", "admitted");
  volume.writeFileSync(directory + "/package.json", JSON.stringify({
    name, private: true, type: "module", version: "0.0.1", dependencies: {}, devDependencies: {}, files: ["dist"],
    peerDependencies: kind === "drift" ? { yaml: "0.0.0" } : kind === "unknown" ? { other: "2.9.0" } : peers,
    peerDependenciesMeta: kind === "required" ? {} : metadata,
  }));
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = { [name]: {
    version: "0.0.1", dependencies: {}, devDependencies: {}, peerDependencies: peers,
    peerDependenciesMeta: metadata, assets: ["./dist/profile.bin"],
  } };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  if (kind === "admitted") await expect(packageSafeLibraries({ ...options, outDir: "/output" })).resolves.toBeDefined();
  else await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("profile mismatch");
});

it("rejects declared assets whose private workspace is missing", async () => {
  const { volume, options } = optionalLeftovers();
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = {
    "safe-bash-command-missing": { version: "0.0.1", dependencies: {}, devDependencies: {}, assets: ["./dist/profile.bin"] },
  };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Qualified private workspace profile mismatch");
});

it.each([false, true])("admits asset-only contract owners against the full private profile: private=%s", async privateFlag => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-contracts";
  volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/dist/profile.bin`, "must not be admitted");
  volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({
    name, private: privateFlag, type: "module", version: privateFlag ? "0.0.2" : "0.0.1",
  }));
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = { [name]: { version: "0.0.1", dependencies: {}, devDependencies: {}, assets: ["./dist/profile.bin"] } };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Qualified private workspace profile mismatch");
  expect(volume.existsSync(`/output/safe-bash/dist/${name}/profile.bin`)).toBe(false);
});

{
  const privatePackages = ["safe-bash-command-find", "safe-bash-command-xq", "safe-bash-command-jq", "safe-bash-xml-engine", "safe-bash-command-html-to-markdown", "safe-bash-command-shuf", "safe-bash-command-expr", "safe-bash-command-wget", "safe-bash-network-engine", "safe-bash-command-sed", "safe-bash-io-engine", "safe-bash-query-engine", "safe-bash-byte-engine", "safe-bash-calendar-engine", "safe-bash-contracts", "safe-bash-command-exiftool", "safe-bash-csv-engine", "safe-bash-command-csvgrep", "safe-bash-command-csvcut", "safe-bash-command-dos2unix", "safe-bash-command-unix2dos", "safe-bash-line-ending-engine", "safe-bash-command-mdq", "safe-bash-markdown-engine", "safe-bash-regex-engine"];

  // Build the package fixture separately from its consumer type and runtime checks.
    const fixture = optionalLeftovers();
    const { volume, options } = fixture;
    const repository = fileURLToPath(new URL("../", import.meta.url));
    const manifest = structuredClone(bashManifest);
    manifest.poeCode.integration.privateWorkspaces = {};
    manifest.exports = Object.fromEntries(Object.entries(manifest.exports).filter(([route]) => [".", "./contracts/*", "./commands/exiftool", "./commands/csvgrep", "./commands/csvcut", "./commands/line-endings", "./commands/mdq", "./commands/sed", "./commands/wget", "./commands/expr", "./commands/html-to-markdown", "./commands/find", "./commands/xq"].includes(route)));
    volume.rmSync("/repo/packages/safe-bash/dist", { recursive: true });
    volume.mkdirSync("/repo/packages/safe-bash/dist", { recursive: true });
    const rootSource = ts.createSourceFile("core.ts", readFileSync(path.join(repository, "packages/safe-bash/src/core.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const commandRootExports = rootSource.statements.filter(statement => ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && ["./commands/xq/index.js", "./commands/find/index.js"].includes(statement.moduleSpecifier.text)).map(statement => statement.getText(rootSource)).join("\n");
    for (const filename of ["index.d.ts", "core.d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/${filename}`, commandRootExports);
    const privateEntries: Record<string, string> = {};
    for (const name of privatePackages) {
      const directory = path.join(repository, "packages", name);
      const pkg = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
      manifest.poeCode.integration.privateWorkspaces[name] = {
        version: pkg.version, dependencies: pkg.dependencies ?? {}, devDependencies: pkg.devDependencies ?? {},
        ...(bashManifest.poeCode.integration.privateWorkspaces[name]?.portable === true ? { portable: true } : {}),
      };
      volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
      volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify(pkg));
      volume.writeFileSync(`/repo/packages/${name}/LICENSE`, readFileSync(path.join(directory, "LICENSE")));
      for (const filename of readdirSync(path.join(directory, "dist"))) {
        if (filename.startsWith("chunk-") && filename.endsWith(".js")) {
          volume.writeFileSync(`/repo/packages/${name}/dist/${filename}`, readFileSync(path.join(directory, "dist", filename)));
        }
      }
      for (const filename of readdirSync(path.join(directory, "src"), { recursive: true, encoding: "utf8" })) {
        if (!filename.endsWith(".ts") || filename.endsWith(".test.ts") || filename === "fixtures.ts") continue;
        const source = readFileSync(path.join(directory, "src", filename), "utf8");
        const compilerOptions = { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 };
        volume.mkdirSync(path.dirname(`/repo/packages/${name}/src/${filename}`), { recursive: true });
        volume.writeFileSync(`/repo/packages/${name}/src/${filename}`, source);
        volume.mkdirSync(path.dirname(`/repo/packages/${name}/dist/${filename}`), { recursive: true });
        const distJs = path.join(directory, "dist", `${filename.slice(0, -3)}.js`);
        if (existsSync(distJs)) volume.writeFileSync(`/repo/packages/${name}/dist/${filename.slice(0, -3)}.js`, readFileSync(distJs, "utf8"));
        privateEntries[`${name}/dist/${filename.slice(0, -3)}`] = path.join(directory, "src", filename);
        const distDts = path.join(directory, "dist", `${filename.slice(0, -3)}.d.ts`);
        const dtsText = getCachedDeclaration(distDts, source, compilerOptions);
        volume.writeFileSync(`/repo/packages/${name}/dist/${filename.slice(0, -3)}.d.ts`, dtsText);
      }
    }
    const portable = resolveBrowserShellBuild(repository, { external: ["safe-bash-contracts", "safe-bash-command-find", "safe-bash-command-xq", "safe-bash-command-expr", "@poe-platform/safe-fs"] });
    const [privateBuild, shell, fs, csvgrepRegex] = await Promise.all([
      build({ entryPoints: privateEntries, outdir: "/repo/packages",
        bundle: false, write: false, format: "esm", target: "es2022" }),
      build({ ...portable, splitting: false, sourcemap: false, minify: true,
        entryPoints: undefined,
        stdin: { contents: 'export { Shell } from "./src/shell/shell.ts"; export * from "safe-bash-contracts/command"; export * from "safe-bash-contracts/errors"; export * from "safe-bash-command-expr"; export * from "safe-bash-command-find"; export * from "safe-bash-command-xq";', resolveDir: path.join(repository, "packages/safe-bash") },
        outdir: undefined, outfile: "/repo/packages/safe-bash/dist/index.js",
      }),
      build({ entryPoints: [path.join(repository, "packages/safe-fs/src/core.ts")],
        bundle: true, write: false, platform: "browser", format: "esm", target: "es2022" }),
      build({ entryPoints: [path.join(repository, "packages/safe-bash-command-csvkit/src/python-regex.ts")],
        bundle: true, write: false, platform: "browser", format: "esm", target: "es2022" }),
    ]);
    for (const output of privateBuild.outputFiles!) if (!volume.existsSync(output.path)) volume.writeFileSync(output.path, output.contents);
    // Stage the real portable helper used by the focused csvgrep consumer.
    volume.writeFileSync("/repo/packages/safe-bash-command-csvgrep/dist/csvkit-python-regex.js", csvgrepRegex.outputFiles[0]!.contents);
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
    volume.mkdirSync("/repo/packages/safe-bash/browser", { recursive: true });
    for (const output of shell.outputFiles) {
      volume.mkdirSync(path.dirname(output.path), { recursive: true });
      volume.writeFileSync(output.path, output.contents);
    }
    // Both public routes share this fixture's Shell; package its source graph once.
    volume.writeFileSync("/repo/packages/safe-bash/dist/core.browser.js", 'export * from "./index.js";');
    const fsManifest = JSON.parse(volume.readFileSync("/repo/packages/safe-fs/package.json", "utf8").toString());
    fsManifest.exports["./core"] = { types: "./dist/core.d.ts", import: "./dist/core.js" };
    fsManifest.exports["./runtime-core"] = fsManifest.exports["./core"];
    volume.writeFileSync("/repo/packages/safe-fs/package.json", JSON.stringify(fsManifest));
    volume.writeFileSync("/repo/packages/safe-fs/dist/core.js", fs.outputFiles[0]!.contents);
    // The command type fixture models only its external filesystem contracts;
    // complete published declarations are checked by the installed consumer.
    volume.writeFileSync("/repo/packages/safe-fs/dist/core.d.ts", ['errors', 'filesystem', 'io'].map(name => `export * from "./contracts/${name}.js";`).join("\n") + '\nexport { assertPathWithin, isPathWithin, normalizePath, relativePath, resolvePath, validatePath } from "./contracts/virtual-path.js";\nexport { basename, dirname, extname, isAbsolutePath, joinPath, posixPath } from "./contracts/portable-path.js";');
    const declarationQueue = ["contracts/virtual-path.ts", "contracts/portable-path.ts", "contracts/errors.ts", "contracts/filesystem.ts", "contracts/io.ts", "platform/browser.ts", "platform/node.ts"], declared = new Set<string>();
    while (declarationQueue.length) {
      const relative = declarationQueue.pop()!;
      if (declared.has(relative)) continue;
      declared.add(relative);
      const source = readFileSync(path.join(repository, "packages/safe-fs/src", relative), "utf8");
      const destination = `/repo/packages/safe-fs/dist/${relative.slice(0, -3)}.d.ts`;
      volume.mkdirSync(path.dirname(destination), { recursive: true });
      const builtFsDts = path.join(repository, "packages/safe-fs/dist", `${relative.slice(0, -3)}.d.ts`);
      const fsDtsText = getCachedDeclaration(builtFsDts, source, { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 });
      volume.writeFileSync(destination, fsDtsText);
      for (const entry of ts.preProcessFile(source).importedFiles) {
        if (entry.fileName.startsWith(".")) {
          const filename = path.posix.normalize(path.posix.join(path.posix.dirname(relative), entry.fileName));
          declarationQueue.push(filename.endsWith(".js") ? filename.slice(0, -3) + ".ts" : filename + ".ts");
        }
      }
    }
    volume.mkdirSync("/repo/packages/safe-bash/dist/contracts", { recursive: true });
    for (const name of ["html-to-markdown", "exiftool", "csvgrep", "csvcut", "line-endings", "mdq", "sed", "wget", "expr", "find", "xq"]) volume.mkdirSync(`/repo/packages/safe-bash/dist/commands/${name}`, { recursive: true });
    for (const subpath of ["command", "value", "errors", "plugin"]) {
      for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/contracts/${subpath}.${suffix}`, `export * from "safe-bash-contracts/${subpath}";`);
    }
    for (const name of ["html-to-markdown", "exiftool", "csvgrep", "csvcut", "mdq", "sed", "wget", "expr", "find", "xq"]) for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/${name}/index.${suffix}`, `export * from "safe-bash-command-${name}";`);
    const lineEndingAdapter = readFileSync(new URL("../packages/safe-bash/src/commands/line-endings/index.ts", import.meta.url), "utf8");
    for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/line-endings/index.${suffix}`,
      suffix === "js" ? ts.transpileModule(lineEndingAdapter, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText : lineEndingAdapter);
    volume.writeFileSync("/repo/packages/safe-bash/dist/commands/line-endings/index.browser.js", 'export * from "./index.js";');
    volume.writeFileSync("/repo/packages/safe-bash/dist/commands/expr/index.browser.js", 'export * from "./index.js";');
    volume.writeFileSync("/repo/packages/safe-bash/dist/commands/mdq/index.browser.js", 'export * from "./index.js";');
    volume.writeFileSync("/repo/packages/safe-bash/dist/commands/html-to-markdown/index.browser.js", 'export * from "./index.js";');
    const plugin: Plugin = { name: "isolated-packed-files", setup(builder: import("esbuild").PluginBuild) {
      builder.onResolve({ filter: /.*/ }, args => {
        const alias = Object.entries(builder.initialOptions.alias ?? {})
          .filter(([name]) => args.path === name || args.path.startsWith(name + "/"))
          .sort(([left], [right]) => right.length - left.length)[0];
        const specifier = alias ? alias[1] + args.path.slice(alias[0].length) : args.path;
        if (builder.initialOptions.external?.some(name => specifier === name || specifier.startsWith(name + "/"))) return { path: specifier, external: true };
        if (specifier.startsWith("node:")) throw new Error("Node dependency in portable command consumer: " + specifier);
        let filename;
        if (specifier === "safe-bash-command-csvkit/python-regex") {
          filename = "/repo/packages/safe-bash-command-csvgrep/dist/csvkit-python-regex.js";
        } else if (specifier.startsWith("@poe-platform/")) {
          const [name, ...route] = specifier.slice("@poe-platform/".length).split("/");
          const pkg = JSON.parse(volume.readFileSync(`/output/${name}/package.json`, "utf8").toString());
          const key = route.length ? "./" + route.join("/") : ".";
          const target = pkg.exports[key] ?? pkg.exports["./contracts/*"];
          filename = `/output/${name}/` + (target.browser ?? target.import).replace("*", route.slice(1).join("/"));
        } else filename = path.resolve(args.resolveDir, specifier);
        if (filename.endsWith(".js") && volume.existsSync(filename.slice(0, -3) + ".ts")) filename = filename.slice(0, -3) + ".ts";
        if (!filename.startsWith("/output/") && !privatePackages.some(name => filename.startsWith(`/repo/packages/${name}/dist/`) || filename.startsWith(`/repo/packages/${name}/src/`))) throw new Error("Outside isolated consumer: " + filename);
        return { path: path.normalize(filename), namespace: "packed" };
      });
      builder.onLoad({ filter: /.*/, namespace: "packed" }, args => ({ contents: volume.readFileSync(args.path) as Buffer, loader: args.path.endsWith(".wasm") ? "dataurl" : args.path.endsWith(".ts") ? "ts" : "js", resolveDir: path.dirname(args.path) }));
    } };

  // Package the prepared source graph in a separate setup stage.
    await packageSafeLibraries({ ...options, outDir: "/output", bundle: async (settings: BuildOptions) => {
      if (settings.platform === "browser" && settings.entryPoints && "core.browser" in settings.entryPoints) {
        expect(settings.external).toContain("safe-bash-contracts");
        expect(settings.alias).not.toHaveProperty("safe-bash-contracts");
      }
      if (settings.outdir !== "/repo/packages") return options.bundle(settings);
      return build({ ...settings, sourcemap: false, minifyWhitespace: true, plugins: [plugin] });
    } });
    // Remove every workspace before resolving the consumer's public imports.
    volume.rmSync("/repo", { recursive: true });
    // Resolve the public declarations with no private workspace or package present.
    volume.mkdirSync("/output/node_modules/@poe-platform", { recursive: true });
    volume.symlinkSync("/output/safe-bash", "/output/node_modules/@poe-platform/safe-bash");
    volume.symlinkSync("/output/safe-fs", "/output/node_modules/@poe-platform/safe-fs");
    volume.writeFileSync("/output/safe-packages-dos2unix.mjs", readFileSync(new URL("./fixtures/safe-packages-dos2unix.mjs", import.meta.url)));
    volume.writeFileSync("/output/safe-packages-html-to-markdown.mjs", readFileSync(new URL("./fixtures/safe-packages-html-to-markdown.mjs", import.meta.url)));
    volume.writeFileSync("/output/html-to-markdown-consumer.mts", readFileSync(new URL("./fixtures/safe-packages-html-to-markdown-types.mts", import.meta.url)));
    volume.writeFileSync("/output/csvcut-consumer.mts", readFileSync(new URL("./fixtures/safe-packages-csvcut-types.mts", import.meta.url)));

  it("typechecks private command consumers through the isolated public package graph", () => {
    // Check the packaged declarations without rechecking TypeScript's own library.
    const compilerOptions = { module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022, strict: true, noEmit: true, skipDefaultLibCheck: true, types: [], customConditions: ["browser"] };
    const host = ts.createCompilerHost(compilerOptions);
    const nativeRead = host.readFile;
    const nativeExists = host.fileExists;
    const nativeDirectory = host.directoryExists;
    host.readFile = filename => filename.startsWith("/output/") ? volume.existsSync(filename) ? volume.readFileSync(filename, "utf8").toString() : undefined : nativeRead(filename);
    host.fileExists = filename => filename.startsWith("/output/") ? volume.existsSync(filename) : nativeExists(filename);
    host.directoryExists = filename => filename.startsWith("/output") ? volume.existsSync(filename) && volume.statSync(filename).isDirectory() : nativeDirectory?.(filename) ?? false;
    host.realpath = filename => filename.startsWith("/output/") ? volume.realpathSync(filename).toString() : filename;
    host.getSourceFile = (filename, languageVersion) => {
      const text = host.readFile(filename);
      return text === undefined ? undefined : ts.createSourceFile(filename, text, languageVersion);
    };
    volume.writeFileSync("/output/dos2unix-consumer.mts", 'import { createDos2unixCommand, createUnix2dosCommand, createDos2unixCommands, createLineEndingCommands, dos2unixCommands, lineEndingCommands, type Dos2unixCommandsOptions, type Dos2unixLimits, type LineEndingCommandsOptions, type LineEndingLimits } from "@poe-platform/safe-bash/commands/line-endings"; import type { CommandDefinition } from "@poe-platform/safe-bash/contracts/command"; const limits: Partial<Dos2unixLimits & LineEndingLimits> = { maxInputBytes: 1024 }; const options: Dos2unixCommandsOptions & LineEndingCommandsOptions = { limits }; const commands: CommandDefinition[] = [createDos2unixCommand(options), createUnix2dosCommand(options)]; const collection: typeof createDos2unixCommands = createLineEndingCommands; const plugin: typeof dos2unixCommands = lineEndingCommands; void [commands, collection(options), plugin(options)];');
    volume.writeFileSync("/output/mdq-consumer.mts", 'import { createMdqCommand, createMdqCommands, mdq, mdqCommands, type MdqCommandsOptions, type MdqLimits, type MdqRunOptions, type MdqResult } from "@poe-platform/safe-bash/commands/mdq"; import type { CommandContext, CommandDefinition } from "@poe-platform/safe-bash/contracts/command"; const limits: MdqLimits = { inputBytes: 1024 }; const commandOptions: MdqCommandsOptions = { limits }; const options: MdqRunOptions = { selectors: "# Title", files: ["/document.md"], output: "json", limits }; const command: CommandDefinition = createMdqCommand(commandOptions); const commands: readonly CommandDefinition[] = createMdqCommands(commandOptions); async function invoke(context: CommandContext): Promise<MdqResult> { return mdq(context, options); } void command; void commands; void invoke; void mdqCommands(commandOptions);');
    volume.writeFileSync("/output/sed-consumer.mts", readFileSync(new URL("./fixtures/safe-packages-sed-types.mts", import.meta.url)));
    volume.writeFileSync("/output/xq-consumer.mts", readFileSync(new URL("./fixtures/safe-packages-xq-types.mts", import.meta.url)));
    volume.writeFileSync("/output/find-consumer.mts", readFileSync(new URL("./fixtures/safe-packages-find-types.mts", import.meta.url)));
    const program = ts.createProgram(["/output/find-consumer.mts", "/output/xq-consumer.mts", "/output/html-to-markdown-consumer.mts", "/output/sed-consumer.mts", "/output/csvcut-consumer.mts", "/output/dos2unix-consumer.mts", "/output/mdq-consumer.mts"], compilerOptions, host);
    expect(ts.getPreEmitDiagnostics(program).map(diagnostic => `${diagnostic.file?.fileName ?? "compiler"}:${diagnostic.start ?? 0}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`)).toEqual([]);
  });

  it("executes wget after removing every private workspace", async () => {
    const consumer = await build({ stdin: { contents: readFileSync(new URL("./fixtures/safe-packages-wget.mjs", import.meta.url), "utf8"), resolveDir: "/output" },
      bundle: true, write: false, platform: "browser", format: "esm", target: "es2022", plugins: [plugin] });
    await import("data:text/javascript;base64," + Buffer.from(consumer.outputFiles[0]!.text).toString("base64"));
  });

  it("admits Shell byte argv through an isolated packed private command graph", async () => {
    const consumer = await build({ stdin: { contents: readFileSync(new URL("./fixtures/safe-packages-private-command.mjs", import.meta.url), "utf8"), resolveDir: "/output" },
      bundle: true, write: false, platform: "browser", format: "cjs", target: "es2022", plugins: [plugin] });
    const sandbox = createContext({ URL, TextEncoder, TextDecoder, TypeError, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
      AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance });
    // Execute fixture top-level await in the Buffer-free isolated realm.
    await runInContext(`(async () => { const module = { exports: {} }; ${consumer.outputFiles[0]!.text}; await module.exports.verification; })()`, sandbox);
  });

  it.each(["sed", "expr", "html-to-markdown", "find", "xq"])("executes %s through the isolated packed portable command graph", async command => {
    const consumer = await build({ stdin: { contents: readFileSync(new URL(`./fixtures/safe-packages-${command}.mjs`, import.meta.url), "utf8"), resolveDir: "/output" },
      bundle: true, write: false, platform: "browser", format: "cjs", target: "es2022", plugins: [plugin] });
    const sandbox = createContext({ URL, TextEncoder, TextDecoder, TypeError, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
      AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance });
    await runInContext(`(async () => { const module = { exports: {} }; ${consumer.outputFiles[0]!.text}; await module.exports.verification; })()`, sandbox);
  });

  it("executes mdq Markdown and typed JSON queries after removing every private workspace", async () => {
    const consumer = await build({ stdin: { contents: `
      import { Shell } from "@poe-platform/safe-bash";
      import { MemoryFileSystem } from "@poe-platform/safe-fs/core";
      import { mdq, mdqCommands } from "@poe-platform/safe-bash/commands/mdq";
      export async function run() {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/SPEC.md", new TextEncoder().encode("# Authentication\\n\\nUse tokens.\\n\\n## Token expiry\\n\\nOne hour.\\n"));
        const shell = new Shell({ fs }).use(mdqCommands());
        shell.commands.register({ name: "sdk-mdq", execute: context => mdq(context, { selectors: "# Authentication | # Token expiry", files: ["/SPEC.md"], output: "json" }) });
        try { return [await shell.exec("mdq '# Authentication | # Token expiry' < /SPEC.md"), await shell.exec("sdk-mdq")]; }
        finally { await shell.dispose(); }
      }
    `, resolveDir: "/output" }, bundle: true, write: false, platform: "browser", format: "cjs", target: "es2022", plugins: [plugin] });
    expect(volume.existsSync("/repo")).toBe(false);
    const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
    for (const name of ["safe-bash-command-mdq", "safe-bash-markdown-engine", "safe-bash-regex-engine"]) expect(manifest.dependencies).not.toHaveProperty(name);
    const sandbox = createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
      AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance });
    const result = await runInContext(`(async () => { const module = { exports: {} }; ${consumer.outputFiles[0]!.text}; return module.exports.run(); })()`, sandbox);
    expect(result).toMatchObject([
      { exitCode: 0, stdout: "## Token expiry\n\nOne hour.\n", stderr: "" },
      { exitCode: 0, stdout: '{"items":[{"section":{"depth":2,"title":"Token expiry","body":[{"paragraph":"One hour."}]}}]}', stderr: "" },
    ]);
  });
}

it("retains admitted private declarations even when public signatures erase the implementation types", async () => {
  const { volume, options } = optionalLeftovers();
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = {};
  for (const name of ["safe-bash-command-fixture", "safe-bash-fixture-engine"]) {
    const devDependencies = name === "safe-bash-command-fixture" ? { "safe-bash-fixture-engine": "*" } : {};
    const exports = name === "safe-bash-command-fixture"
      ? { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } }
      : { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./internal": { types: "./dist/internal.d.ts", import: "./dist/internal.js" } };
    manifest.poeCode.integration.privateWorkspaces[name] = { version: "0.0.1", dependencies: {}, devDependencies };
    manifest.devDependencies[name] = "*";
    volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
    volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({ name, version: "0.0.1", private: true, type: "module", dependencies: {}, devDependencies, exports }));
  }
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'export { run } from "safe-bash-command-fixture";');
  volume.writeFileSync("/repo/packages/safe-bash/dist/index.d.ts", "export declare function run(): void;");
  volume.writeFileSync("/repo/packages/safe-bash-command-fixture/dist/index.js", 'export { run } from "safe-bash-fixture-engine/internal";');
  volume.writeFileSync("/repo/packages/safe-bash-command-fixture/dist/index.d.ts", 'export { run } from "safe-bash-fixture-engine/internal";');
  volume.writeFileSync("/repo/packages/safe-bash-fixture-engine/dist/internal.js", "export function run() {}");
  volume.writeFileSync("/repo/packages/safe-bash-fixture-engine/dist/internal.d.ts", "export declare function run(): void;");
  volume.writeFileSync("/repo/packages/safe-bash-fixture-engine/dist/index.js", 'export { run } from "./internal.js";');
  volume.writeFileSync("/repo/packages/safe-bash-fixture-engine/dist/index.d.ts", 'export { run } from "./internal.js";');
  await packageSafeLibraries({ ...options, outDir: "/output" });
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash-command-fixture/index.d.ts", "utf8"))
    .toBe('export { run } from "../safe-bash-fixture-engine/internal.js";');
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash-fixture-engine/index.d.ts", "utf8"))
    .toBe('export { run } from "./internal.js";');
  const shipped = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
  expect(shipped.dependencies).toEqual({});
  expect(shipped.exports).not.toHaveProperty("./safe-bash-fixture-engine");
});

it.each([["bzip2", "index"], ["zstd", "index"], ["wkhtmltopdf", "index"], ["xz", "index"], ["pandoc", "index"], ["rg", "index"]])("packs %s and contract modules into one canonical relative graph", async (command, entry) => {
  const commandName = `safe-bash-command-${command}`;
  const commandSpecifier = commandName + (entry === "index" ? "" : "/" + entry);
  const commandManifest = JSON.parse(readFileSync(new URL(`../packages/${commandName}/package.json`, import.meta.url), "utf8"));
  expect(commandManifest.private).toBe(true);
  expect(commandManifest.exports[entry === "index" ? "." : "./" + entry]).toEqual({ types: `./dist/${entry}.d.ts`, workerd: `./dist/${entry}.js`, browser: `./dist/${entry}.js`, import: `./dist/${entry}.js` });
  expect(bashManifest.poeCode.integration.privateWorkspaces[commandName]).toBeDefined();
  const facade = ts.createSourceFile("index.ts", readFileSync(new URL(`../packages/safe-bash/src/commands/${command}/index.ts`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  expect(facade.statements.some(statement => (ts.isExportDeclaration(statement) || ts.isImportDeclaration(statement))
    && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === commandSpecifier)).toBe(true);
  const { volume, options } = optionalLeftovers();
  for (const [name, dependencies, devDependencies] of [
    ["safe-bash-contracts", {}, {}],
    [commandName, {}, { "safe-bash-contracts": "*" }],
  ] as const) {
    const entryName = name === commandName ? entry : "index";
    volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
    volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({
      name, version: "0.0.1", private: true, type: "module", dependencies, devDependencies,
      exports: { [entryName === "index" ? "." : "./" + entryName]: { types: `./dist/${entryName}.d.ts`, import: `./dist/${entryName}.js` } },
    }));
    volume.writeFileSync(`/repo/packages/${name}/dist/${entryName}.d.ts`, name === "safe-bash-contracts"
      ? "export declare const identity: object;" : 'export { identity } from "safe-bash-contracts";');
    volume.writeFileSync(`/repo/packages/${name}/dist/${entryName}.js`, name === "safe-bash-contracts"
      ? "export const identity = {};" : 'export { identity } from "safe-bash-contracts";');
  }
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = {
    "safe-bash-contracts": { version: "0.0.1", dependencies: {}, devDependencies: {} },
    [commandName]: { version: "0.0.1", dependencies: {}, devDependencies: { "safe-bash-contracts": "*" } },
  };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'export { identity } from "safe-bash-contracts";');
  volume.writeFileSync("/repo/packages/safe-bash/dist/index.d.ts", 'export { identity } from "safe-bash-contracts";');
  volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/${command}/index.js`, `export * from "${commandSpecifier}";`);
  volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/${command}/index.d.ts`, `export * from "${commandSpecifier}";`);
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const read = (path: string) => volume.readFileSync("/output/safe-bash/dist/" + path, "utf8");
  expect(read("safe-bash/index.js")).toContain('"../safe-bash-contracts/index.js"');
  expect(read(`safe-bash/commands/${command}/index.js`)).toContain(`"../../../${commandName}/${entry}.js"`);
  expect(read(`${commandName}/${entry}.js`)).toContain('"../safe-bash-contracts/index.js"');
  expect(read(`${commandName}/${entry}.d.ts`)).toContain('"../safe-bash-contracts/index.js"');
  const shipped = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
  expect(shipped.dependencies).toEqual({});
  expect(shipped.exports[`./commands/${command}`]).toEqual({
    types: `./dist/safe-bash/commands/${command}/index.d.ts`,
    workerd: `./dist/safe-bash/commands/${command}/${command === "pandoc" ? "index.browser" : "index"}.js`,
    browser: `./dist/safe-bash/commands/${command}/${command === "pandoc" ? "index.browser" : "index"}.js`,
    import: `./dist/safe-bash/commands/${command}/index.js`,
  });
  volume.writeFileSync(`/repo/packages/${commandName}/package.json`, JSON.stringify({
    name: commandName, private: false, type: "module", version: "0.0.1",
    dependencies: {}, devDependencies: { "safe-bash-contracts": "*" }, exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  await expect(packageSafeLibraries({ ...options, outDir: "/invalid" })).rejects.toThrow("Qualified private workspace profile mismatch");
});

function optionalLeftovers() {
  const data: Record<string, string> = {
    "/repo/package.json": JSON.stringify({ license: "MIT", exports: {
      "./safe-js": { types: "./packages/safe-js/dist/index.d.ts", import: "./packages/safe-js/dist/index.js" },
    } }),
    "/repo/packages/safe-js/package.json": JSON.stringify({ name: "private-js", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
    "/repo/packages/safe-fs/package.json": JSON.stringify({ name: "private-fs", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
    "/repo/packages/safe-bash/package.json": JSON.stringify(bashManifest),
  };
  for (const name of ["safe-js", "safe-fs", "safe-bash"]) {
    data[`/repo/packages/${name}/README.md`] = `# ${name}\n`;
    data[`/repo/packages/${name}/dist/index.js`] = "export {};\n";
    data[`/repo/packages/${name}/dist/index.d.ts`] = "export {};\n";
  }
  data["/repo/packages/safe-fs/dist/core.js"] = "export {};\n";
  data["/repo/packages/safe-fs/dist/core.d.ts"] = "export {};\n";
  const targets: unknown[] = Object.values(bashManifest.exports);
  while (targets.length) {
    const target = targets.pop();
    if (typeof target === "string") data["/repo/packages/safe-bash/" + target.replace("./", "").replaceAll("*", "probe")] = "export {};\n";
    else if (target && typeof target === "object") targets.push(...Object.values(target));
  }
  const excluded = (bashManifest.files as string[]).filter(file => file.startsWith("!"));
  for (const file of excluded.filter(file => file !== "!dist/opt-in")) {
    const relative = file.slice(1);
    if (relative.endsWith(".js") || relative.endsWith(".ts") || relative.endsWith(".map")) data["/repo/packages/safe-bash/" + relative] = relative.endsWith(".map") ? "{}\n" : "export {};\n";
    else for (const suffix of ["index.js", "index.d.ts", "index.js.map", "nested/data.json"]) data[`/repo/packages/safe-bash/${relative}/${suffix}`] = suffix.endsWith(".js") || suffix.endsWith(".ts") ? "export {};\n" : "{}\n";
  }
  for (const file of ["shell/arrays/state.js", "shell/extensions.js", "shell/extensions/read-extra/index.js", "optional.js-helper/index.js", "commands/dd-extra/index.js", "contracts/worker.mjs", "contracts/schema.json"]) {
    data["/repo/packages/safe-bash/dist/" + file] = file.endsWith(".json") ? "{}\n" : "export {};\n";
  }
  data["/repo/packages/safe-bash/dist/index.js.map"] = "{}\n";
  data["/repo/packages/safe-bash/dist/opt-in/optional.js"] = "export {};\n";
  data["/repo/packages/safe-bash/dist/opt-in/optional.d.ts"] = "export {};\n";
  for (const filename of ["LICENSE", "NOTICE"]) data["/repo/packages/safe-bash/third-party/playwright/" + filename] = readFileSync(new URL("../packages/safe-bash/third-party/playwright/" + filename, import.meta.url), "utf8");
  // Generic artifact fixtures include every declared asset owner. Individual
  // admission tests replace these profiles explicitly to exercise rejection.
  for (const [name, profile] of Object.entries(bashManifest.poeCode.integration.privateWorkspaces) as [string, { assets?: string[] }][]) {
    if (!profile.assets?.length) continue;
    const metadata = readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), "utf8");
    data[`/repo/packages/${name}/package.json`] = metadata;
    data[`/repo/packages/${name}/LICENSE`] = "Fixture license\n";
    for (const target of Object.values(JSON.parse(metadata).exports) as { types: string; import: string }[]) {
      data[`/repo/packages/${name}/` + target.import.slice(2)] = "export {};\n";
      data[`/repo/packages/${name}/` + target.types.slice(2)] = "export {};\n";
    }
    for (const asset of profile.assets) data[`/repo/packages/${name}/` + asset.slice(2)] = "Fixture asset\n";
  }
  const volume = Volume.fromJSON(data);
  const files = createFsFromVolume(volume).promises;
  const bundle = vi.fn(async (settings: { outdir?: string }) => ({ outputFiles: settings.outdir === "/repo/packages/safe-js/dist" ? [{ path: "/repo/packages/safe-js/dist/index.js", contents: Buffer.from(volume.readFileSync("/repo/packages/safe-js/dist/index.js")) }] : [] }));
  return { volume, data, excluded, options: { rootDir: "/repo", version: "0.1.0", files, bundle } };
}

it("packages SafeJS from workspace outputs when root exports use separate runtime and type ownership", async () => {
  const { volume, options } = optionalLeftovers();
  volume.writeFileSync("/repo/package.json", JSON.stringify({ license: "MIT", exports: {
    "./safe-js": {
      types: { browser: "./dist/types/safe-fs/node-unavailable.d.ts", default: "./dist/types/safe-js/index.d.ts" },
      browser: null, import: "./dist/shared/safe-js/index.js",
    },
  } }));
  volume.writeFileSync("/repo/packages/safe-fs/dist/node-unavailable.d.ts", "export {};\n");
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const manifest = JSON.parse(volume.readFileSync("/output/safe-js/package.json", "utf8").toString());
  expect(manifest.exports["."]).toEqual({
    types: { browser: "./dist/safe-fs/node-unavailable.d.ts", default: "./dist/safe-js/index.d.ts" },
    browser: null, import: "./dist/safe-js/index.js",
  });
  expect(volume.existsSync("/output/safe-js/dist/safe-js/index.js")).toBe(true);
});

it("resolves packaged real filesystem declarations for Workers while retaining browser restrictions", async () => {
  const { volume, options } = optionalLeftovers();
  const exports = {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./node": { types: "./dist/node/index.d.ts", import: "./dist/node/index.js" },
    "./fs/real": { types: "./dist/fs/real/index.d.ts", import: "./dist/fs/real/index.js" },
    "./fs/s3": { types: "./dist/fs/s3/index.d.ts", import: "./dist/fs/s3/index.js" },
    "./fs/s3/http": { types: "./dist/fs/s3/http/index.d.ts", import: "./dist/fs/s3/http/index.js" },
  };
  volume.writeFileSync("/repo/packages/safe-fs/package.json", JSON.stringify({ name: "@poe-code/safe-fs", exports }));
  for (const target of [...Object.values(exports).flatMap(value => Object.values(value)),
    "./dist/node-unavailable.d.ts", "./dist/node-host.d.ts", "./dist/node-host.js",
    "./dist/platform/node.d.ts", "./dist/platform/node.js", "./dist/platform/browser.d.ts", "./dist/platform/browser.js",
    "./dist/platform/node-path.d.ts", "./dist/platform/node-path.js", "./dist/platform/browser-path.d.ts", "./dist/platform/browser-path.js"]) {
    const filename = "/repo/packages/safe-fs/" + target.slice(2);
    volume.mkdirSync(path.dirname(filename), { recursive: true });
    volume.writeFileSync(filename, target.includes("/fs/real/") ? 'import "#safe-fs-platform"; import "#safe-fs-platform-path"; export {};\n' : "export {};\n");
  }
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const manifest = JSON.parse(volume.readFileSync("/output/safe-fs/package.json", "utf8").toString());
  expect(manifest.exports["./fs/real"]).toEqual({
    types: { workerd: "./dist/safe-fs/fs/real/index.d.ts", browser: "./dist/safe-fs/node-unavailable.d.ts", default: "./dist/safe-fs/fs/real/index.d.ts" },
    workerd: "./dist/safe-fs/fs/real/index.js", browser: null, import: "./dist/safe-fs/fs/real/index.js",
  });
  expect(Object.keys(manifest.exports["./fs/real"])).toEqual(["types", "workerd", "browser", "import"]);
  expect(Object.keys(manifest.exports["./fs/real"].types)).toEqual(["workerd", "browser", "default"]);
  expect(manifest.imports["#safe-fs-platform"]).toEqual({
    types: { workerd: "./dist/safe-fs/platform/browser.d.ts", browser: "./dist/safe-fs/platform/browser.d.ts", default: "./dist/safe-fs/platform/node.d.ts" },
    workerd: "./dist/safe-fs/platform/browser.js", browser: "./dist/safe-fs/platform/browser.js", default: "./dist/safe-fs/platform/node.js",
  });
  expect(manifest.exports["./fs/s3"]).toEqual({ types: "./dist/safe-fs/fs/s3/index.d.ts", import: "./dist/safe-fs/fs/s3/index.js" });
  for (const entry of ["./node", "./fs/s3/http"]) {
    expect(manifest.exports[entry].workerd).toBeUndefined();
    expect(manifest.exports[entry].types.workerd).toBeUndefined();
    expect(manifest.exports[entry].browser).toBeNull();
  }
  volume.mkdirSync("/consumer/node_modules/@poe-platform", { recursive: true });
  const packedPath = (filename: string) => filename.replace("/consumer/node_modules/@poe-platform/safe-fs", "/output/safe-fs");
  const host: ts.ModuleResolutionHost = {
    fileExists: filename => volume.existsSync(packedPath(filename)),
    readFile: filename => volume.existsSync(packedPath(filename)) ? volume.readFileSync(packedPath(filename), "utf8").toString() : undefined,
    directoryExists: filename => volume.existsSync(packedPath(filename)) && volume.statSync(packedPath(filename)).isDirectory(),
    getCurrentDirectory: () => "/consumer", realpath: filename => filename,
  };
  const resolve = (customConditions: string[]) => ts.resolveModuleName("@poe-platform/safe-fs/fs/real", "/consumer/main.mts", {
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, customConditions,
  }, host).resolvedModule?.resolvedFileName;
  expect(resolve(["workerd", "worker", "browser"])).toBe("/consumer/node_modules/@poe-platform/safe-fs/dist/safe-fs/fs/real/index.d.ts");
  expect(resolve(["browser"])).toBe("/consumer/node_modules/@poe-platform/safe-fs/dist/safe-fs/node-unavailable.d.ts");
  expect(resolve([])).toBe("/consumer/node_modules/@poe-platform/safe-fs/dist/safe-fs/fs/real/index.d.ts");
  const platform = (customConditions: string[]) => ts.resolveModuleName("#safe-fs-platform", "/consumer/node_modules/@poe-platform/safe-fs/dist/safe-fs/fs/real/index.d.ts", {
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, customConditions,
  }, host).resolvedModule?.resolvedFileName;
  for (const conditions of [["workerd"], ["workerd", "worker", "browser"], ["browser"]]) {
    expect(platform(conditions)).toBe("/consumer/node_modules/@poe-platform/safe-fs/dist/safe-fs/platform/browser.d.ts");
  }
  expect(platform([])).toBe("/consumer/node_modules/@poe-platform/safe-fs/dist/safe-fs/platform/node.d.ts");
  for (const [conditions, profile] of [[[], "node"], [["browser"], "browser"], [["workerd"], "browser"]] as const) {
    const pathPolicy = ts.resolveModuleName("#safe-fs-platform-path", "/consumer/node_modules/@poe-platform/safe-fs/dist/safe-fs/fs/real/index.d.ts", {
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, customConditions: [...conditions],
    }, host).resolvedModule?.resolvedFileName;
    expect(pathPolicy).toBe(`/consumer/node_modules/@poe-platform/safe-fs/dist/safe-fs/platform/${profile}-path.d.ts`);
  }
});

it("packages core jobs with one canonical public facade", async () => {
  const { volume, options } = optionalLeftovers();
  const directory = "/repo/packages/safe-bash/dist";
  volume.mkdirSync(directory + "/shell/extensions/jobs", { recursive: true });
  for (const suffix of ["js", "d.ts"]) {
    volume.writeFileSync(directory + "/index." + suffix, 'export { jobsExtension as defaultJobs, getJobsDisownBuiltin } from "./shell/extensions/jobs/index.js";\n');
    volume.writeFileSync(directory + "/jobs." + suffix, 'export { jobsExtension } from "./shell/extensions/jobs/index.js";\n');
    volume.writeFileSync(directory + "/shell/extensions/jobs/index." + suffix, 'export { jobsExtension, getJobsDisownBuiltin } from "./state.js";\n');
    volume.writeFileSync(directory + "/shell/extensions/jobs/state." + suffix, suffix === "js"
      ? 'export const jobsExtension = () => ({}); export const getJobsDisownBuiltin = () => undefined;\n'
      : 'export declare const jobsExtension: () => object; export declare const getJobsDisownBuiltin: () => undefined;\n');
  }
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
  expect(manifest.exports["./jobs"]).toEqual({
    types: "./dist/safe-bash/jobs.d.ts",
    workerd: "./dist/safe-bash/jobs.browser.js",
    browser: "./dist/safe-bash/jobs.browser.js",
    import: "./dist/safe-bash/jobs.js",
  });
  for (const suffix of ["js", "d.ts"]) {
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/jobs." + suffix, "utf8")).toContain('"./shell/extensions/jobs/index.js"');
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/shell/extensions/jobs/state." + suffix)).toBe(true);
  }
});

it('ships private wildcard modules used by a companion without private npm dependencies', async () => {
  const { volume, options } = optionalLeftovers();
  const manifest = structuredClone(bashManifest);
  manifest.devDependencies['@example/model'] = '*';
  volume.writeFileSync('/repo/packages/safe-bash/package.json', JSON.stringify(manifest));
  for (const [dir, pkg] of [
    ['companion', { name: 'companion', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      poeCode: { safeLibraryExports: { 'safe-bash': { './model': '.' } } } }],
    ['model', { name: '@example/model', exports: { './*': { types: './dist/*.d.ts', import: './dist/*.js' } } }]
  ] as const) {
    volume.mkdirSync(`/repo/packages/${dir}/dist/nested`, { recursive: true });
    volume.mkdirSync(`/repo/packages/${dir}/src/nested`, { recursive: true });
    volume.writeFileSync(`/repo/packages/${dir}/package.json`, JSON.stringify({ ...pkg, private: true, type: 'module' }));
  }
  volume.writeFileSync('/repo/packages/model/src/nested/value.ts', 'export const value = 42;');
  for (const extension of ['js', 'd.ts']) {
    volume.writeFileSync(`/repo/packages/companion/dist/index.${extension}`, 'export { value } from "@example/model/nested/value";');
    volume.writeFileSync(`/repo/packages/model/dist/nested/value.${extension}`, extension === 'js' ? 'export const value = 42;' : 'export declare const value: number;');
  }
  await packageSafeLibraries({ ...options, outDir: '/output' });
  for (const extension of ['js', 'd.ts']) {
    expect(volume.readFileSync(`/output/safe-bash/dist/companion/index.${extension}`, 'utf8'))
      .toBe('export { value } from "../model/nested/value.js";');
    expect(volume.existsSync(`/output/safe-bash/dist/model/nested/value.${extension}`)).toBe(true);
  }
  expect(JSON.parse(volume.readFileSync('/output/safe-bash/package.json', 'utf8')).dependencies).not.toHaveProperty('@example/model');
});

it('preserves companion references to conditional public contracts in the same published package', async () => {
  const { volume, options } = optionalLeftovers();
  const contractsManifest = structuredClone(bashManifest);
  contractsManifest.exports = Object.fromEntries(Object.entries(contractsManifest.exports)
    .filter(([route]) => route === "." || route.startsWith("./contracts")));
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(contractsManifest));
  const directory = '/repo/packages/mcp-companion';
  volume.mkdirSync(directory + '/dist', { recursive: true });
  volume.writeFileSync(directory + '/package.json', JSON.stringify({
    name: 'mcp-companion', private: true, type: 'module',
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    poeCode: { safeLibraryExports: { 'safe-bash': { './mcp': '.' } } },
  }));
  volume.writeFileSync(directory + '/dist/index.js', 'export { commandRuntimeIdentity } from "@poe-platform/safe-bash/contracts";');
  volume.writeFileSync(directory + '/dist/index.d.ts', 'export type { CommandDefinition } from "@poe-platform/safe-bash/contracts";');
  await packageSafeLibraries({ ...options, outDir: '/output' });
  const read = (path: string) => volume.readFileSync('/output/safe-bash/' + path, 'utf8');
  expect(read('dist/mcp-companion/index.js')).toContain('"@poe-platform/safe-bash/contracts"');
  expect(read('dist/mcp-companion/index.d.ts')).toContain('"@poe-platform/safe-bash/contracts"');
  const manifest = JSON.parse(read('package.json'));
  expect(manifest.exports['./mcp']).toEqual({
    types: './dist/mcp-companion/index.d.ts', import: './dist/mcp-companion/index.js',
  });
  expect(manifest.dependencies).not.toHaveProperty('@poe-platform/safe-bash');
});

it('ships companion command factories using the canonical private contracts', async () => {
  const { volume, options } = optionalLeftovers();
  const contractsManifest = structuredClone(bashManifest);
  contractsManifest.exports = Object.fromEntries(Object.entries(contractsManifest.exports)
    .filter(([route]) => route === "." || route.startsWith("./contracts")));
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {} };
  contractsManifest.poeCode.integration.privateWorkspaces["safe-bash-contracts"] = profile;
  volume.mkdirSync("/repo/packages/safe-bash-contracts/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/safe-bash-contracts/package.json", JSON.stringify({
    name: "safe-bash-contracts", private: true, type: "module", ...profile,
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  volume.writeFileSync("/repo/packages/safe-bash-contracts/dist/index.js", "export const commandRuntimeIdentity = {};");
  volume.writeFileSync("/repo/packages/safe-bash-contracts/dist/index.d.ts", "export interface CommandDefinition { name: string }");
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(contractsManifest));
  const directory = '/repo/packages/mcp-companion';
  volume.mkdirSync(directory + '/dist', { recursive: true });
  volume.writeFileSync(directory + '/package.json', JSON.stringify({
    name: 'mcp-companion', private: true, type: 'module',
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    poeCode: { safeLibraryExports: { 'safe-bash': { './mcp': '.', './commands/mcp': '.' } } },
  }));
  volume.writeFileSync(directory + '/dist/index.js', 'export { commandRuntimeIdentity } from "safe-bash-contracts";');
  volume.writeFileSync(directory + '/dist/index.d.ts', 'export type { CommandDefinition } from "safe-bash-contracts";');
  await packageSafeLibraries({ ...options, outDir: '/output' });
  const read = (path: string) => volume.readFileSync('/output/safe-bash/' + path, 'utf8');
  expect(read('dist/mcp-companion/index.js')).not.toContain('"safe-bash-contracts"');
  expect(read('dist/mcp-companion/index.d.ts')).not.toContain('"safe-bash-contracts"');
  const manifest = JSON.parse(read('package.json'));
  expect(manifest.exports['./mcp']).toEqual({
    types: './dist/mcp-companion/index.d.ts', import: './dist/mcp-companion/index.js',
  });
  expect(manifest.exports['./commands/mcp']).toEqual(manifest.exports['./mcp']);
  expect(manifest.dependencies).not.toHaveProperty('@poe-platform/safe-bash');
});

it('preserves companion conditional types and internal platform imports', async () => {
  const { volume, options } = optionalLeftovers();
  const directory = '/repo/packages/image-companion';
  volume.mkdirSync(directory + '/dist', { recursive: true });
  const types = { workerd: './dist/web.d.ts', browser: './dist/web.d.ts', default: './dist/node.d.ts' };
  volume.writeFileSync(directory + '/package.json', JSON.stringify({
    name: 'image-companion', private: true, type: 'module',
    imports: { '#image-streams': { types, workerd: './dist/web.js', browser: './dist/web.js', default: './dist/node.js' } },
    exports: { '.': { types, workerd: './dist/web.js', browser: null, import: './dist/node.js' } },
    poeCode: { safeLibraryExports: { 'safe-bash': { './sharp': '.' } } },
  }));
  for (const profile of ['node', 'web']) {
    volume.writeFileSync(directory + '/dist/' + profile + '.js', 'export const profile = ' + JSON.stringify(profile) + ';');
    volume.writeFileSync(directory + '/dist/' + profile + '.d.ts', 'export { profile } from "#image-streams";');
  }
  await packageSafeLibraries({ ...options, outDir: '/output' });
  const manifest = JSON.parse(volume.readFileSync('/output/safe-bash/package.json', 'utf8').toString());
  expect(manifest.exports['./sharp'].types.browser).toBe('./dist/image-companion/web.d.ts');
  expect(manifest.imports['#image-streams'].browser).toBe('./dist/image-companion/web.js');
  expect(manifest.imports['#image-streams'].types.default).toBe('./dist/image-companion/node.d.ts');
  expect(volume.readFileSync('/output/safe-bash/dist/image-companion/web.js', 'utf8').toString()).toContain('"web"');
  expect(manifest.exports['./sharp'].browser).toBeNull();
  expect(manifest.exports['./sharp'].workerd).toBe('./dist/image-companion/web.js');
});

it('refuses companion private imports outside their built distribution', async () => {
  const { volume, options } = optionalLeftovers();
  const directory = '/repo/packages/image-companion';
  volume.mkdirSync(directory + '/dist', { recursive: true });
  volume.mkdirSync('/repo/src', { recursive: true });
  volume.writeFileSync('/repo/src/private.ts', 'export {};');
  volume.writeFileSync(directory + '/package.json', JSON.stringify({
    name: 'image-companion', private: true, type: 'module',
    imports: { '#image-streams': { default: './src/private.ts' } },
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    poeCode: { safeLibraryExports: { 'safe-bash': { './sharp': '.' } } },
  }));
  volume.writeFileSync(directory + '/dist/index.js', 'export {};');
  volume.writeFileSync(directory + '/dist/index.d.ts', 'import "#image-streams";');
  await expect(packageSafeLibraries({ ...options, outDir: '/output' })).rejects.toThrow('Invalid companion import target');
});

it('ships an optional browser companion with generated assets and optional provider peers', async () => {
  const { volume, options } = optionalLeftovers();
  const directory = '/repo/packages/cloudflare-browser';
  volume.mkdirSync(directory + '/dist', { recursive: true });
  volume.writeFileSync(directory + '/package.json', JSON.stringify({
    name: '@poe-code/cloudflare-browser', private: true, type: 'module',
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    peerDependencies: { '@cloudflare/playwright': '1.3.6' },
    peerDependenciesMeta: { '@cloudflare/playwright': { optional: true } },
    poeCode: { safeLibraryExports: { 'safe-bash': { './playwright/cloudflare': '.' } } },
  }));
  volume.writeFileSync(directory + '/dist/index.js', 'export { guestSource } from "./guest.js"; import "cloudflare:workers";');
  volume.writeFileSync(directory + '/dist/index.d.ts', 'export declare const guestSource: string;');
  volume.writeFileSync(directory + '/dist/guest.js', 'export const guestSource = "minified worker source";');
  volume.writeFileSync(directory + '/dist/guest.d.ts', 'export declare const guestSource: string;');
  await packageSafeLibraries({ ...options, outDir: '/output' });
  const manifest = JSON.parse(volume.readFileSync('/output/safe-bash/package.json', 'utf8'));
  expect(manifest.exports['./playwright/cloudflare']).toEqual({
    types: './dist/cloudflare-browser/index.d.ts', import: './dist/cloudflare-browser/index.js',
  });
  expect(manifest.peerDependencies['@cloudflare/playwright']).toBe('1.3.6');
  expect(manifest.peerDependenciesMeta['@cloudflare/playwright']).toEqual({ optional: true });
  expect(manifest.dependencies).not.toHaveProperty('@cloudflare/playwright');
  expect(volume.readFileSync('/output/safe-bash/dist/cloudflare-browser/guest.js', 'utf8')).toContain('minified worker source');
});

it('ships companion license notices as included archive files', async () => {
  const { volume, options } = optionalLeftovers();
  const directory = '/repo/packages/browser-companion';
  volume.mkdirSync(directory + '/dist', {recursive: true});
  volume.writeFileSync(directory + '/package.json', JSON.stringify({
    name: '@poe-code/browser-companion', private: true, type: 'module',
    exports: {'.': {types: './dist/index.d.ts', import: './dist/index.js'}},
    poeCode: {safeLibraryExports: {'safe-bash': {'./playwright/cloudflare': '.'}}, safeLibraryNotices: {'safe-bash': ['./LICENSE.provider']}},
  }));
  volume.writeFileSync(directory + '/dist/index.js', 'export {};');
  volume.writeFileSync(directory + '/dist/index.d.ts', 'export {};');
  volume.writeFileSync(directory + '/LICENSE.provider', 'Full provider license');
  await packageSafeLibraries({...options, outDir: '/output'});
  expect(volume.readFileSync('/output/safe-bash/third-party/browser-companion/LICENSE.provider', 'utf8')).toBe('Full provider license');
});

it('publishes PDF vendor declaration dependencies and their full license notices', async () => {
  const { volume, options } = optionalLeftovers();
  const source = new URL('../packages/pdf-ast/', import.meta.url);
  const directory = '/repo/packages/pdf-ast';
  volume.mkdirSync(directory + '/dist/vendor', { recursive: true });
  volume.writeFileSync(directory + '/package.json', readFileSync(new URL('package.json', source)));
  volume.writeFileSync(directory + '/dist/index.js', 'export {};');
  volume.writeFileSync(directory + '/dist/index.d.ts', 'export { CFFParser } from "./vendor/pdfjs-fonts.mjs";');
  volume.writeFileSync(directory + '/dist/vendor/pdfjs-fonts.mjs', 'export class CFFParser {}');
  volume.writeFileSync(directory + '/dist/vendor/pdfjs-fonts.d.mts', 'export declare class CFFParser {}');
  const notices = ['THIRD_PARTY_NOTICES.md', 'licenses/PDFJS-APACHE-2.0.txt', 'licenses/PDFIUM-BSD.txt', 'licenses/PYPDF-BSD.txt', 'licenses/AGG-2.3.txt', 'licenses/MIT.txt'];
  for (const filename of notices) {
    volume.mkdirSync(path.dirname(directory + '/' + filename), { recursive: true });
    volume.writeFileSync(directory + '/' + filename, readFileSync(new URL(filename, source)));
  }
  await packageSafeLibraries({ ...options, outDir: '/output' });
  for (const extension of ['.mjs', '.d.mts']) {
    expect(volume.existsSync('/output/safe-bash/dist/pdf-ast/vendor/pdfjs-fonts' + extension)).toBe(true);
  }
  const manifest = JSON.parse(volume.readFileSync('/output/safe-bash/package.json', 'utf8').toString());
  expect(manifest.files).toContain('third-party');
  for (const filename of notices) {
    expect(volume.readFileSync('/output/safe-bash/third-party/pdf-ast/' + filename))
      .toEqual(readFileSync(new URL(filename, source)));
  }
});

it("preserves conditional private imports and ships their runtime and declaration targets", async () => {
  const { volume, options } = optionalLeftovers();
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({
    ...bashManifest, imports: { "#capability": {
      types: "./src/capability.ts", browser: "./dist/unavailable.js", default: "./dist/capability.js"
    } }
  }));
  volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'export { value } from "#capability";');
  volume.writeFileSync("/repo/packages/safe-bash/dist/capability.js", "export const value = 1;");
  volume.writeFileSync("/repo/packages/safe-bash/dist/capability.d.ts", "export declare const value: number;");
  volume.writeFileSync("/repo/packages/safe-bash/dist/unavailable.js", "export {};");
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8"));
  expect(manifest.imports).toEqual({ "#capability": {
    types: "./dist/safe-bash/capability.d.ts",
    browser: "./dist/safe-bash/unavailable.js",
    default: "./dist/safe-bash/capability.js"
  } });
  for (const target of Object.values(manifest.imports["#capability"]) as string[]) {
    expect(volume.existsSync("/output/safe-bash/" + target.slice(2))).toBe(true);
  }
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/index.js", "utf8"))
    .toContain('from "#capability"');
});

describe("scoped safe package artifacts", () => {
  it("ships the complete Playwright license and notice as npm-included package files", async () => {
    const { volume, options } = optionalLeftovers();
    await packageSafeLibraries({ ...options, outDir: "/output" });
    const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
    expect(manifest.files).toContain("third-party");
    for (const filename of ["LICENSE", "NOTICE"]) expect(volume.readFileSync("/output/safe-bash/third-party/playwright/" + filename, "utf8"))
      .toBe(readFileSync(new URL("../packages/safe-bash/third-party/playwright/" + filename, import.meta.url), "utf8"));
  });

  for (const filename of ["LICENSE", "NOTICE"]) it(`refuses to package Playwright without its ${filename}`, async () => {
    const { volume, options } = optionalLeftovers();
    volume.unlinkSync("/repo/packages/safe-bash/third-party/playwright/" + filename);
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow(filename);
  });

  it("ships the Playwright chunk and controller without adding it to the default entry", async () => {
    const { volume, options } = optionalLeftovers();
    volume.mkdirSync("/repo/packages/safe-bash/dist/playwright", { recursive: true });
    volume.writeFileSync("/repo/packages/safe-bash/dist/playwright/index.js", "export const controller = 1;");
    volume.writeFileSync("/repo/packages/safe-bash/dist/playwright/index.d.ts", "export declare const controller: 1;");
    for (const extension of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/playwright/index.${extension}`, 'export { controller } from "../../playwright/index.js";');
    await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/playwright/index.js", "utf8")).toBe("export const controller = 1;");
    const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
    expect(manifest.exports["./playwright"]).toEqual(manifest.exports["./commands/playwright"]);
    expect(manifest.dependencies).not.toHaveProperty("@poe-code/safe-playwright");
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/index.js", "utf8")).toBe("export {};\n");
  });

  it("excludes all currently declared optional leftovers while preserving every default member", async () => {
    const { volume, data, excluded, options } = optionalLeftovers();
    await packageSafeLibraries({ ...options, outDir: "/output" });
    const prefix = "/repo/packages/safe-bash/";
    const expected = Object.fromEntries(Object.entries(data).filter(([filename]) => filename.startsWith(prefix + "dist/") && !excluded.filter(entry => entry !== "!dist/opt-in").some(entry => {
      const omitted = prefix + entry.slice(1);
      return filename === omitted || filename.startsWith(omitted + "/");
    })).map(([filename, contents]) => [filename.replace(prefix + "dist/", "/output/safe-bash/dist/safe-bash/"), contents]));
    Object.assign(expected, {
      "/output/safe-bash/dist/safe-bash-command-git/LICENSE": data["/repo/packages/safe-bash-command-git/LICENSE"],
      "/output/safe-bash/dist/safe-bash-command-git/git_rust.wasm": data["/repo/packages/safe-bash-command-git/dist/git_rust.wasm"],
      "/output/safe-bash/dist/safe-bash-command-fold/LICENSE": data["/repo/packages/safe-bash-command-fold/LICENSE"],
      "/output/safe-bash/dist/safe-bash-command-fold/COPYING": data["/repo/packages/safe-bash-command-fold/dist/COPYING"],
      "/output/safe-bash/dist/safe-bash-command-fold/COPYING.LESSER": data["/repo/packages/safe-bash-command-fold/dist/COPYING.LESSER"],
      "/output/safe-bash/dist/safe-bash-command-fold/width-data.ts": data["/repo/packages/safe-bash-command-fold/dist/width-data.ts"],
      "/output/safe-bash/dist/safe-bash-command-xmllint/LICENSE": data["/repo/packages/safe-bash-command-xmllint/LICENSE"],
      "/output/safe-bash/dist/safe-bash-command-xmllint/index.d.ts": data["/repo/packages/safe-bash-command-xmllint/dist/index.d.ts"],
      "/output/safe-bash/dist/safe-bash-xml-engine/LICENSE": data["/repo/packages/safe-bash-xml-engine/LICENSE"],
      "/output/safe-bash/dist/safe-bash-xml-engine/index.d.ts": data["/repo/packages/safe-bash-xml-engine/dist/index.d.ts"],
      "/output/safe-bash/dist/safe-bash-command-dos2unix/LICENSE": data["/repo/packages/safe-bash-command-dos2unix/LICENSE"],
      "/output/safe-bash/dist/safe-bash-command-unix2dos/LICENSE": data["/repo/packages/safe-bash-command-unix2dos/LICENSE"],
      "/output/safe-bash/dist/safe-bash-line-ending-engine/LICENSE": data["/repo/packages/safe-bash-line-ending-engine/LICENSE"],
    });
    expected["/output/safe-bash/dist/safe-bash-sqlite-engine/LICENSE"] = data["/repo/packages/safe-bash-sqlite-engine/LICENSE"]!;
    expected["/output/safe-bash/dist/safe-bash-sqlite-engine/index.d.ts"] = "export {};\n";
    expected["/output/safe-bash/dist/safe-bash-sqlite-engine/safe-fs.d.ts"] = "export {};\n";
    expected["/output/safe-bash/dist/safe-bash-sqlite-engine/storage.d.ts"] = "export {};\n";
    for (const asset of ["LICENSE", "callback.wasm", "native.d.mts", "native.mjs", "native.wasm", "node-assets.mjs", "sources.json", "vfs.d.mts", "vfs.mjs"]) {
      expected["/output/safe-bash/dist/safe-bash-sqlite-engine/native/" + asset] = data["/repo/packages/safe-bash-sqlite-engine/dist/native/" + asset]!;
    }
    expected["/output/safe-bash/dist/safe-bash-compression-engine/LICENSE"] = data["/repo/packages/safe-bash-compression-engine/LICENSE"]!;
    for (const asset of ["sources.json", "LICENSES.txt", "generated/bz2.mjs", "generated/bz2.d.mts", "generated/xz.mjs", "generated/xz.d.mts", "generated/zstd.mjs", "generated/zstd.d.mts"]) {
      expected["/output/safe-bash/dist/safe-bash-compression-engine/native/" + asset] = data["/repo/packages/safe-bash-compression-engine/dist/native/" + asset]!;
    }
    for (const [name, entries] of [
      ["safe-bash-command-git", ["index"]],
      ["safe-bash-command-fold", ["index", "family"]],
      ["safe-bash-command-dos2unix", ["index"]],
      ["safe-bash-command-unix2dos", ["index"]],
      ["safe-bash-compression-engine", [
        "index", "bounded-codec", "codec-loader", "codec", "crc", "errors", "file-operation", "files",
        "gunzip", "internal", "operand", "options", "stream", "zstd-decode",
        "native/bz2", "native/types", "native/xz", "native/zstd",
      ]],
      ["safe-bash-line-ending-engine", ["index", "internal", "io", "stage", "convert", "encoding", "info", "command", "sync"]],
      ["safe-bash-xml-engine", ["document", "evaluate", "io", "json", "limits", "query"]],
    ] as const) {
      for (const entry of entries) expected[`/output/safe-bash/dist/${name}/${entry}.d.ts`] = "export {};\n";
    }
    delete expected["/output/safe-bash/dist/safe-bash/index.js.map"];
    const actual = Object.fromEntries(Object.entries(volume.toJSON()).filter(([filename]) => filename.startsWith("/output/safe-bash/dist/")));
    expect(actual).toEqual(expected);
    const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
    expect(Object.keys(manifest.exports)).toEqual(Object.keys(bashManifest.exports));
    for (const [key, target] of Object.entries(bashManifest.exports)) {
      expect(manifest.exports[key]).toEqual(JSON.parse(JSON.stringify(target, (_key, value: unknown) => typeof value === "string" ? value.replace("./dist/", "./dist/safe-bash/") : value)));
    }
  });

  for (const route of ["export", "runtime", "declaration", "dynamic", "asset"] as const) it(`rejects a default ${route} edge into an excluded optional member`, async () => {
    const { volume, options } = optionalLeftovers();
    if (route === "export") volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports: { ...bashManifest.exports, "./leak": { import: "./dist/optional.js" } } }));
    else if (route === "declaration") volume.writeFileSync("/repo/packages/safe-bash/dist/index.d.ts", 'export type Leak = import("./optional.js").Leak;');
    else volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", route === "runtime" ? 'export * from "./optional.js";' : route === "dynamic" ? 'export const leak = () => import("./shell/extensions/arrays/index.js");' : 'export const leak = new URL("./commands/dd/nested/data.json", import.meta.url);');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Excluded package file referenced:");
  });

  for (const route of ["export", "runtime", "declaration", "dynamic", "asset"] as const) it(`uses the referenced workspace's exclusions for a cross-package ${route} edge`, async () => {
    const { volume, options } = optionalLeftovers();
    if (route === "export") {
      const manifest = JSON.parse(volume.readFileSync("/repo/package.json", "utf8").toString());
      manifest.exports["./safe-js/leak"] = { import: "./packages/safe-bash/dist/optional.js" };
      volume.writeFileSync("/repo/package.json", JSON.stringify(manifest));
    } else if (route === "declaration") volume.writeFileSync("/repo/packages/safe-js/dist/index.d.ts", 'export type Leak = import("../../safe-bash/dist/optional.js").Leak;');
    else volume.writeFileSync("/repo/packages/safe-js/dist/index.js", route === "runtime" ? 'export * from "../../safe-bash/dist/optional.js";' : route === "dynamic" ? 'export const leak = () => import("../../safe-bash/dist/shell/extensions/arrays/index.js");' : 'export const leak = new URL("../../safe-bash/dist/commands/dd/nested/data.json", import.meta.url);');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Excluded package file referenced:");
    expect(Object.keys(volume.toJSON()).filter(filename => filename.startsWith("/output/safe-js/dist/safe-bash/"))).toEqual([]);
  });

  for (const excludeMap of [false, true]) it(`preserves cross-package runtime, declarations and assets without companion debug maps: excluded=${excludeMap}`, async () => {
    const { volume, options } = optionalLeftovers();
    volume.writeFileSync("/repo/packages/safe-js/dist/index.js", 'export * from "../../safe-bash/dist/contracts/worker.mjs"; export const data = new URL("../../safe-bash/dist/contracts/schema.json", import.meta.url);');
    volume.writeFileSync("/repo/packages/safe-js/dist/index.d.ts", 'export type Core = import("../../safe-bash/dist/contracts/probe.js").Core;');
    volume.writeFileSync("/repo/packages/safe-bash/dist/contracts/probe.d.ts", "export interface Core { ok: true }\n");
    volume.writeFileSync("/repo/packages/safe-bash/dist/contracts/worker.mjs.map", "{}\n");
    if (excludeMap) volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, files: [...bashManifest.files, "!dist/contracts/worker.mjs.map"] }));
    await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(volume.readFileSync("/output/safe-js/dist/safe-bash/contracts/worker.mjs", "utf8")).toBe("export {};\n");
    expect(volume.readFileSync("/output/safe-js/dist/safe-bash/contracts/schema.json", "utf8")).toBe("{}\n");
    expect(volume.readFileSync("/output/safe-js/dist/safe-bash/contracts/probe.d.ts", "utf8")).toBe("export interface Core { ok: true }\n");
    expect(volume.existsSync("/output/safe-js/dist/safe-bash/contracts/worker.mjs.map")).toBe(false);
    expect(volume.readFileSync("/output/safe-js/dist/safe-js/index.d.ts", "utf8")).toBe('export type Core = import("../safe-bash/contracts/probe.js").Core;');
  });

  it("honors additional literal exclusions, including auxiliary source maps", async () => {
    const { volume, options } = optionalLeftovers();
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, files: [...bashManifest.files, "!dist/contracts/worker.mjs", "!dist/index.js.map"] }));
    await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/contracts/worker.mjs")).toBe(false);
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/index.js.map")).toBe(false);
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/index.js", "utf8")).toBe("export {};\n");
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/contracts/schema.json", "utf8")).toBe("{}\n");
  });

  for (const exclusion of ["!dist/commands/*", "!../outside", "!/absolute", "!", "!."]) it(`refuses an unsupported exclusion rather than guessing its members: ${exclusion}`, async () => {
    const { volume, options } = optionalLeftovers();
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, files: [...bashManifest.files, exclusion] }));
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow(`Unsupported package file exclusion: ${exclusion}`);
  });
  it("rewrites module references without touching ordinary strings", () => {
    const source = 'import { FsError } from "poe-code/safe-fs"; export type F = import("poe-code/safe-js").F; const label = "poe-code/safe-fs"; new URL("poe-code/safe-fs", "https://example.com");';
    const result = rewriteModuleSpecifiers("api.d.ts", source, specifier => specifier.replace("poe-code/", "@poe-platform/"));
    expect(result).toContain('from "@poe-platform/safe-fs"');
    expect(result).toContain('import("@poe-platform/safe-js")');
    expect(result).toContain('label = "poe-code/safe-fs"');
    expect(result).toContain('new URL("poe-code/safe-fs", "https://example.com")');
  });

  it.each([true, false])("packages canonical runtime and declaration closures (root declares Worker entry: %s)", async rootDeclaresWorker => {
    const volume = Volume.fromJSON({
      "/repo/package.json": JSON.stringify({ license: "MIT", dependencies: { external: "^2.0.0" }, exports: {
        "./safe-js": { types: "./packages/safe-js/dist/index.d.ts", import: "./packages/safe-js/dist/index.js" },
        ...(rootDeclaresWorker ? { "./safe-js/workerd": { types: "./packages/safe-js/dist/workerd.d.ts", workerd: "./packages/safe-js/dist/workerd.js", browser: null, import: "./packages/safe-js/dist/workerd.js" } } : {}),
        "./safe-fs": { types: "./packages/safe-fs/dist/index.d.ts", import: "./packages/safe-js/dist/safe-fs.js" },
      } }),
      "/repo/packages/safe-js/package.json": JSON.stringify({ name: "private-js", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./workerd": { types: "./dist/workerd.d.ts", workerd: "./dist/workerd.js", browser: null, import: "./dist/workerd.js" } } }),
      "/repo/packages/safe-fs/package.json": JSON.stringify({ name: "@poe-code/safe-fs", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./core": { types: "./dist/core.d.ts", import: "./dist/core.js" }, "./node": { types: "./dist/node-host.d.ts", import: "./dist/node-host.js" } } }),
      "/repo/packages/safe-bash/package.json": JSON.stringify({ name: "private-bash", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
      "/repo/packages/safe-js/README.md": "# SafeJS\n",
      "/repo/packages/safe-fs/README.md": "# SafeFS\n",
      "/repo/packages/safe-bash/README.md": "# Safe Bash\n",
      "/repo/packages/safe-js/dist/index.js": 'export { value } from "./chunks/shared.js";',
      "/repo/packages/safe-js/dist/chunks/shared.js": 'import external from "external"; export const value = external;',
      "/repo/packages/safe-js/dist/index.d.ts": 'export type { HostOptions } from "private-host"; export type { Value } from "../../helper/dist/index.js"; export { FsError } from "../../safe-fs/dist/index.js";',
      "/repo/packages/safe-js/dist/workerd.d.ts": 'export { value } from "./index.js";',
      "/repo/packages/private-host/package.json": JSON.stringify({ name: "private-host", private: true, types: "./dist/index.d.ts" }),
      "/repo/packages/private-host/dist/index.d.ts": 'export interface HostOptions { signal?: AbortSignal; }',
      "/repo/packages/helper/dist/index.d.ts": 'export interface Value { ok: boolean }',
      "/repo/packages/safe-js/dist/safe-fs.js": 'export class FsError extends Error {}',
      "/repo/packages/safe-fs/dist/index.d.ts": 'export declare class FsError extends Error {}',
      "/repo/packages/safe-fs/dist/index.js": 'export class FsError extends Error {}',
      "/repo/packages/safe-fs/dist/core.js": 'export { FsError } from "./index.js";',
      "/repo/packages/safe-fs/dist/core.d.ts": 'export { FsError } from "./index.js";',
      "/repo/packages/safe-fs/dist/node-host.js": 'export { FsError } from "./index.js";',
      "/repo/packages/safe-fs/dist/node-host.d.ts": 'export { FsError } from "./index.js";',
      "/repo/packages/safe-fs/dist/node-unavailable.d.ts": 'export {};',
      "/repo/packages/safe-bash/dist/index.js": 'export { FsError } from "poe-code/safe-fs";',
      "/repo/packages/safe-bash/dist/index.d.ts": 'export { FsError } from "poe-code/safe-fs";',
    });
    const files = createFsFromVolume(volume).promises;
    const bundle = vi.fn(async (options: { conditions?: string[]; entryPoints?: Record<string, string> }) => ({ outputFiles: options.conditions?.includes("workerd")
      ? [{ path: "/repo/packages/safe-js/dist/workerd.js", contents: Buffer.from('export const value = "workerd-context";') }]
      : [{ path: "/repo/packages/safe-js/dist/index.js", contents: Buffer.from('export { value } from "./chunks/shared.js"; export { FsError } from "@poe-platform/safe-fs";') }] }));
    const options = { rootDir: "/repo", version: "0.1.0", files, bundle };
    await packageSafeLibraries({ ...options, outDir: "/output" });
    const read = (path: string) => volume.readFileSync(path, "utf8").toString();
    const js = JSON.parse(read("/output/safe-js/package.json"));
    const bash = JSON.parse(read("/output/safe-bash/package.json"));
    const filesystem = JSON.parse(read("/output/safe-fs/package.json"));
    expect(filesystem.name).toBe("@poe-platform/safe-fs");
    expect(filesystem.private).toBeUndefined();
    expect(filesystem.dependencies).toEqual({});
    expect(filesystem.exports["."].browser).toBe("./dist/safe-fs/core.js");
    expect(filesystem.exports["./node"].browser).toBeNull();
    expect(filesystem.imports["#safe-fs-platform"].browser).toBe("./dist/safe-fs/platform/browser.js");
    expect(bundle).toHaveBeenCalledWith(expect.objectContaining({
      alias: expect.objectContaining({ "@poe-code/safe-fs": "@poe-platform/safe-fs" }),
      external: expect.arrayContaining(["@poe-platform/safe-fs"]), write: false,
    }));
    expect(js.name).toBe("@poe-platform/safe-js");
    expect(js.private).toBeUndefined();
    expect(js.exports["./workerd"].workerd).toBe("./dist/safe-js/workerd.js");
    expect(js.exports["./workerd"].browser).toBeNull();
    expect(read("/output/safe-js/dist/safe-js/workerd.js")).toContain("workerd-context");
    expect(bundle).toHaveBeenCalledWith(expect.objectContaining({ conditions: ["workerd"], splitting: false }));
    expect(Object.keys(bundle.mock.calls[0]![0].entryPoints!)).not.toContain("workerd");
    expect(js.files).toEqual(["dist"]);
    expect(js.repository.directory).toBe("packages/safe-js");
    expect(js.dependencies).toEqual({ external: "^2.0.0", "@poe-platform/safe-fs": "0.1.0" });
    expect(read("/output/safe-js/" + js.exports["./fs"].import)).toContain('"@poe-platform/safe-fs"');
    expect(volume.existsSync("/output/safe-js/dist/safe-fs")).toBe(false);
    expect(bash.dependencies).toEqual({ "@poe-platform/safe-fs": "0.1.0" });
    expect(read("/output/safe-bash/dist/safe-bash/index.js")).toContain('"@poe-platform/safe-fs"');
    expect(read("/output/safe-js/dist/safe-js/index.d.ts")).toContain('"@poe-platform/safe-fs"');
    expect(read("/output/safe-js/dist/safe-js/index.d.ts")).toContain('"../helper/index.js"');
    expect(read("/output/safe-js/dist/helper/index.d.ts")).toContain("interface Value");
    expect(read("/output/safe-js/dist/safe-js/index.d.ts")).toContain('"../private-host/index.js"');
    expect(read("/output/safe-js/dist/private-host/index.d.ts")).toContain("signal?: AbortSignal");
    expect(volume.existsSync("/output/safe-js/dist/private-host/index.js")).toBe(false);
    volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'import host from "private-host";');
    await expect(packageSafeLibraries({ ...options, outDir: "/private-runtime" })).rejects.toThrow("Private or CLI dependency leaked: private-host");
    volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'export { FsError } from "poe-code/safe-fs";');
    volume.writeFileSync("/repo/packages/safe-js/dist/index.d.ts", 'export type { HostOptions } from "private-host/hidden";');
    await expect(packageSafeLibraries({ ...options, outDir: "/unexported-private-type" })).rejects.toThrow("Missing private workspace declaration entrypoint: private-host/hidden");
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(packageSafeLibraries({ ...options, outDir: "/repo/packages/output" })).rejects.toThrow("overwrite workspace");
    await expect(packageSafeLibraries({ ...options, outDir: "/bad-version", version: "latest" })).rejects.toThrow("valid explicit");
    volume.writeFileSync("/repo/packages/safe-js/dist/index.d.ts", 'export type { HostOptions } from "private-host";');
    volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'import cli from "poe-code";');
    await expect(packageSafeLibraries({ ...options, outDir: "/private-leak" })).rejects.toThrow("CLI dependency leaked");
  });
});

function optionalArtifact() {
  const fixture = optionalLeftovers();
  const { volume } = fixture;
  volume.mkdirSync("/repo/packages/safe-bash/dist/opt-in/commands/yq", { recursive: true });
  volume.mkdirSync("/repo/packages/safe-bash/dist/opt-in/fs/devices", { recursive: true });
  const exports = Object.fromEntries(Object.entries(bashManifest.exports).filter(([, value]) => !(value as { import?: string }).import?.startsWith("./dist/opt-in/")));
  Object.assign(exports, {
    "./yq": { types: "./dist/opt-in/commands/yq/mike.d.ts", import: "./dist/opt-in/commands/yq/mike.js" },
    "./devices": { types: "./dist/opt-in/fs/devices/index.d.ts", import: "./dist/opt-in/fs/devices/index.js" },
  });
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports }));
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", 'export * from "./fs/devices/index.js"; export * from "./commands/yq/mike.js";');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", 'export * from "./fs/devices/index.js"; export * from "./commands/yq/mike.js";');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/fs/devices/index.js", 'import { FsError } from "@poe-platform/safe-fs"; import { host } from "@poe-platform/safe-bash/optional-host"; const asset = new URL("./profile.json", import.meta.url); export { FsError, host, asset };');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/fs/devices/index.d.ts", 'export type Value = import("@poe-platform/safe-bash").Value; export type FS = import("@poe-platform/safe-fs").FS;');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/fs/devices/profile.json", '{"profile":"fixture"}\n');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/commands/yq/mike.js", 'export const yaml = () => import("yaml");');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/commands/yq/mike.d.ts", 'export type YAML = import("yaml").Document;');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/unreachable.js", 'import "private-unused";');
  return fixture;
}

describe("explicit optional safe package artifact", () => {
  it("embeds YAML used by core tools without installing the optional yq peer", async () => {
    const { volume, options } = optionalArtifact();
    const root = JSON.parse(volume.readFileSync("/repo/package.json", "utf8").toString());
    volume.writeFileSync("/repo/package.json", JSON.stringify({ ...root, dependencies: { yaml: "2.9.0" } }));
    volume.mkdirSync("/repo/node_modules/yaml", { recursive: true });
    volume.writeFileSync("/repo/node_modules/yaml/package.json", JSON.stringify({ name: "yaml", version: "2.9.0" }));
    volume.writeFileSync("/repo/node_modules/yaml/LICENSE", "YAML fixture license");
    volume.mkdirSync("/repo/packages/safe-bash-command-pandoc/dist", { recursive: true });
    volume.writeFileSync("/repo/packages/safe-bash-command-pandoc/dist/defaults.js", 'export { parseDocument } from "yaml";');
    volume.mkdirSync("/repo/packages/safe-bash-command-yq/dist", { recursive: true });
    volume.writeFileSync("/repo/packages/safe-bash-command-yq/dist/comments.d.ts", 'import type { CST, Node } from "yaml"; export type { CST, Node };');
    volume.writeFileSync("/repo/packages/safe-js/dist/index.js", 'export { parse } from "yaml";');
    volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'export { parseDocument } from "yaml"; export * from "../../safe-bash-command-pandoc/dist/defaults.js";');
    const bundle = vi.fn(async (recipe: BuildOptions) => recipe.outfile?.endsWith("/bundled-yaml/index.js")
      ? build({ ...recipe, absWorkingDir: path.resolve(import.meta.dirname, ".."),
        stdin: { ...recipe.stdin!, resolveDir: path.resolve(import.meta.dirname, "..") } })
      : options.bundle(recipe));
    await packageSafeLibraries({ ...options, bundle, outDir: "/output" });
    const jsManifest = JSON.parse(volume.readFileSync("/output/safe-js/package.json", "utf8").toString());
    expect(jsManifest.dependencies.yaml).toBeUndefined();
    expect(volume.readFileSync("/output/safe-js/dist/safe-js/index.js", "utf8")).toContain('"./bundled-yaml/index.js"');
    expect(volume.readFileSync("/output/safe-js/dist/safe-js/bundled-yaml/LICENSE", "utf8")).toBe("YAML fixture license");
    const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
    expect(manifest.dependencies.yaml).toBeUndefined();
    expect(manifest.peerDependencies.yaml).toBe("2.9.0");
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/index.js", "utf8")).toContain('"./bundled-yaml/index.js"');
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash-command-pandoc/defaults.js", "utf8")).toContain('"../safe-bash/bundled-yaml/index.js"');
    const parser = volume.readFileSync("/output/safe-bash/dist/safe-bash/bundled-yaml/index.js", "utf8").toString();
    const embedded = await import("data:text/javascript;base64," + Buffer.from(parser).toString("base64"));
    expect(embedded.parseDocument("from: markdown\nto: html").toJS()).toEqual({ from: "markdown", to: "html" });
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/bundled-yaml/LICENSE", "utf8")).toBe("YAML fixture license");
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/opt-in/commands/yq/mike.js", "utf8")).toContain('import("yaml")');
    expect(bundle).toHaveBeenCalledWith(expect.objectContaining({ bundle: true, platform: "browser", write: false }));
  });

  it("rejects explicitly blocked optional peer declaration conditions", async () => {
    const { volume, options } = optionalArtifact();
    const manifest = JSON.parse(volume.readFileSync("/repo/packages/safe-bash/package.json", "utf8").toString());
    manifest.exports["./optional-host"].types = { import: null, default: "./dist/optional-host.d.ts" };
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", 'export type Host = import("@poe-platform/safe-bash/optional-host").Host;');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Unexported optional peer route");
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("restores public peer routes in declarations rewritten by the root build", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", 'export type Host = import("../optional-host.js").Host;');
    await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/opt-in/optional.d.ts", "utf8")).toContain('import("@poe-platform/safe-bash/optional-host")');
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/optional-host.d.ts")).toBe(false);
  });

  it("rejects relative optional declarations targeting an unexported core file", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/private-core.d.ts", "export interface Host {};");
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", 'export type Host = import("../private-core.js").Host;');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("escapes owned output");
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("restores verified wildcard peer routes in optional declarations", async () => {
    const { volume, options } = optionalArtifact();
    volume.mkdirSync("/repo/packages/safe-bash/dist/contracts", { recursive: true });
    volume.writeFileSync("/repo/packages/safe-bash/dist/contracts/value.d.ts", "export interface ShellValue {};");
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", 'export type Value = import("../contracts/value.js").ShellValue;');
    await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/opt-in/optional.d.ts", "utf8")).toContain('import("@poe-platform/safe-bash/contracts/value")');
  });

  it("restores a conditional public root declaration route", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", 'export { Shell } from "../index.js";');
    await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/opt-in/optional.d.ts", "utf8")).toContain('from "@poe-platform/safe-bash"');
  });

  it("rejects wildcard reverse routes shadowed by a different exact export", async () => {
    const { volume, options } = optionalArtifact();
    const manifest = JSON.parse(volume.readFileSync("/repo/packages/safe-bash/package.json", "utf8").toString());
    manifest.exports["./contracts/value"] = { types: "./dist/alternate.d.ts", import: "./dist/alternate.js" };
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
    volume.mkdirSync("/repo/packages/safe-bash/dist/contracts", { recursive: true });
    volume.writeFileSync("/repo/packages/safe-bash/dist/contracts/value.d.ts", "export interface ShellValue {};");
    volume.writeFileSync("/repo/packages/safe-bash/dist/alternate.d.ts", "export interface DifferentValue {};");
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", 'export type Value = import("../contracts/value.js").ShellValue;');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow();
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("ships the optional closure through the core package's explicit subpath without changing its default entry", async () => {
    const { volume, options } = optionalArtifact();
    const result = await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(result.map(entry => entry.name)).toEqual(["@poe-platform/safe-fs", "@poe-platform/safe-js", "@poe-platform/safe-bash"]);
    const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
    expect(manifest.exports["./yq"]).toEqual({ types: "./dist/safe-bash/opt-in/commands/yq/mike.d.ts", import: "./dist/safe-bash/opt-in/commands/yq/mike.js" });
    expect(manifest.exports["./optional"]).toBeUndefined();
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/opt-in/optional.js", "utf8")).toBe(volume.readFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", "utf8"));
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/index.js", "utf8")).toBe("export {};\n");
    expect(manifest.dependencies.yaml).toBeUndefined();
    expect(manifest.peerDependencies).toEqual({ yaml: "2.9.0" });
    expect(manifest.peerDependenciesMeta).toEqual({ yaml: { optional: true } });
    expect(volume.existsSync("/output/safe-bash-optional")).toBe(false);
  });

  it("keeps default runtime bytes identical when optional output is present", async () => {
    const baseline = optionalLeftovers();
    const optional = optionalArtifact();
    await packageSafeLibraries({ ...baseline.options, outDir: "/output" });
    const result = await packageSafeLibraries({ ...optional.options, outDir: "/output" });
    expect(result.map(entry => entry.name)).toEqual(["@poe-platform/safe-fs", "@poe-platform/safe-js", "@poe-platform/safe-bash"]);
    const artifacts = (volume: Volume) => Object.fromEntries(Object.entries(volume.toJSON()).filter(([name]) => name.startsWith("/output/")));
    const baselineFiles = artifacts(baseline.volume);
    const optionalFiles = artifacts(optional.volume);
    for (const [filename, contents] of Object.entries(baselineFiles)) {
      if (filename !== "/output/safe-bash/package.json" && !filename.includes("/opt-in/")) expect(optionalFiles[filename]).toEqual(contents);
    }
    expect(optional.volume.existsSync("/output/safe-bash-optional")).toBe(false);
  });

  it("embeds only the optional runtime/declaration/asset closure in the core tarball", async () => {
    const { volume, options } = optionalArtifact();
    const result = await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(result.map(entry => entry.name)).toEqual(["@poe-platform/safe-fs", "@poe-platform/safe-js", "@poe-platform/safe-bash"]);
    const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
    expect(manifest).toMatchObject({
      name: "@poe-platform/safe-bash", version: "0.1.0", type: "module", license: "MIT", engines: { node: ">=22" }, files: ["dist", "third-party"],
      exports: { "./yq": { types: "./dist/safe-bash/opt-in/commands/yq/mike.d.ts", import: "./dist/safe-bash/opt-in/commands/yq/mike.js" } },
      peerDependencies: { yaml: "2.9.0" },
      peerDependenciesMeta: { yaml: { optional: true } }, publishConfig: { access: "public" },
      repository: { type: "git", url: "git+https://github.com/poe-platform/poe-code.git", directory: "packages/safe-bash" },
    });
    expect(manifest.dependencies["@poe-platform/safe-bash"]).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.private).toBeUndefined();
    const copied = Object.entries(volume.toJSON()).filter(([name]) => name.startsWith("/output/safe-bash/dist/safe-bash/opt-in/"));
    expect(copied).toHaveLength(7);
    for (const [filename, contents] of copied) expect(contents).toEqual(volume.readFileSync(filename.replace("/output/safe-bash/dist/safe-bash/opt-in/", "/repo/packages/safe-bash/dist/opt-in/"), "utf8"));
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/unreachable.js")).toBe(false);
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/safe-bash")).toBe(false);
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/safe-fs")).toBe(false);
  });

  for (const missing of ["optional.js", "optional.d.ts"]) it(`refuses missing optional prerequisite before any output: ${missing}`, async () => {
    const { volume, options } = optionalArtifact();
    volume.unlinkSync("/repo/packages/safe-bash/dist/opt-in/" + missing);
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow(missing);
    expect(volume.existsSync("/output")).toBe(false);
  });

  for (const source of [
    'import "@poe-platform/safe-bash/unmapped";', 'import "poe-code/safe-fs";', 'import "@poe-code/safe-fs";',
    'import "@poe-platform/safe-bash/private-unexported";', 'import "@poe-platform/safe-fs/private-unexported";',
    'import "@poe-platform/safe-js";', 'import "yaml/private";', 'import "#safe-fs-platform";',
    'import "../../safe-bash/dist/index.js";', 'import "../../safe-fs/dist/index.js";',
    'const edge = "./optional.js"; import(edge);', 'require(variable);',
    'new URL(variable, import.meta.url);', 'new URL("https://example.com/asset", import.meta.url);',
  ]) it(`refuses an unmapped or nonliteral optional runtime edge: ${source}`, async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", source);
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow();
    expect(volume.existsSync("/output")).toBe(false);
  });

  for (const source of [
    'export type Value = import("@poe-platform/safe-bash/unmapped").Value;',
    'export type Value = import("@poe-platform/safe-bash/private-unexported").Value;',
    '/// <reference path="../../safe-bash/dist/index.d.ts" />\nexport {};',
    'import Value = require("@poe-platform/safe-bash"); export { Value };',
  ]) it(`refuses unmapped declaration edges: ${source}`, async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", source);
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow();
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("refuses copying a core identity module under the optional dist tree", async () => {
    const { volume, options } = optionalArtifact();
    volume.mkdirSync("/repo/packages/safe-bash/dist/opt-in/contracts", { recursive: true });
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/contracts/errors.js", "export class FsError extends Error {};");
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", 'export * from "./contracts/errors.js";');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("optional-owned");
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("requires declaration targets rather than falling back to a runtime module", async () => {
    const { volume, options } = optionalArtifact();
    volume.unlinkSync("/repo/packages/safe-bash/dist/opt-in/fs/devices/index.d.ts");
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("index.d.ts");
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("handles cycles without copying a module twice", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/commands/yq/mike.js", 'export * from "../../optional.js";');
    const result = await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(result.at(-1)?.name).toBe("@poe-platform/safe-bash");
    expect(Object.keys(volume.toJSON()).filter(filename => filename.startsWith("/output/safe-bash/dist/safe-bash/opt-in/"))).toHaveLength(7);
  });

  it("validates JavaScript URL assets as runtime graph nodes", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/fs/devices/worker.js", 'import "@poe-platform/safe-bash/unmapped";');
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", 'new URL("./fs/devices/worker.js", import.meta.url);');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Unexported optional peer route");
    expect(volume.existsSync("/output")).toBe(false);
  });

  for (const link of ["file", "directory"] as const) it(`refuses symlinked optional graph ${link} inputs`, async () => {
    const { volume, options } = optionalArtifact();
    if (link === "file") {
      volume.unlinkSync("/repo/packages/safe-bash/dist/opt-in/optional.js");
      volume.symlinkSync("/repo/packages/safe-bash/dist/index.js", "/repo/packages/safe-bash/dist/opt-in/optional.js");
    } else {
      volume.renameSync("/repo/packages/safe-bash/dist/opt-in/fs", "/repo/optional-fs");
      volume.symlinkSync("/repo/optional-fs", "/repo/packages/safe-bash/dist/opt-in/fs");
    }
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("regular optional input");
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("resolves declared public wildcard peer routes without copying their modules", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", 'export * from "@poe-platform/safe-bash/contracts/probe";');
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", 'export * from "@poe-platform/safe-bash/contracts/probe";');
    const result = await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(result.at(-1)?.name).toBe("@poe-platform/safe-bash");
    expect(Object.keys(volume.toJSON()).filter(filename => filename.startsWith("/output/safe-bash/dist/safe-bash/opt-in/"))).toHaveLength(7);
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/contracts")).toBe(false);
  });

  for (const extension of ["js", "d.ts"]) it(`rejects raw dot-segment public wildcard edges before normalization: ${extension}`, async () => {
    const { volume, options } = optionalArtifact();
    const packageDir = "/consumer/node_modules/@poe-platform/safe-bash";
    volume.mkdirSync(packageDir + "/dist/contracts", { recursive: true });
    volume.writeFileSync(packageDir + "/package.json", JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", exports: bashManifest.exports }));
    volume.writeFileSync(packageDir + "/dist/index.d.ts", "export {};\n");
    volume.writeFileSync(packageDir + "/dist/contracts/probe.d.ts", "export {};\n");
    const host: ts.ModuleResolutionHost = {
      fileExists: filename => volume.existsSync(filename),
      readFile: filename => volume.existsSync(filename) ? volume.readFileSync(filename, "utf8").toString() : undefined,
      directoryExists: filename => volume.existsSync(filename) && volume.statSync(filename).isDirectory(),
      getCurrentDirectory: () => "/consumer",
      realpath: filename => filename,
    };
    const resolve = (specifier: string) => ts.resolveModuleName(specifier, "/consumer/main.mts", {
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    }, host, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule;
    expect(resolve("@poe-platform/safe-bash/contracts/probe")?.resolvedFileName).toBe(packageDir + "/dist/contracts/probe.d.ts");
    const specifier = "@poe-platform/safe-bash/contracts/../index";
    expect(resolve(specifier)).toBeUndefined();
    volume.writeFileSync(`/repo/packages/safe-bash/dist/opt-in/optional.${extension}`, `export * from ${JSON.stringify(specifier)};`);
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Invalid optional peer");
    expect(volume.existsSync("/output")).toBe(false);
    expect(options.bundle).not.toHaveBeenCalled();
  });

  for (const segment of [".", "%2e%2E", "node_modules", "%6eode_modules"]) {
    for (const extension of ["js", "d.ts"]) it(`rejects invalid public wildcard segment ${segment}: ${extension}`, async () => {
      const { volume, options } = optionalArtifact();
      const directory = `/repo/packages/safe-bash/dist/contracts/${segment}`;
      volume.mkdirSync(directory, { recursive: true });
      volume.writeFileSync(`${directory}/probe.${extension}`, "export {};\n");
      const specifier = `@poe-platform/safe-bash/contracts/${segment}/probe`;
      volume.writeFileSync(`/repo/packages/safe-bash/dist/opt-in/optional.${extension}`, `export * from ${JSON.stringify(specifier)};`);
      await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Invalid optional peer");
      expect(volume.existsSync("/output")).toBe(false);
      expect(options.bundle).not.toHaveBeenCalled();
    });
  }

  it("refuses peer exports that target excluded optional modules", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports: { ...bashManifest.exports, "./leak": { import: "./dist/optional.js", types: "./dist/optional.d.ts" } } }));
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", 'export * from "@poe-platform/safe-bash/leak";');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Unexported optional peer route");
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("requires yaml to remain an optional peer", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, peerDependenciesMeta: { yaml: { optional: false } } }));
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("optional yaml 2.9.0");
    expect(volume.existsSync("/output")).toBe(false);
  });

  for (const yaml of ["*", "^2.9.0", "2.8.0"]) it(`refuses an unqualified yaml peer version: ${yaml}`, async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, peerDependencies: { ...bashManifest.peerDependencies, yaml } }));
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("yaml");
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("packages optional entries automatically without a separate artifact flag", () => {
    expect(parsePackageSafeArguments(["--out-dir", "/output", "--version", "1.2.3"])).toEqual({ outDir: "/output", version: "1.2.3" });
    expect(() => parsePackageSafeArguments(["--out-dir", "/output", "--version", "1.2.3", "--include-optional"])).toThrow();
    expect(() => parsePackageSafeArguments([])).toThrow("Usage:");
    expect(() => parsePackageSafeArguments(["--out-dir", "/output", "--version", "1.2.3", "--include-optional=false"])).toThrow();
  });
});

describe("optional peer export-pattern segment admission", () => {
  function peerFixture(fragment: string, extension: string) {
    const fixture = optionalArtifact();
    const { volume } = fixture;
    const packageDir = "/consumer/node_modules/@poe-platform/safe-bash";
    volume.mkdirSync(packageDir, { recursive: true });
    volume.writeFileSync(packageDir + "/package.json", JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", exports: bashManifest.exports }));
    for (const directory of ["/repo/packages/safe-bash", packageDir]) {
      for (const name of ["probe", fragment]) {
        for (const suffix of ["js", "d.ts"]) {
          const filename = `${directory}/dist/contracts/${name}.${suffix}`;
          volume.mkdirSync(filename.slice(0, filename.lastIndexOf("/")), { recursive: true });
          volume.writeFileSync(filename, "export {};\n");
        }
      }
    }
    const host: ts.ModuleResolutionHost = {
      fileExists: filename => volume.existsSync(filename),
      readFile: filename => volume.existsSync(filename) ? volume.readFileSync(filename, "utf8").toString() : undefined,
      directoryExists: filename => volume.existsSync(filename) && volume.statSync(filename).isDirectory(),
      getCurrentDirectory: () => "/consumer",
      realpath: filename => filename,
    };
    const resolve = (specifier: string) => ts.resolveModuleName(specifier, "/consumer/main.mts", {
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    }, host, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule;
    const specifier = `@poe-platform/safe-bash/contracts/${fragment}`;
    const statement = `export * from ${JSON.stringify(specifier)};`;
    volume.writeFileSync(`/repo/packages/safe-bash/dist/opt-in/optional.${extension}`, statement);
    return { ...fixture, resolve, specifier, statement, packageDir };
  }

  for (const fragment of [
    "nested\\..\\probe", "nested/..\\probe", "nested\\../probe", "nested\\.\\probe",
    "nested\\%2e%2E/probe", "nested\\.%2e\\probe", "nested\\node_modules\\probe",
    "nested/NoDe_MoDuLeS\\probe", "nested\\%6eode%5Fmodules/probe", "%2fprobe", "nested%5Cprobe",
  ]) {
    for (const extension of ["js", "d.ts"]) it(`rejects forbidden pattern fragment ${fragment}: ${extension}`, async () => {
      const { volume, options, resolve, specifier } = peerFixture(fragment, extension);
      expect(resolve("@poe-platform/safe-bash/contracts/probe")).toBeDefined();
      if (!fragment.includes("%2f") && !fragment.includes("%5C")) expect(resolve(specifier)).toBeUndefined();
      await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Invalid optional peer");
      expect(volume.existsSync("/output")).toBe(false);
      expect(options.bundle).not.toHaveBeenCalled();
    });
  }

  for (const fragment of ["probe", ".probe", "...", "node_modules-extra", "nested/probe", "%70robe", "%2eprobe", "%252e%252e", "nested//probe"]) {
    for (const extension of ["js", "d.ts"]) it(`preserves allowed raw wildcard bytes ${fragment}: ${extension}`, async () => {
      const { volume, options, resolve, specifier, statement } = peerFixture(fragment, extension);
      expect(resolve(specifier)).toBeDefined();
      const result = await packageSafeLibraries({ ...options, outDir: "/output" });
      expect(result.at(-1)?.name).toBe("@poe-platform/safe-bash");
      expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash/opt-in/optional.${extension}`, "utf8")).toBe(statement);
      expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/contracts")).toBe(false);
    });
  }

  for (const extension of ["js", "d.ts"]) it(`validates the substituted fragment independently of its export suffix: ${extension}`, async () => {
    const { volume, options } = optionalArtifact();
    const exports = { ...bashManifest.exports, "./contracts/*.js": { import: "./dist/contracts/*.js", types: "./dist/contracts/*.d.ts" } };
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports }));
    volume.writeFileSync(`/repo/packages/safe-bash/dist/contracts/..${extension}`, "export {};\n");
    volume.writeFileSync(`/repo/packages/safe-bash/dist/opt-in/optional.${extension}`, 'export * from "@poe-platform/safe-bash/contracts/..js";');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Invalid optional peer");
    expect(volume.existsSync("/output")).toBe(false);
    expect(options.bundle).not.toHaveBeenCalled();
  });

  for (const extension of ["js", "d.ts"]) it(`preserves an exact export alias without treating its key as a wildcard fragment: ${extension}`, async () => {
    const { volume, options, resolve, specifier, statement, packageDir } = peerFixture("../probe", extension);
    const exports = { ...bashManifest.exports, "./contracts/../probe": { import: "./dist/contracts/probe.js", types: "./dist/contracts/probe.d.ts" } };
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports }));
    volume.writeFileSync(packageDir + "/package.json", JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", exports }));
    expect(resolve(specifier)?.resolvedFileName).toBe(packageDir + "/dist/contracts/probe.d.ts");
    await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash/opt-in/optional.${extension}`, "utf8")).toBe(statement);
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/contracts")).toBe(false);
  });

  for (const [fragment, pattern] of [["76alue", "%*"], ["%", "*76alue"]]) {
    for (const extension of ["js", "d.ts"]) it(`admits a percent escape completed by pattern substitution ${pattern}: ${extension}`, async () => {
      const { volume, options, resolve, specifier, statement, packageDir } = peerFixture(fragment, extension);
      const exports = { ...bashManifest.exports, "./contracts/*": { import: `./dist/contracts/${pattern}.js`, types: `./dist/contracts/${pattern}.d.ts` } };
      volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports }));
      volume.writeFileSync(packageDir + "/package.json", JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", exports }));
      for (const directory of ["/repo/packages/safe-bash", packageDir]) {
        for (const suffix of ["js", "d.ts"]) {
          volume.writeFileSync(`${directory}/dist/contracts/%76alue.${suffix}`, "export {};\n");
          volume.writeFileSync(`${directory}/dist/contracts/value.${suffix}`, "export {};\n");
        }
      }
      expect(resolve(specifier)?.resolvedFileName).toBe(packageDir + "/dist/contracts/%76alue.d.ts");
      const template = new URL(`./dist/contracts/${pattern}.${extension}`, pathToFileURL("/repo/packages/safe-bash/package.json"));
      const completed = new URL(template.href.replaceAll("*", fragment));
      expect(fileURLToPath(completed)).toBe(`/repo/packages/safe-bash/dist/contracts/value.${extension}`);
      expect(volume.existsSync(fileURLToPath(completed))).toBe(true);
      await packageSafeLibraries({ ...options, outDir: "/output" });
      expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash/opt-in/optional.${extension}`, "utf8")).toBe(statement);
      expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/contracts")).toBe(false);
    });
  }

  for (const fragment of ["2fvalue", "5Cvalue", "zz"]) {
    for (const extension of ["js", "d.ts"]) it(`refuses invalid completed URL encoding ${fragment}: ${extension}`, async () => {
      const { volume, options } = peerFixture(fragment, extension);
      const exports = { ...bashManifest.exports, "./contracts/*": { import: "./dist/contracts/%*.js", types: "./dist/contracts/%*.d.ts" } };
      volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports }));
      for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/contracts/%${fragment}.${suffix}`, "export {};\n");
      await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow();
      expect(volume.existsSync("/output")).toBe(false);
      expect(options.bundle).not.toHaveBeenCalled();
    });
  }

  for (const target of ["./dist/contracts/../contracts/*", "./dist/contracts/nested\\..\\*", "./dist/contracts/node_modules/*", "./dist/contracts/%2E%2e/*"]) {
    for (const extension of ["js", "d.ts"]) it(`refuses invalid selected export target ${target}: ${extension}`, async () => {
      const { volume, options } = optionalArtifact();
      const exports = { ...bashManifest.exports, "./contracts/*": { import: target + ".js", types: target + ".d.ts" } };
      volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports }));
      const filename = "/repo/packages/safe-bash/" + target.replace("*", "probe") + "." + extension;
      volume.mkdirSync(filename.slice(0, filename.lastIndexOf("/")), { recursive: true });
      volume.writeFileSync(filename, "export {};\n");
      volume.writeFileSync(`/repo/packages/safe-bash/dist/opt-in/optional.${extension}`, 'export * from "@poe-platform/safe-bash/contracts/probe";');
      await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Invalid optional peer");
      expect(volume.existsSync("/output")).toBe(false);
      expect(options.bundle).not.toHaveBeenCalled();
    });
  }
});

it('packages SafeJS from its own exports when the root no longer exposes sandboxes', async () => {
  const { volume, options } = optionalLeftovers();
  volume.writeFileSync('/repo/package.json', JSON.stringify({ license: 'MIT', exports: {} }));
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const manifest = JSON.parse(volume.readFileSync('/output/safe-js/package.json', 'utf8') as string);
  expect(manifest.exports['.']).toEqual({ types: './dist/safe-js/index.d.ts', import: './dist/safe-js/index.js' });
});


it("prepares scoped browser and private command runtimes without root sandbox bundles", async () => {
  const { volume, options } = optionalLeftovers();
  volume.writeFileSync("/repo/package.json", JSON.stringify({ license: "MIT", exports: {} }));
  const browserTargets = Object.keys(volume.toJSON()).filter(filename => filename.endsWith(".browser.js"));
  for (const filename of browserTargets) volume.unlinkSync(filename);
  const manifest = structuredClone(bashManifest);
  for (const name of ["safe-bash-command-op", "safe-bash-command-pandoc", "office-package"]) {
    volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
    volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({
      name: name === "office-package" ? "@poe-code/office-package" : name, private: true, type: "module", version: "0.0.1",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    }));
    volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, "export {};\n");
    if (name !== "office-package") manifest.poeCode.integration.privateWorkspaces[name] = {
      version: "0.0.1", dependencies: {}, devDependencies: {}, portable: true,
    };
  }
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.writeFileSync("/repo/packages/office-package/dist/index.js", "export const codec = 1;\n");
  for (const name of ["op", "pandoc"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/${name}/index.js`,
    `export * from "safe-bash-command-${name}";`);
  volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'export { codec } from "@poe-code/office-package";');
  const bundle = vi.fn(async (settings: { outfile?: string; outdir?: string; entryPoints: Record<string, string> | string[] }) => {
    const targets = settings.outfile ? [settings.outfile] : Object.keys(settings.entryPoints).map(name => `${settings.outdir}/${name}.js`);
    return { outputFiles: targets.map(filename => ({ path: filename, contents: Buffer.from('export const prepared = true;\n') })) };
  });
  await packageSafeLibraries({ ...options, bundle, outDir: "/output" });
  for (const filename of browserTargets) {
    expect(volume.readFileSync(filename.replace("/repo/packages/safe-bash/dist/", "/output/safe-bash/dist/safe-bash/"), "utf8"))
      .toBe('export const prepared = true;\n');
    expect(volume.existsSync(filename)).toBe(false);
  }
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/commands/op/index.js", "utf8"))
    .toBe('export const prepared = true;\n');
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/commands/pandoc/index.js", "utf8"))
    .toBe('export * from "../../../safe-bash-command-pandoc/index.js";');
  for (const name of ["op", "pandoc"]) {
    expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash-command-${name}/index.js`, "utf8"))
      .toBe('export const prepared = true;\n');
  }
  expect(volume.readFileSync("/output/safe-bash/dist/office-package/index.js", "utf8")).toBe("export const codec = 1;\n");
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/index.js", "utf8"))
    .toBe('export { codec } from "../office-package/index.js";');
  const packedManifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
  expect(packedManifest.dependencies).toEqual({});
  expect(volume.existsSync("/repo/dist")).toBe(false);
});

for (const [specifier, target, failure] of [
  ["private-runtime", "./dist/index.js", "Private or CLI dependency leaked"],
  ["@poe-code/office-package/missing", "./dist/index.js", "Missing private workspace runtime entrypoint"],
  ["@poe-code/office-package", "../../outside.js", '@poe-code/office-package export "." must target ./dist/*.js'],
]) it(`keeps scoped private runtime admission bounded: ${specifier} ${target}`, async () => {
  const { volume, options } = optionalLeftovers();
  const name = specifier.startsWith("@poe-code/office-package") ? "@poe-code/office-package" : specifier;
  volume.mkdirSync("/repo/packages/office-package", { recursive: true });
  volume.writeFileSync("/repo/packages/office-package/package.json", JSON.stringify({
    name, private: true, exports: { ".": { import: target } },
  }));
  volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", `export * from ${JSON.stringify(specifier)};`);
  await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow(failure);
});

it("keeps canonical private owners external in the packed browser recipe", async () => {
  const { options } = optionalLeftovers();
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const browser = options.bundle.mock.calls.map(([settings]) => settings as BuildOptions)
    .find(settings => Object.hasOwn(settings.entryPoints ?? {}, "core.browser"))!;
  const specifiers = [
    "safe-bash-contracts/command", "safe-bash-command-op",
    "safe-bash-command-pandoc/lua-filters", "safe-bash-command-pandoc/citeproc-filters",
  ];
  const result = await build({
    ...browser, absWorkingDir: process.cwd(), entryPoints: undefined,
    sourcemap: false, splitting: false, inject: [], plugins: [],
    stdin: { contents: specifiers.map(specifier => `export * from ${JSON.stringify(specifier)};`).join("\n"), resolveDir: process.cwd() },
  });
  expect(Object.keys(result.metafile!.inputs)).toEqual(["<stdin>"]);
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual(
    specifiers.map(path => ({ path, kind: "import-statement", external: true })),
  );
});


it.each(["@poe-code/safe-fs/core", "poe-code/safe-fs/core", "@poe-platform/safe-fs/core", "@poe-code/xml-ast"])("keeps browser filesystem import %s canonical instead of embedding a private constructor", async specifier => {
  const { options } = optionalLeftovers();
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const browser = options.bundle.mock.calls.map(([settings]) => settings as BuildOptions)
    .find(settings => Object.hasOwn(settings.entryPoints ?? {}, "core.browser"))!;
  expect(browser).toBeDefined();
  const result = await build({
    ...browser, loader: {".wasm": "binary"}, absWorkingDir: process.cwd(), entryPoints: undefined, outdir: undefined,
    sourcemap: false, splitting: false, inject: [],
    stdin: { contents: `export { ${specifier === "@poe-code/xml-ast" ? "XmlLimitError" : "FsError"} } from ${JSON.stringify(specifier)};`, resolveDir: process.cwd() },
  });
  expect(result.outputFiles![0]!.text).toContain('from "@poe-platform/safe-fs/core"');
  expect(result.outputFiles![0]!.text).not.toContain("extends Error");
});

it("copies the XML runtime into its owning filesystem artifact without a private dependency", async () => {
  const { volume, options } = optionalLeftovers();
  volume.mkdirSync("/repo/packages/xml-ast/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/xml-ast/package.json", JSON.stringify({
    name: "@poe-code/xml-ast", private: true, type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } }
  }));
  volume.writeFileSync("/repo/packages/xml-ast/dist/index.js", "export class XmlLimitError extends SyntaxError {}");
  volume.writeFileSync("/repo/packages/xml-ast/dist/index.d.ts", "export declare class XmlLimitError extends SyntaxError {}");
  volume.writeFileSync("/repo/packages/safe-fs/dist/index.js", 'export { XmlLimitError } from "@poe-code/xml-ast";');
  await packageSafeLibraries({ ...options, outDir: "/output" });
  expect(volume.readFileSync("/output/safe-fs/dist/safe-fs/index.js", "utf8"))
    .toContain('from "../xml-ast/index.js"');
  expect(volume.readFileSync("/output/safe-fs/dist/xml-ast/index.js", "utf8"))
    .toContain("class XmlLimitError");
  expect(JSON.parse(volume.readFileSync("/output/safe-fs/package.json", "utf8").toString()).dependencies)
    .not.toHaveProperty("@poe-code/xml-ast");
  for (const owner of ["safe-js", "safe-bash"])
    expect(volume.existsSync(`/output/${owner}/dist/xml-ast/index.js`)).toBe(false);
});

it("copies XML declarations into their owning filesystem artifact without circular self-reexports", async () => {
  const { volume, options } = optionalLeftovers();
  volume.mkdirSync("/repo/packages/xml-ast/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/xml-ast/package.json", JSON.stringify({
    name: "@poe-code/xml-ast", private: true, type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } }
  }));
  volume.writeFileSync("/repo/packages/xml-ast/dist/index.d.ts", "export declare class XmlLimitError extends SyntaxError {}");
  for (const owner of ["safe-fs", "safe-js", "safe-bash"]) {
    volume.writeFileSync(`/repo/packages/${owner}/dist/index.d.ts`, 'export { XmlLimitError } from "@poe-code/xml-ast";');
  }
  await packageSafeLibraries({ ...options, outDir: "/output" });
  expect(volume.readFileSync("/output/safe-fs/dist/safe-fs/index.d.ts", "utf8"))
    .toContain('from "../xml-ast/index.js"');
  expect(volume.readFileSync("/output/safe-fs/dist/xml-ast/index.d.ts", "utf8"))
    .toContain("class XmlLimitError");
  for (const owner of ["safe-js", "safe-bash"]) {
    expect(volume.readFileSync(`/output/${owner}/dist/${owner}/index.d.ts`, "utf8"))
      .toContain('from "@poe-platform/safe-fs/core"');
    expect(volume.existsSync(`/output/${owner}/dist/xml-ast/index.d.ts`)).toBe(false);
  }
});

it('ships xmllint and its shared XML engine through the established XML export', async () => {
  const { volume, options } = optionalLeftovers();
  const manifest = structuredClone(bashManifest);
  const names = ['safe-bash-command-xmllint', 'safe-bash-xml-engine', 'safe-bash-contracts'];
  manifest.poeCode.integration.privateWorkspaces = Object.fromEntries(names.map(name => [name, bashManifest.poeCode.integration.privateWorkspaces[name as keyof typeof bashManifest.poeCode.integration.privateWorkspaces]])) as typeof manifest.poeCode.integration.privateWorkspaces;
  volume.writeFileSync('/repo/packages/safe-bash/package.json', JSON.stringify(manifest));
  for (const name of names) {
    volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
    const metadata = readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), 'utf8');
    volume.writeFileSync(`/repo/packages/${name}/package.json`, metadata);
    for (const target of Object.values(JSON.parse(metadata).exports) as { types: string }[]) {
      volume.writeFileSync(`/repo/packages/${name}/` + target.types.slice(2), 'export {};');
    }
    volume.writeFileSync(`/repo/packages/${name}/LICENSE`, 'MIT\n');
  }

  const limits = readFileSync(new URL('../packages/safe-bash-xml-engine/src/limits.ts', import.meta.url), 'utf8');
  for (const module of ['yield', 'signals']) {
    const source = readFileSync(new URL(`../packages/safe-bash-contracts/src/${module}.ts`, import.meta.url), 'utf8');
    volume.writeFileSync(`/repo/packages/safe-bash-contracts/dist/${module}.js`, ts.transpileModule(source,
      { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText);
  }
  volume.writeFileSync('/repo/packages/safe-bash-xml-engine/dist/index.js', 'export * from "./limits.js";');
  volume.writeFileSync('/repo/packages/safe-bash-xml-engine/dist/index.d.ts', 'export interface XmlQueryLimits { readonly maxNodes: number; }');
  volume.writeFileSync('/repo/packages/safe-bash-xml-engine/dist/limits.js', ts.transpileModule(limits, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText);
  volume.writeFileSync('/repo/packages/safe-bash-xml-engine/dist/limits.d.ts', 'export interface XmlQueryLimits { readonly maxNodes: number; }');
  volume.writeFileSync('/repo/packages/safe-bash-command-xmllint/dist/index.js', 'export { resolveXmlQueryLimits } from "safe-bash-xml-engine/limits";');
  volume.writeFileSync('/repo/packages/safe-bash-command-xmllint/dist/index.d.ts', 'export type { XmlQueryLimits } from "safe-bash-xml-engine/limits";');
  for (const suffix of ['js', 'd.ts']) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/xml/index.${suffix}`, 'export * from "safe-bash-command-xmllint";');
  await packageSafeLibraries({ ...options, outDir: '/output' });
  const read = (path: string) => volume.readFileSync('/output/safe-bash/dist/' + path, 'utf8');
  expect(read('safe-bash/commands/xml/index.js')).toContain('"../../../safe-bash-command-xmllint/index.js"');
  expect(read('safe-bash-command-xmllint/index.js')).toContain('"../safe-bash-xml-engine/limits.js"');
  expect(read('safe-bash-command-xmllint/index.d.ts')).toContain('"../safe-bash-xml-engine/limits.js"');
  const bundled = await build({
    entryPoints: ['/output/safe-bash/dist/safe-bash-xml-engine/limits.js'], bundle: true, write: false, format: 'esm', platform: 'neutral',
    plugins: [{ name: 'packaged-xml-memory-consumer', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => ({ path: path.posix.resolve(args.resolveDir || '/', args.path), namespace: 'packed' }));
      builder.onLoad({ filter: /.*/, namespace: 'packed' }, args => ({ contents: volume.readFileSync(args.path, 'utf8').toString(), resolveDir: path.posix.dirname(args.path) }));
    } }],
  });
  const consumer = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0]!.text).toString('base64'));
  expect(consumer.resolveXmlQueryLimits().maxNodes).toBe(Infinity);
  expect(consumer.resolveXmlQueryLimits({}).maxNodes).toBe(Infinity);
  expect(consumer.resolveXmlQueryLimits({ maxNodes: Infinity }).maxNodes).toBe(Infinity);
  expect(consumer.resolveXmlQueryLimits({ maxNodes: 10_000 }).maxNodes).toBe(10_000);
  expect(() => consumer.resolveXmlQueryLimits({ maxNodes: 0 })).toThrow(RangeError);
  const controller = new AbortController(), reason = new Error('packaged XML cancelled');
  const checkpoint = vi.fn(async (signal: AbortSignal) => { expect(signal).toBe(controller.signal); });
  const budget = new consumer.XmlBudget(consumer.resolveXmlQueryLimits(), controller.signal, checkpoint);
  await budget.tick(16384);
  await budget.tick(16384);
  expect(checkpoint).toHaveBeenCalledTimes(2);
  controller.abort(reason);
  expect(() => budget.tick()).toThrow(reason);
});


it.each([false, true])("keeps copied private command assets inside built package directories (portable=%s)", async portable => {
  const name = "safe-bash-command-asset-fixture";
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {}, portable };
  const recipe = resolvePrivateCommandBuild("/repo", { [name]: profile }, [{ dir: name, pkg: {
    name, ...profile, private: true, type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  } }], { alias: {}, external: [], portable });
  const result = await build({ ...recipe, inject: [], metafile: true, plugins: [{
    name: "in-memory-private-assets",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => ({
        path: args.path.endsWith(".wasm") ? "/repo/engine.wasm" : "/repo/entry.js", namespace: "fixture",
      }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => args.path.endsWith(".wasm")
        ? { contents: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0), loader: "copy" }
        : { contents: 'import engine from "./engine.wasm"; export { engine };', loader: "js" });
    },
  }] });
  const outputs = new Set(result.outputFiles!.map(output => output.path));
  expect([...outputs].some(filename => filename.endsWith(".wasm"))).toBe(true);
  for (const filename of outputs) {
    const parts = path.relative("/repo", filename).split(path.sep);
    expect(parts[0]).toBe("packages");
    expect(parts[2]).toBe("dist");
  }
  for (const output of Object.values(result.metafile!.outputs)) {
    for (const edge of output.imports.filter(edge => !edge.external)) {
      expect(outputs.has(path.resolve("/repo", edge.path))).toBe(true);
    }
  }
});

it.each([false, true].flatMap(portable => ["safe-fs", "xml-ast"].map(owner => ({ portable, owner }))))("preserves canonical $owner identity from linked command outputs (portable=$portable)", async ({ portable, owner }) => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-example";
  const directory = "/repo/packages/" + name;
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {}, portable };
  const constructor = owner === "xml-ast" ? "XmlLimitError" : "FsError";
  const entrypoint = owner === "xml-ast" ? "index" : "core";
  volume.mkdirSync(`/repo/packages/${owner}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${owner}/dist/${entrypoint}.js`, `export class ${constructor} extends Error {}`);
  volume.writeFileSync(`/repo/packages/${owner}/dist/${entrypoint}.d.ts`, `export declare class ${constructor} extends Error {}`);
  volume.mkdirSync(directory + "/dist", { recursive: true });
  volume.writeFileSync(directory + "/package.json", JSON.stringify({
    name, ...profile, private: true, type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  for (const suffix of ["js", "d.ts"]) {
    volume.writeFileSync(directory + "/dist/index." + suffix, `export { ${constructor} } from "../../${owner}/dist/${entrypoint}.js";`);
  }
  volume.mkdirSync(directory + "/src", { recursive: true });
  volume.writeFileSync(directory + "/src/index.ts", `export { ${constructor} } from "../../${owner}/dist/${entrypoint}.js";`);
  volume.writeFileSync("/repo/packages/safe-fs/package.json", JSON.stringify({
    name: "@poe-code/safe-fs",
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./core": { types: "./dist/core.d.ts", import: "./dist/core.js" },
    },
  }));
  volume.writeFileSync("/repo/packages/safe-fs/dist/core.js", "export class FsError extends Error {}");
  volume.writeFileSync("/repo/packages/safe-fs/dist/core.d.ts", "export declare class FsError extends Error {}");
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = { [name]: profile };
  manifest.exports["./commands/example"] = { types: "./dist/commands/example/index.d.ts", import: "./dist/commands/example/index.js" };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync("/repo/packages/safe-bash/dist/commands/example", { recursive: true });
  for (const suffix of ["js", "d.ts"]) {
    volume.writeFileSync("/repo/packages/safe-bash/dist/commands/example/index." + suffix, `export { ${constructor} } from "${name}";`);
  }
  await packageSafeLibraries({ ...options, outDir: "/output", bundle: async (settings: BuildOptions) => {
    if (settings.outdir !== "/repo/packages") return options.bundle(settings);
    return build({ ...settings, inject: [], plugins: [...(settings.plugins ?? []), {
      name: "memory-linked-runtime",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: "linked" }));
        builder.onLoad({ filter: /.*/, namespace: "linked" }, args => ({
          contents: volume.readFileSync(args.path, "utf8").toString(), resolveDir: path.dirname(args.path),
        }));
      },
    }] });
  } });
  expect(volume.readFileSync(`/output/safe-bash/dist/${name}/index.d.ts`, "utf8"))
    .toContain('from "@poe-platform/safe-fs/core"');
  const consumer = await build({
    stdin: { contents: volume.readFileSync("/output/safe-bash/dist/" + name + "/index.js", "utf8").toString(), resolveDir: "/output" },
    bundle: true, platform: "browser", format: "cjs", write: false,
    plugins: [{
      name: "canonical-filesystem-consumer",
      setup(builder) {
        builder.onResolve({ filter: /^@poe-platform\/safe-fs\/core$/ }, () => ({ path: "canonical", namespace: "consumer" }));
        builder.onLoad({ filter: /.*/, namespace: "consumer" }, () => ({ contents: `export const ${constructor} = globalThis.canonicalFsError;` }));
      },
    }],
  });
  class CanonicalFsError extends Error {}
  const context = { canonicalFsError: CanonicalFsError, module: { exports: {} as Record<string, unknown> } };
  runInContext(consumer.outputFiles[0]!.text, createContext(context));
  expect(context.module.exports[constructor]).toBe(CanonicalFsError);
});

it("preserves xmllint factories when the XML browser adapter shares a chunk", async () => {
  const fixture = createFsFromVolume(Volume.fromJSON({
    "/browser/xml.ts": readFileSync(new URL("../packages/safe-bash/src/commands/xml/index.ts", import.meta.url), "utf8"),
    "/browser/core.ts": 'export { xmlCommands } from "./xml.ts";',
    "/internal.js": readFileSync(new URL("../packages/safe-bash/src/commands/internal.ts", import.meta.url), "utf8"),
  }));
  const result = await build({ entryPoints: { xml: "/browser/xml.ts", core: "/browser/core.ts" }, outdir: "/output", bundle: true, splitting: true, write: false, format: "esm",
    external: ["safe-bash-command-xmllint", "safe-bash-command-xq", "safe-bash-io-engine/internal"],
    plugins: [{ name: "xml-memory", setup(builder) {
      builder.onResolve({ filter: /^\// }, args => ({ path: args.path, namespace: "memory" }));
      builder.onResolve({ filter: /^\.\.?\//, namespace: "memory" }, args => ({ path: path.posix.resolve(args.resolveDir, args.path), namespace: "memory" }));
      builder.onLoad({ filter: /.*/, namespace: "memory" }, args => ({ contents: fixture.readFileSync(args.path, "utf8").toString(), loader: "ts", resolveDir: path.posix.dirname(args.path) }));
    } }],
  });
  const output = result.outputFiles.find(file => file.path === "/output/xml.js")!.text;
  for (const name of ["createXmllintCommand", "createXmllintCommands", "xmllintCommands"]) expect(output).toContain(name);
});

it('rewrites imports in deeply nested generated expressions without consuming the call stack', () => {
  const prefix = 'export const generated = ' + '0 + '.repeat(120000);
  const source = prefix + "import('poe-code/safe-fs');\n";
  expect(rewriteModuleSpecifiers('generated.js', source, specifier => specifier === 'poe-code/safe-fs' ? '@poe-platform/safe-fs' : specifier))
    .toBe(prefix + 'import("@poe-platform/safe-fs");\n');
});

it("carries declared Buffer initialization into generated chunks while pruning unused facades", async () => {
  const { volume, options } = optionalLeftovers();
  volume.writeFileSync("/repo/packages/safe-bash/dist/core.js", 'import "./portable-buffer.js"; export {};\n');
  volume.writeFileSync("/repo/packages/safe-bash/dist/portable-buffer.js", "globalThis.Buffer = {};\n");
  const pure = "/repo/packages/safe-bash/dist/chunks/facade.js";
  const effect = "/repo/packages/safe-bash/dist/chunks/initializer.js";
  await packageSafeLibraries({ ...options, outDir: "/output", bundle: async (settings: BuildOptions) => {
    if (!Object.hasOwn(settings.entryPoints ?? {}, "core.browser")) return options.bundle(settings);
    return {
      outputFiles: [pure, effect].map(filename => ({ path: filename, contents: Buffer.from("export {};\n") })),
      metafile: { inputs: {}, outputs: {
        [pure]: { inputs: { "packages/safe-bash/src/core.browser.ts": { bytesInOutput: 1 } } },
        [effect]: { inputs: { "packages/safe-bash/src/portable-buffer.ts": { bytesInOutput: 1 } } },
      } },
    };
  } });
  const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
  expect(manifest.sideEffects).toContain("./dist/safe-bash/chunks/initializer.js");
  expect(manifest.sideEffects).toContain("./dist/safe-bash/portable-buffer.js");
  expect(manifest.sideEffects).not.toContain("./dist/safe-bash/chunks/facade.js");
  expect(manifest.sideEffects).not.toContain("./dist/safe-bash/core.browser.js");
});

it("keeps unused command initializer chunks out of the lightweight root facade", async () => {
  const { volume, options } = optionalLeftovers();
  const base = "/repo/packages/safe-bash/dist/";
  await packageSafeLibraries({ ...options, outDir: "/output", bundle: async (settings: BuildOptions) => {
    if (!Object.hasOwn(settings.entryPoints ?? {}, "core.browser")) return options.bundle(settings);
    const outputs = {
      [base + "core.browser.js"]: { inputs: {}, exports: [] },
      [base + "chunks/bootstrap.js"]: { inputs: { "packages/safe-bash/src/portable-buffer.ts": { bytesInOutput: 1 } } },
      [base + "chunks/python.js"]: { inputs: { "packages/safe-bash/src/commands/python/index.ts": { bytesInOutput: 1 } } },
    };
    return { outputFiles: Object.keys(outputs).map(path => ({ path, contents: Buffer.from("export {};\n") })), metafile: { inputs: {}, outputs } };
  } });
  const facade = volume.readFileSync("/output/safe-bash/dist/safe-bash/core.browser.js", "utf8").toString();
  expect(facade).toContain('import "./chunks/bootstrap.js"');
  expect(facade).not.toContain('import "./chunks/python.js"');
});

it("ships Git's workerd runtime, conditional imports, and exact WASM asset", async () => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-git";
  const directory = "/repo/packages/" + name;
  const source = JSON.parse(readFileSync(new URL("../packages/safe-bash-command-git/package.json", import.meta.url), "utf8"));
  volume.mkdirSync(directory + "/dist", { recursive: true });
  volume.writeFileSync(directory + "/package.json", JSON.stringify(source));
  volume.writeFileSync(directory + "/LICENSE", "Fixture license\n");
  volume.writeFileSync(directory + "/dist/index.js", 'export { gitModule } from "#git-wasm";');
  volume.writeFileSync(directory + "/dist/index.d.ts", 'export { gitModule } from "#git-wasm";');
  for (const runtime of ["runtime", "runtime.workerd"]) {
    const contents = readFileSync(new URL("../packages/safe-bash-command-git/src/" + runtime + ".ts", import.meta.url), "utf8");
    volume.writeFileSync(directory + "/dist/" + runtime + ".js", ts.transpileModule(contents, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText);
    volume.writeFileSync(directory + "/dist/" + runtime + ".d.ts", "export declare function gitModule(): WebAssembly.Module;");
  }
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  volume.writeFileSync(directory + "/dist/git_rust.wasm", wasm);
  volume.writeFileSync(directory + "/dist/wasm.generated.js", "export function wasmBytes() { return Uint8Array.of(0,97,115,109,1,0,0,0); }");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync("/repo/packages/safe-bash/dist/commands/git/index." + suffix, 'export * from "safe-bash-command-git";');
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const shipped = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8"));
  expect(shipped.imports["#git-wasm"]).toEqual({
    types: "./dist/safe-bash-command-git/runtime.d.ts",
    workerd: "./dist/safe-bash-command-git/runtime.workerd.js",
    default: "./dist/safe-bash-command-git/runtime.js",
  });
  const artifact = "/output/safe-bash/dist/" + name;
  expect(volume.readFileSync(artifact + "/git_rust.wasm")).toEqual(wasm);
  expect(volume.readFileSync(artifact + "/runtime.workerd.js", "utf8")).toContain('./git_rust.wasm');
  expect(WebAssembly.validate(volume.readFileSync(artifact + "/git_rust.wasm"))).toBe(true);

});

it("preserves portable private command conditions in packed root imports", async () => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-fixture";
  const manifest = structuredClone(bashManifest);
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {}, portable: true };
  manifest.devDependencies[name] = "*";
  manifest.poeCode.integration.privateWorkspaces[name] = profile;
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({ name, ...profile, private: true, type: "module", exports: {
    ".": { types: { browser: "./dist/index.browser.d.ts", default: "./dist/index.d.ts" }, browser: "./dist/index.browser.js", import: "./dist/index.js" },
  } }));
  for (const platform of ["index", "index.browser"]) for (const suffix of ["js", "d.ts"]) {
    volume.writeFileSync(`/repo/packages/${name}/dist/${platform}.${suffix}`, suffix === "js" ? `export const platform = "${platform}";` : 'export declare const platform: string;');
  }
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/index.${suffix}`, `export { platform } from "${name}";`);
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const packed = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
  expect(packed.imports[`#private/${name}`]).toEqual({
    types: { browser: `./dist/${name}/index.browser.d.ts`, default: `./dist/${name}/index.d.ts` },
    browser: `./dist/${name}/index.browser.js`, import: `./dist/${name}/index.js`,
  });
  for (const suffix of ["js", "d.ts"]) {
    expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash/index.${suffix}`, "utf8")).toContain(`"#private/${name}"`);
    expect(volume.existsSync(`/output/safe-bash/dist/${name}/index.browser.${suffix}`)).toBe(true);
  }
});


it("uses portable dependency aliases when packaging private portable commands", async () => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-portable-probe";
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces[name] = { version: "0.0.1", dependencies: {}, devDependencies: {}, portable: true };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  for (const [dir, pkg] of [
    [name, { name, version: "0.0.1", private: true, type: "module", dependencies: {}, devDependencies: {}, exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }],
    ["conditional-host", { name: "conditional-host", private: true, type: "module", exports: { ".": { browser: "./dist/index.browser.js", import: "./dist/index.js" } } }],
  ] as const) {
    volume.mkdirSync(`/repo/packages/${dir}/dist`, { recursive: true });
    volume.writeFileSync(`/repo/packages/${dir}/package.json`, JSON.stringify(pkg));
    volume.writeFileSync(`/repo/packages/${dir}/dist/index.js`, "export {};\n");
    volume.writeFileSync(`/repo/packages/${dir}/dist/index.d.ts`, "export {};\n");
  }
  let portable: BuildOptions | undefined;
  await packageSafeLibraries({ ...options, outDir: "/output", bundle: async (settings: BuildOptions) => {
    if (Object.hasOwn(settings.entryPoints ?? {}, name + "/dist/index")) portable = settings;
    return options.bundle(settings);
  } });
  expect(portable).toBeDefined();
  expect(portable!.alias?.["conditional-host"]).toBe("/repo/packages/conditional-host/src/index.browser.ts");
  expect(portable!.alias).not.toHaveProperty(name);
  expect(portable!.external).toContain(name);
});

it("packs the private unzip argument owner behind the established public export", async () => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-unzip";
  const pkg = JSON.parse(readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), "utf8"));
  expect(pkg.private).toBe(true);
  expect(bashManifest.poeCode.integration.privateWorkspaces[name]).toEqual({
    version: pkg.version, dependencies: {}, devDependencies: pkg.devDependencies, portable: true,
  });
  volume.mkdirSync(`/repo/packages/${name}/dist/unzip`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify(pkg));
  volume.writeFileSync(`/repo/packages/${name}/LICENSE`, "MIT\n");
  for (const entry of Object.values(pkg.exports) as { types: string; import: string }[]) {
    for (const target of [entry.types, entry.import]) {
      const filename = `/repo/packages/${name}/${target.slice(2)}`;
      volume.mkdirSync(path.dirname(filename), { recursive: true });
      volume.writeFileSync(filename, "export {};\n");
    }
  }
  for (const suffix of ["js", "d.ts"]) {
    volume.writeFileSync(`/repo/packages/${name}/dist/index.${suffix}`, 'export { parseArguments } from "./unzip/arguments.js";');
    volume.writeFileSync(`/repo/packages/${name}/dist/unzip/arguments.${suffix}`, suffix === "js"
      ? "export function parseArguments() { return []; }" : "export declare function parseArguments(): string[];");
    volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/unzip/index.${suffix}`, `export * from "${name}";`);
  }
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const packed = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
  expect(packed.dependencies?.[name]).toBeUndefined();
  expect(packed.exports["./commands/unzip"]).toEqual({
    types: "./dist/safe-bash/commands/unzip/index.d.ts",
    workerd: "./dist/safe-bash/commands/unzip/index.js",
    browser: "./dist/safe-bash/commands/unzip/index.js",
    import: "./dist/safe-bash/commands/unzip/index.js",
  });
  for (const suffix of ["js", "d.ts"]) {
    expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash/commands/unzip/index.${suffix}`, "utf8")).toContain('../../../safe-bash-command-unzip/index.js');
    expect(volume.existsSync(`/output/safe-bash/dist/${name}/unzip/arguments.${suffix}`)).toBe(true);
  }
});

it("retains private Node worker URL assets beside their provider", async () => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-node";
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = {
    [name]: { version: "0.0.1", dependencies: {}, devDependencies: {} },
  };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({
    name, version: "0.0.1", private: true, type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  volume.writeFileSync(`/repo/packages/${name}/dist/index.js`, 'export const worker = new URL("./worker-main.js", import.meta.url);');
  volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, 'export declare const worker: URL;');
  volume.writeFileSync(`/repo/packages/${name}/dist/worker-main.js`, 'export const identity = "node-worker";');
  for (const suffix of ["js", "d.ts"]) {
    volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/node/index.${suffix}`, `export * from "${name}";`);
  }
  await packageSafeLibraries({ ...options, outDir: "/output" });
  expect(volume.readFileSync(`/output/safe-bash/dist/${name}/worker-main.js`, "utf8")).toContain('"node-worker"');
  expect(volume.readFileSync(`/output/safe-bash/dist/${name}/index.js`, "utf8")).toContain('./worker-main.js');
  const shipped = JSON.parse(volume.readFileSync('/output/safe-bash/package.json', 'utf8').toString());
  expect(shipped.dependencies?.[name]).toBeUndefined();
});

it("admits Playwright command ownership as a private workspace", () => {
  expect(bashManifest.poeCode.integration.privateWorkspaces).toHaveProperty("safe-bash-command-playwright-cli");
  const manifest = JSON.parse(readFileSync(new URL("../packages/safe-bash-command-playwright-cli/package.json", import.meta.url), "utf8"));
  expect(manifest.private).toBe(true);
  expect(manifest.devDependencies).not.toHaveProperty("@poe-platform/safe-bash");
  expect(readFileSync(new URL("../packages/safe-bash/src/commands/playwright/index.ts", import.meta.url), "utf8").trim())
    .toBe('export * from "safe-bash-command-playwright-cli";');
});

it('packs Playwright controller services and MIME detection behind public routes', async () => {
  const { volume, options } = optionalLeftovers();
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = {};
  for (const [name, owner] of [["safe-bash-mime-engine", undefined], ["safe-bash-command-playwright-cli", "safe-bash-mime-engine"]] as const) {
    const devDependencies = owner ? { [owner]: "*" } : {};
    const pkg = { name, version: "0.0.1", private: true, type: "module", dependencies: {}, devDependencies,
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } };
    manifest.poeCode.integration.privateWorkspaces[name] = { version: pkg.version, dependencies: {}, devDependencies };
    volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
    volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify(pkg));
    for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/${name}/dist/index.${suffix}`, owner
      ? `export { identity } from "${owner}";` : suffix === "js" ? "export const identity = {};" : "export declare const identity: object;");
  }
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/playwright/index.${suffix}`, 'export * from "safe-bash-command-playwright-cli";');
  await packageSafeLibraries({ ...options, outDir: "/output" });
  for (const suffix of ["js", "d.ts"]) {
    expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash-command-playwright-cli/index.${suffix}`, "utf8"))
      .toContain('"../safe-bash-mime-engine/index.js"');
    expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash/commands/playwright/index.${suffix}`, "utf8"))
      .toContain('"../../../safe-bash-command-playwright-cli/index.js"');
  }
  const packed = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8"));
  expect(packed.dependencies).toEqual({});
  expect(packed.exports["./commands/playwright"].import).toBe(packed.exports["./playwright"].import);
});
