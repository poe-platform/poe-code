import { beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";
import { build, transformSync, type BuildOptions, type Plugin } from "esbuild";
import { packageSafeLibraries, parsePackageSafeArguments, rewriteModuleSpecifiers } from "./package-safe.mjs";

const bashManifest = JSON.parse(readFileSync(new URL("../packages/safe-bash/package.json", import.meta.url), "utf8"));
it("ships the admitted portable ffmpeg facade and canonical contract edges", async () => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-ffmpeg";
  const commandManifest = JSON.parse(readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), "utf8"));
  expect(bashManifest.devDependencies[name]).toBe("*");
  expect(bashManifest.poeCode.integration.privateWorkspaces[name]).toEqual({
    version: commandManifest.version, dependencies: {}, devDependencies: commandManifest.devDependencies, portable: true,
  });
  expect(commandManifest.files).toEqual(["dist", "LICENSE"]);
  expect(commandManifest.scripts.test).toBe("node --import tsx --test src/*.test.ts");
  expect(readFileSync(new URL("../packages/safe-bash/src/commands/ffmpeg/index.ts", import.meta.url), "utf8")).toBe(`export * from "${name}";\n`);
  volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify(commandManifest));
  volume.writeFileSync(`/repo/packages/${name}/LICENSE`, "MIT\n");
  volume.writeFileSync(`/repo/packages/${name}/dist/index.js`, 'export { commandRuntimeIdentity } from "safe-bash-contracts/command";');
  volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, 'export type { CommandDefinition } from "safe-bash-contracts/command";');
  const contracts = { name: "safe-bash-contracts", version: "0.0.1", private: true, type: "module", dependencies: {}, devDependencies: {}, exports: { "./command": { types: "./dist/command.d.ts", import: "./dist/command.js" } } };
  volume.mkdirSync("/repo/packages/safe-bash-contracts/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/safe-bash-contracts/package.json", JSON.stringify(contracts));
  volume.writeFileSync("/repo/packages/safe-bash-contracts/dist/command.js", "export const commandRuntimeIdentity = {};");
  volume.writeFileSync("/repo/packages/safe-bash-contracts/dist/command.d.ts", "export interface CommandDefinition { name: string }");
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces["safe-bash-contracts"] = { version: "0.0.1", dependencies: {}, devDependencies: {} };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/ffmpeg/index.${suffix}`, `export * from "${name}";`);
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const read = (file: string) => volume.readFileSync("/output/safe-bash/" + file, "utf8");
  expect(JSON.parse(read("package.json")).exports["./commands/ffmpeg"]).toEqual({ types: "./dist/safe-bash/commands/ffmpeg/index.d.ts", import: "./dist/safe-bash/commands/ffmpeg/index.js" });
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

it("embeds the declared ssconvert SDK behind its legacy CLI subpath without a CLI dependency", async () => {
  const { volume, options } = optionalLeftovers();
  volume.mkdirSync("/repo/packages/safe-bash-command-ssconvert/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/package.json", JSON.stringify({
    ...JSON.parse(readFileSync(new URL("../packages/safe-bash-command-ssconvert/package.json", import.meta.url), "utf8")),
    files: ["dist"],
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/dist/index.js", "export const createEngine = () => 'spreadsheet';");
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/dist/index.d.ts", "export declare const createEngine: () => string;");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync("/repo/packages/safe-bash/dist/commands/ssconvert/index." + suffix,
    'export { createEngine } from "poe-code/ssconvert";');
  await packageSafeLibraries({ ...options, outDir: "/output" });
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
  const imported = command.statements.find(ts.isImportDeclaration)!.moduleSpecifier as ts.StringLiteral;
  volume.mkdirSync("/repo/packages/safe-bash-command-ssconvert/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/package.json", JSON.stringify({
    ...JSON.parse(readFileSync(new URL("../packages/safe-bash-command-ssconvert/package.json", import.meta.url), "utf8")),
    files: ["dist"],
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/dist/index.js", "export const createEngine = () => ({});");
  volume.writeFileSync("/repo/packages/safe-bash-command-ssconvert/dist/index.d.ts", "export declare const createEngine: () => object;");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync("/repo/packages/safe-bash/dist/commands/ssconvert/index." + suffix, `export { createEngine } from ${JSON.stringify(imported.text)};`);
  await packageSafeLibraries({ ...options, outDir: "/output" });
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/commands/ssconvert/index.js", "utf8")).toContain('"../../../safe-bash-command-ssconvert/index.js"');
  expect(JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8")).dependencies).not.toHaveProperty("poe-code");
});

it("ships an explicitly declared private command SDK with its runtime graph", async () => {
  const { volume, options } = optionalLeftovers();
  const manifest = structuredClone(bashManifest);
  manifest.devDependencies["safe-bash-command-csvkit"] = "*";
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync("/repo/packages/safe-bash-command-csvkit/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/safe-bash-command-csvkit/package.json", JSON.stringify({
    name: "safe-bash-command-csvkit", private: true, type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  volume.writeFileSync("/repo/packages/safe-bash-command-csvkit/dist/index.js", "export const commands = ['csvcut'];");
  volume.writeFileSync("/repo/packages/safe-bash-command-csvkit/dist/index.d.ts", "export declare const commands: string[];");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync("/repo/packages/safe-bash/dist/commands/csvkit/index." + suffix, 'export { commands } from "safe-bash-command-csvkit";');
  await packageSafeLibraries({ ...options, outDir: "/output" });
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/commands/csvkit/index.js", "utf8")).toContain('"../../../safe-bash-command-csvkit/index.js"');
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash-command-csvkit/index.js", "utf8")).toContain("csvcut");
  expect(JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8")).dependencies).not.toHaveProperty("safe-bash-command-csvkit");
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
  volume.mkdirSync("/repo/packages/safe-bash-command-csvkit/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/safe-bash-command-csvkit/package.json", JSON.stringify({
    name: "safe-bash-command-csvkit", private: true, type: "module",
    exports: { ".": {
      types: { browser: "./dist/index.d.ts", default: "./dist/index.d.ts" },
      workerd: "./dist/index.js", browser: "./dist/index.js", node: "./dist/index.js", default: "./dist/index.js",
    } },
  }));
  volume.writeFileSync("/repo/packages/safe-bash-command-csvkit/dist/index.js", "export const commands = ['csvcut'];");
  volume.writeFileSync("/repo/packages/safe-bash-command-csvkit/dist/index.d.ts", "export declare const commands: string[];");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync("/repo/packages/safe-bash/dist/commands/csvkit/index." + suffix, 'export { commands } from "safe-bash-command-csvkit";');
  await packageSafeLibraries({ ...options, outDir: "/output" });
  for (const suffix of ["js", "d.ts"]) expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/commands/csvkit/index." + suffix, "utf8")).toContain('"../../../safe-bash-command-csvkit/index.js"');
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash-command-csvkit/index.js", "utf8")).toContain("csvcut");
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash-command-csvkit/index.d.ts", "utf8")).toContain("commands");
});

it.each([
  { types: "./dist/index.d.ts", import: null, default: "./dist/index.js" },
  { types: "./dist/index.d.ts", import: { import: null, default: "./dist/index.js" } },
  { types: { import: null, default: "./dist/index.d.ts" }, import: "./dist/index.js" },
])("refuses private SDK export conditions explicitly blocked by null: %j", async (exported) => {
  const { volume, options } = optionalLeftovers();
  volume.mkdirSync("/repo/packages/safe-bash-command-csvkit/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/safe-bash-command-csvkit/package.json", JSON.stringify({ name: "safe-bash-command-csvkit", private: true, exports: { ".": exported } }));
  volume.writeFileSync("/repo/packages/safe-bash-command-csvkit/dist/index.js", "export const commands = [];");
  volume.writeFileSync("/repo/packages/safe-bash-command-csvkit/dist/index.d.ts", "export declare const commands: string[];");
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync("/repo/packages/safe-bash/dist/commands/csvkit/index." + suffix, 'export { commands } from "safe-bash-command-csvkit";');
  await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Missing private workspace");
});

it("preserves public contract exports when the browser bundle externalizes their canonical runtime", async () => {
  const entry = readFileSync(new URL("../packages/safe-bash/src/core.browser.ts", import.meta.url), "utf8");
  const publicContracts = {
    command: ["CommandArgumentIdentityError", "createCommandArguments", "getCommandArguments", "commandRuntimeIdentity", "CommandRegistry", "validateExitCode"],
    "command-requirements": ["evaluateCommandSupport", "assertCommandRequirements"],
    errors: ["isErrnoCode", "isFsError", "toFsError", "FsError"],
    filesystem: ["ACCESS_MODES"],
    io: ["collectBytes", "readBytes", "toByteSource", "outputFailure", "createBytePipe", "writeText", "writeBytes", "pipeBytes", "collectText"],
    output: ["createOutputOperation"],
    plugin: ["composeMiddleware"],
  };
  const forwarding = Object.keys(publicContracts).map(name => `export * from "safe-bash-contracts/${name}";`).join("\n");
  const modules = new Map([
    ["shell", forwarding],
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
  expect(Object.keys(output.exports.api).sort()).toEqual([...names].sort());
  for (const name of names) expect(output.exports.api[name]).toBe(output.exports.canonical[name]);
});

it("ships the ExifTool implementation and declarations without an unpublished dependency", async () => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-exiftool";
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = {
    [name]: { version: "0.0.1", dependencies: {}, devDependencies: { "safe-bash-contracts": "*", "@poe-code/safe-fs": "*" }, assets: ["./dist/profile.bin"] },
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
  expect(shipped.exports["./commands/exiftool"]).toEqual({ types: "./dist/safe-bash/commands/exiftool/index.d.ts", import: "./dist/safe-bash/commands/exiftool/index.js" });
  expect(read("dist/safe-bash/commands/exiftool/index.js")).toContain('"../../../safe-bash-command-exiftool/index.js"');
  expect(read("dist/safe-bash/commands/exiftool/index.d.ts")).toContain('"../../../safe-bash-command-exiftool/index.js"');
  const consumer = await import("data:text/javascript;base64," + Buffer.from(read("dist/safe-bash-command-exiftool/scalar.js")).toString("base64"));
  expect(consumer.encodeJsonScalar("1e999")).toBe("1e999");
  expect(consumer.encodeJsonScalar("a\0b\x7f")).toBe('"ab\\u007F"');
});

it("bundles a real private command behind its packed subpath", async () => {
  const { volume, options } = optionalLeftovers();
  const name = "safe-bash-command-exiftool";
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = {
    [name]: { version: "0.0.1", dependencies: {}, devDependencies: { "safe-bash-contracts": "*", "@poe-code/safe-fs": "*" } },
  };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
  volume.writeFileSync(`/repo/packages/${name}/package.json`, readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), "utf8"));
  volume.writeFileSync(`/repo/packages/${name}/LICENSE`, readFileSync(new URL(`../packages/${name}/LICENSE`, import.meta.url)));
  const scalar = readFileSync(new URL(`../packages/${name}/src/scalar.ts`, import.meta.url), "utf8");
  volume.writeFileSync(`/repo/packages/${name}/dist/index.js`, 'export { encodeJsonScalar } from "./scalar.js";');
  volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, 'export { encodeJsonScalar } from "./scalar.js";');
  volume.writeFileSync(`/repo/packages/${name}/dist/scalar.js`, ts.transpileModule(scalar, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  volume.writeFileSync(`/repo/packages/${name}/dist/scalar.d.ts`, ts.transpileDeclaration(scalar, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/exiftool/index.${suffix}`, `export * from "${name}";`);
  const bundle = async (settings: BuildOptions) => {
    if (settings.outdir !== "/repo/packages") return options.bundle(settings);
    return build({ ...settings, plugins: [{ name: "private-build-inputs", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => ({ path: new URL(args.path, pathToFileURL(args.resolveDir + "/")).pathname, namespace: "private" }));
      builder.onLoad({ filter: /.*/, namespace: "private" }, args => ({ contents: volume.readFileSync(args.path, "utf8").toString(), resolveDir: args.path.slice(0, args.path.lastIndexOf("/")) }));
    } }] });
  };
  await packageSafeLibraries({ ...options, bundle, outDir: "/output" });
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

describe("isolated packed private command graph", () => {
  let volume: Volume;
  let plugin: Plugin;

  // Build the package fixture separately from its consumer type and runtime checks.
  beforeAll(async () => {
    const fixture = optionalLeftovers();
    volume = fixture.volume;
    const { options } = fixture;
    const repository = fileURLToPath(new URL("../", import.meta.url));
    const manifest = structuredClone(bashManifest);
    manifest.poeCode.integration.privateWorkspaces = {};
    for (const name of ["safe-bash-contracts", "safe-bash-command-exiftool", "safe-bash-csv-engine", "safe-bash-command-csvgrep", "safe-bash-command-csvcut"]) {
      const directory = path.join(repository, "packages", name);
      const pkg = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
      manifest.poeCode.integration.privateWorkspaces[name] = {
        version: pkg.version, dependencies: pkg.dependencies ?? {}, devDependencies: pkg.devDependencies ?? {},
      };
      volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
      volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify(pkg));
      volume.writeFileSync(`/repo/packages/${name}/LICENSE`, readFileSync(path.join(directory, "LICENSE")));
      for (const filename of readdirSync(path.join(directory, "src"))) {
        if (!filename.endsWith(".ts") || filename.endsWith(".test.ts") || filename === "fixtures.ts") continue;
        const source = readFileSync(path.join(directory, "src", filename), "utf8");
        const compilerOptions = { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 };
        volume.writeFileSync(`/repo/packages/${name}/dist/${filename.slice(0, -3)}.js`, transformSync(source, { loader: "ts", format: "esm", target: "es2022" }).code);
        const distDts = path.join(directory, "dist", `${filename.slice(0, -3)}.d.ts`);
        const dtsText = getCachedDeclaration(distDts, source, compilerOptions);
        volume.writeFileSync(`/repo/packages/${name}/dist/${filename.slice(0, -3)}.d.ts`, dtsText);
      }
    }
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
    const portable = resolveBrowserShellBuild(repository);
    const shell = await build({ ...portable, splitting: false, sourcemap: false,
      entryPoints: undefined,
      stdin: { contents: 'export { Shell } from "./src/shell/shell.ts"; export * from "safe-bash-contracts/command"; export * from "safe-bash-contracts/errors";', resolveDir: path.join(repository, "packages/safe-bash") },
      outdir: "/repo/packages/safe-bash/dist",
      external: [...portable.external, "safe-bash-contracts", "@poe-platform/safe-fs"],
    });
    volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", shell.outputFiles[0]!.contents);
    // Both public routes share this fixture's Shell; package its source graph once.
    volume.writeFileSync("/repo/packages/safe-bash/dist/core.browser.js", 'export * from "./index.js";');
    const fs = await build({ entryPoints: [path.join(repository, "packages/safe-fs/src/core.ts")], bundle: true,
      write: false, platform: "browser", format: "esm", target: "es2022" });
    const fsManifest = JSON.parse(volume.readFileSync("/repo/packages/safe-fs/package.json", "utf8").toString());
    fsManifest.exports["./core"] = { types: "./dist/core.d.ts", import: "./dist/core.js" };
    volume.writeFileSync("/repo/packages/safe-fs/package.json", JSON.stringify(fsManifest));
    volume.writeFileSync("/repo/packages/safe-fs/dist/core.js", fs.outputFiles[0]!.contents);
    // The command type fixture models only its external filesystem contracts;
    // complete published declarations are checked by the installed consumer.
    volume.writeFileSync("/repo/packages/safe-fs/dist/core.d.ts", ['errors', 'filesystem', 'io'].map(name => `export * from "./contracts/${name}.js";`).join("\n"));
    const declarationQueue = ["contracts/errors.ts", "contracts/filesystem.ts", "contracts/io.ts", "platform/browser.ts", "platform/node.ts"], declared = new Set<string>();
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
    for (const subpath of ["command", "value", "errors", "plugin"]) {
      for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/contracts/${subpath}.${suffix}`, `export * from "safe-bash-contracts/${subpath}";`);
    }
    for (const name of ["exiftool", "csvgrep", "csvcut"]) for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/${name}/index.${suffix}`, `export * from "safe-bash-command-${name}";`);
    plugin = { name: "isolated-packed-files", setup(builder: import("esbuild").PluginBuild) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (builder.initialOptions.external?.some(name => args.path === name || args.path.startsWith(name + "/"))) return { path: args.path, external: true };
        if (args.path.startsWith("node:")) throw new Error("Node dependency in portable command consumer: " + args.path);
        let filename;
        if (args.path.startsWith("@poe-platform/")) {
          const [name, ...route] = args.path.slice("@poe-platform/".length).split("/");
          const pkg = JSON.parse(volume.readFileSync(`/output/${name}/package.json`, "utf8").toString());
          const key = route.length ? "./" + route.join("/") : ".";
          const target = pkg.exports[key] ?? pkg.exports["./contracts/*"];
          filename = `/output/${name}/` + (target.browser ?? target.import).replace("*", route.slice(1).join("/"));
        } else filename = path.resolve(args.resolveDir, args.path);
        if (!filename.startsWith("/output/") && !filename.startsWith("/repo/packages/safe-bash-command-")) throw new Error("Outside isolated consumer: " + filename);
        return { path: path.normalize(filename), namespace: "packed" };
      });
      builder.onLoad({ filter: /.*/, namespace: "packed" }, args => ({ contents: volume.readFileSync(args.path, "utf8").toString(), resolveDir: path.dirname(args.path) }));
    } };
    await packageSafeLibraries({ ...options, outDir: "/output", bundle: async (settings: BuildOptions) => {
      if (settings.outdir !== "/repo/packages") return options.bundle(settings);
      return build({ ...settings, plugins: [plugin] });
    } });
    // Remove every workspace before resolving the consumer's public imports.
    volume.rmSync("/repo", { recursive: true });
    // Resolve the public declarations with no private workspace or package present.
    volume.mkdirSync("/output/node_modules/@poe-platform", { recursive: true });
    volume.symlinkSync("/output/safe-bash", "/output/node_modules/@poe-platform/safe-bash");
    volume.symlinkSync("/output/safe-fs", "/output/node_modules/@poe-platform/safe-fs");
    volume.writeFileSync("/output/csvcut-consumer.mts", readFileSync(new URL("./fixtures/safe-packages-csvcut-types.mts", import.meta.url)));
  });

  it("admits Shell byte argv through an isolated packed private command graph", async () => {
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
    const program = ts.createProgram(["/output/csvcut-consumer.mts"], compilerOptions, host);
    expect(ts.getPreEmitDiagnostics(program).map(diagnostic => `${diagnostic.file?.fileName ?? "compiler"}:${diagnostic.start ?? 0}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`)).toEqual([]);
    const consumer = await build({ stdin: { contents: readFileSync(new URL("./fixtures/safe-packages-private-command.mjs", import.meta.url), "utf8"), resolveDir: "/output" },
      bundle: true, write: false, platform: "browser", format: "cjs", target: "es2022", plugins: [plugin] });
    const sandbox = createContext({ TextEncoder, TextDecoder, TypeError, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
      AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance });
    // Execute fixture top-level await in the Buffer-free isolated realm.
    await runInContext(`(async () => { const module = { exports: {} }; ${consumer.outputFiles[0]!.text}; await module.exports.verification; })()`, sandbox);
  });
});

it.each(["wkhtmltopdf", "xz"])("packs %s and contract modules into one canonical relative graph", async command => {
  const commandName = `safe-bash-command-${command}`;
  const commandManifest = JSON.parse(readFileSync(new URL(`../packages/${commandName}/package.json`, import.meta.url), "utf8"));
  expect(commandManifest.private).toBe(true);
  expect(bashManifest.poeCode.integration.privateWorkspaces[commandName]).toBeDefined();
  const facade = ts.createSourceFile("index.ts", readFileSync(new URL(`../packages/safe-bash/src/commands/${command}/index.ts`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  expect(facade.statements.some(statement => ts.isExportDeclaration(statement)
    && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === commandName)).toBe(true);
  const { volume, options } = optionalLeftovers();
  for (const [name, dependencies, devDependencies] of [
    ["safe-bash-contracts", {}, {}],
    [commandName, {}, { "safe-bash-contracts": "*" }],
  ] as const) {
    volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
    volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({
      name, version: "0.0.1", private: true, type: "module", dependencies, devDependencies,
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    }));
    volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, name === "safe-bash-contracts"
      ? "export declare const identity: object;" : 'export { identity } from "safe-bash-contracts";');
    volume.writeFileSync(`/repo/packages/${name}/dist/index.js`, name === "safe-bash-contracts"
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
  volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/${command}/index.js`, `export * from "${commandName}";`);
  volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/${command}/index.d.ts`, `export * from "${commandName}";`);
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const read = (path: string) => volume.readFileSync("/output/safe-bash/dist/" + path, "utf8");
  expect(read("safe-bash/index.js")).toContain('"../safe-bash-contracts/index.js"');
  expect(read(`safe-bash/commands/${command}/index.js`)).toContain(`"../../../${commandName}/index.js"`);
  expect(read(`${commandName}/index.js`)).toContain('"../safe-bash-contracts/index.js"');
  expect(read(`${commandName}/index.d.ts`)).toContain('"../safe-bash-contracts/index.js"');
  const shipped = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
  expect(shipped.dependencies).toEqual({});
  expect(shipped.exports[`./commands/${command}`]).toEqual({
    types: `./dist/safe-bash/commands/${command}/index.d.ts`, import: `./dist/safe-bash/commands/${command}/index.js`,
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
    data[`/repo/packages/${name}/package.json`] = readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), "utf8");
    data[`/repo/packages/${name}/LICENSE`] = "Fixture license\n";
    data[`/repo/packages/${name}/dist/index.js`] = "export {};\n";
    data[`/repo/packages/${name}/dist/index.d.ts`] = "export {};\n";
    for (const asset of profile.assets) data[`/repo/packages/${name}/` + asset.slice(2)] = "Fixture asset\n";
  }
  const volume = Volume.fromJSON(data);
  const files = createFsFromVolume(volume).promises;
  const bundle = vi.fn(async (settings: { outdir?: string }) => ({ outputFiles: settings.outdir === "/repo/packages/safe-js/dist" ? [{ path: "/repo/packages/safe-js/dist/index.js", contents: Buffer.from(volume.readFileSync("/repo/packages/safe-js/dist/index.js")) }] : [] }));
  return { volume, data, excluded, options: { rootDir: "/repo", version: "0.1.0", files, bundle } };
}

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
    "./dist/platform/node.d.ts", "./dist/platform/node.js", "./dist/platform/browser.d.ts", "./dist/platform/browser.js"]) {
    const filename = "/repo/packages/safe-fs/" + target.slice(2);
    volume.mkdirSync(path.dirname(filename), { recursive: true });
    volume.writeFileSync(filename, target.includes("/fs/real/") ? 'import "#safe-fs-platform"; export {};\n' : "export {};\n");
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
  for (const entry of ["./node", "./fs/s3", "./fs/s3/http"]) {
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
});

it('preserves companion references to conditional public contracts in the same published package', async () => {
  const { volume, options } = optionalLeftovers();
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
      "/output/safe-bash/dist/safe-bash-command-fold/LICENSE": data["/repo/packages/safe-bash-command-fold/LICENSE"],
      "/output/safe-bash/dist/safe-bash-command-fold/COPYING": data["/repo/packages/safe-bash-command-fold/dist/COPYING"],
      "/output/safe-bash/dist/safe-bash-command-fold/COPYING.LESSER": data["/repo/packages/safe-bash-command-fold/dist/COPYING.LESSER"],
      "/output/safe-bash/dist/safe-bash-command-fold/width-data.ts": data["/repo/packages/safe-bash-command-fold/dist/width-data.ts"],
      "/output/safe-bash/dist/safe-bash-command-xmllint/LICENSE": data["/repo/packages/safe-bash-command-xmllint/LICENSE"],
      "/output/safe-bash/dist/safe-bash-command-xmllint/index.d.ts": data["/repo/packages/safe-bash-command-xmllint/dist/index.d.ts"],
      "/output/safe-bash/dist/safe-bash-xml-engine/LICENSE": data["/repo/packages/safe-bash-xml-engine/LICENSE"],
      "/output/safe-bash/dist/safe-bash-xml-engine/index.d.ts": data["/repo/packages/safe-bash-xml-engine/dist/index.d.ts"],
    });
    expected["/output/safe-bash/dist/safe-bash-compression-engine/LICENSE"] = data["/repo/packages/safe-bash-compression-engine/LICENSE"]!;
    for (const asset of ["sources.json", "LICENSES.txt", "generated/bz2.mjs", "generated/bz2.d.mts", "generated/xz.mjs", "generated/xz.d.mts", "generated/zstd.mjs", "generated/zstd.d.mts"]) {
      expected["/output/safe-bash/dist/safe-bash-compression-engine/native/" + asset] = data["/repo/packages/safe-bash-compression-engine/dist/native/" + asset]!;
    }
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
    else volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", route === "runtime" ? 'export * from "./optional.js";' : route === "dynamic" ? 'export const leak = () => import("./shell/extensions/read/index.js");' : 'export const leak = new URL("./commands/dd/nested/data.json", import.meta.url);');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Excluded package file referenced:");
  });

  for (const route of ["export", "runtime", "declaration", "dynamic", "asset"] as const) it(`uses the referenced workspace's exclusions for a cross-package ${route} edge`, async () => {
    const { volume, options } = optionalLeftovers();
    if (route === "export") {
      const manifest = JSON.parse(volume.readFileSync("/repo/package.json", "utf8").toString());
      manifest.exports["./safe-js/leak"] = { import: "./packages/safe-bash/dist/optional.js" };
      volume.writeFileSync("/repo/package.json", JSON.stringify(manifest));
    } else if (route === "declaration") volume.writeFileSync("/repo/packages/safe-js/dist/index.d.ts", 'export type Leak = import("../../safe-bash/dist/optional.js").Leak;');
    else volume.writeFileSync("/repo/packages/safe-js/dist/index.js", route === "runtime" ? 'export * from "../../safe-bash/dist/optional.js";' : route === "dynamic" ? 'export const leak = () => import("../../safe-bash/dist/shell/extensions/read/index.js");' : 'export const leak = new URL("../../safe-bash/dist/commands/dd/nested/data.json", import.meta.url);');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Excluded package file referenced:");
    expect(Object.keys(volume.toJSON()).filter(filename => filename.startsWith("/output/safe-js/dist/safe-bash/"))).toEqual([]);
  });

  for (const excludeMap of [false, true]) it(`preserves cross-package core runtime, declaration and asset members with owner source-map policy: excluded=${excludeMap}`, async () => {
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
    expect(volume.existsSync("/output/safe-js/dist/safe-bash/contracts/worker.mjs.map")).toBe(!excludeMap);
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

  it("packages canonical runtime and declaration closures without private dependencies", async () => {
    const volume = Volume.fromJSON({
      "/repo/package.json": JSON.stringify({ license: "MIT", dependencies: { external: "^2.0.0" }, exports: {
        "./safe-js": { types: "./packages/safe-js/dist/index.d.ts", import: "./packages/safe-js/dist/index.js" },
        "./safe-js/workerd": { types: "./packages/safe-js/dist/workerd.d.ts", workerd: "./packages/safe-js/dist/workerd.js", browser: null, import: "./packages/safe-js/dist/workerd.js" },
        "./safe-fs": { types: "./packages/safe-fs/dist/index.d.ts", import: "./packages/safe-js/dist/safe-fs.js" },
      } }),
      "/repo/packages/safe-js/package.json": JSON.stringify({ name: "private-js", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./workerd": { types: "./dist/workerd.d.ts", import: "./dist/workerd.js" } } }),
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
    volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'export { parseDocument } from "yaml"; export * from "../../safe-bash-command-pandoc/dist/defaults.js";');
    const bundle = vi.fn(async (recipe: BuildOptions) => recipe.outfile?.endsWith("/bundled-yaml/index.js")
      ? build({ ...recipe, absWorkingDir: path.resolve(import.meta.dirname, ".."),
        stdin: { ...recipe.stdin!, resolveDir: path.resolve(import.meta.dirname, "..") } })
      : options.bundle(recipe));
    await packageSafeLibraries({ ...options, bundle, outDir: "/output" });
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
  for (const name of ["safe-bash-command-op", "pandoc", "office-package"]) {
    const profile = name === "safe-bash-command-op" ? bashManifest.poeCode.integration.privateWorkspaces[name] : undefined;
    volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
    volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({
      name: profile ? name : `@poe-code/${name}`, private: true,
      ...(profile ? { type: "module", version: profile.version, dependencies: profile.dependencies, devDependencies: profile.devDependencies } : {}),
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    }));
    volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, "export {};\n");
  }
  volume.writeFileSync("/repo/packages/office-package/dist/index.js", "export const codec = 1;\n");
  for (const name of ["op", "pandoc"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/${name}/index.js`,
    `export * from "${name === "op" ? "safe-bash-command-op" : "safe-bash-command-pandoc"}";`);
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
  for (const name of ["op", "pandoc"]) expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash/commands/${name}/index.js`, "utf8"))
    .toBe('export const prepared = true;\n');
  expect(volume.readFileSync("/output/safe-bash/dist/office-package/index.js", "utf8")).toBe("export const codec = 1;\n");
  expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/index.js", "utf8"))
    .toBe('export { codec } from "../office-package/index.js";');
  const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
  expect(manifest.dependencies).toEqual({});
  expect(volume.existsSync("/repo/dist")).toBe(false);
});

for (const [specifier, target, failure] of [
  ["private-runtime", "./dist/index.js", "Private or CLI dependency leaked"],
  ["@poe-code/office-package/missing", "./dist/index.js", "Missing private workspace runtime entrypoint"],
  ["@poe-code/office-package", "../../outside.js", "Not a built package file"],
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


it.each(["@poe-code/safe-fs/core", "poe-code/safe-fs/core", "@poe-platform/safe-fs/core"])("keeps browser filesystem import %s canonical instead of embedding a private constructor", async specifier => {
  const { options } = optionalLeftovers();
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const browser = options.bundle.mock.calls.map(([settings]) => settings as BuildOptions)
    .find(settings => settings.platform === "browser")!;
  expect(browser).toBeDefined();
  const result = await build({
    ...browser, absWorkingDir: process.cwd(), entryPoints: undefined, outdir: undefined,
    sourcemap: false, splitting: false, inject: [],
    stdin: { contents: `export { FsError } from ${JSON.stringify(specifier)};`, resolveDir: process.cwd() },
    plugins: [],
  });
  expect(result.outputFiles![0]!.text).toContain('from "@poe-platform/safe-fs/core"');
  expect(result.outputFiles![0]!.text).not.toContain("extends Error");
});

it('ships xmllint and its shared XML engine through the established XML export', async () => {
  const { volume, options } = optionalLeftovers();
  const manifest = structuredClone(bashManifest);
  const names = ['safe-bash-command-xmllint', 'safe-bash-xml-engine'];
  manifest.poeCode.integration.privateWorkspaces = Object.fromEntries(names.map(name => [name, bashManifest.poeCode.integration.privateWorkspaces[name as keyof typeof bashManifest.poeCode.integration.privateWorkspaces]])) as typeof manifest.poeCode.integration.privateWorkspaces;
  volume.writeFileSync('/repo/packages/safe-bash/package.json', JSON.stringify(manifest));
  for (const name of names) {
    volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
    volume.writeFileSync(`/repo/packages/${name}/package.json`, readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), 'utf8'));
    volume.writeFileSync(`/repo/packages/${name}/LICENSE`, 'MIT\n');
  }
  const limits = readFileSync(new URL('../packages/safe-bash-xml-engine/src/limits.ts', import.meta.url), 'utf8');
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
  const consumer = await import('data:text/javascript;base64,' + Buffer.from(read('safe-bash-xml-engine/limits.js')).toString('base64'));
  expect(consumer.resolveXmlQueryLimits().maxNodes).toBe(Infinity);
  expect(consumer.resolveXmlQueryLimits({}).maxNodes).toBe(Infinity);
  expect(consumer.resolveXmlQueryLimits({ maxNodes: Infinity }).maxNodes).toBe(Infinity);
  expect(consumer.resolveXmlQueryLimits({ maxNodes: 10_000 }).maxNodes).toBe(10_000);
  expect(() => consumer.resolveXmlQueryLimits({ maxNodes: 0 })).toThrow(RangeError);
});
