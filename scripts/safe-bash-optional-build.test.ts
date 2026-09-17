import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildOptionalPackage } from "../packages/safe-bash/scripts/build-optional.mjs";

const bashManifest = JSON.parse(readFileSync(new URL("../packages/safe-bash/package.json", import.meta.url), "utf8"));
const fsManifest = JSON.parse(readFileSync(new URL("../packages/safe-fs/package.json", import.meta.url), "utf8"));
const hostSource = readFileSync(new URL("../packages/safe-bash/src/optional-host.ts", import.meta.url), "utf8");
const hostDeclarations = ts.createSourceFile("optional-host.ts", hostSource, ts.ScriptTarget.Latest, true);
const hostRuntime = hostDeclarations.statements.filter(statement => ts.isExportDeclaration(statement) && !statement.isTypeOnly).map(statement => statement.getText(hostDeclarations)).join("\n") + "\n";
const configurations = Object.fromEntries(["tsconfig.json", "tsconfig.build.json", "tsconfig.optional.json"].map(name => [name, readFileSync(new URL(`../packages/safe-bash/${name}`, import.meta.url), "utf8")]));
const root = "/repo";
const core = root + "/packages/safe-bash";
const optional = core;

function fixture() {
  const data: Record<string, string | Buffer> = {
    [core + "/package.json"]: JSON.stringify({ ...bashManifest, exports: { ...bashManifest.exports, "./optional-host": { types: "./dist/optional-host.d.ts", import: "./dist/optional-host.js" } } }),
    [root + "/packages/safe-fs/package.json"]: JSON.stringify(fsManifest),
    ...Object.fromEntries(Object.entries(configurations).map(([name, contents]) => [core + "/" + name, contents])),
    [core + "/src/optional.ts"]: "export {};\n",
    [core + "/src/commands/yes/payload.bin"]: Buffer.from([0, 255, 195, 169]),
    [core + "/dist/optional.js"]: 'export { Shell } from "./index.js"; export { yesCommands } from "./commands/yes/index.js";\n//# sourceMappingURL=optional.js.map\n',
    [core + "/dist/optional.d.ts"]: 'export { Shell } from "./index.js"; export type { ShellExtension } from "./shell/extensions.js"; export { yesCommands } from "./commands/yes/index.js";\n//# sourceMappingURL=optional.d.ts.map\n',
    [core + "/dist/optional.js.map"]: "{}\n",
    [core + "/dist/optional.d.ts.map"]: "{}\n",
    [core + "/dist/commands/yes/index.js"]: 'import { commandRuntimeIdentity } from "../../contracts/command.js"; import { helper } from "./helper.js"; import { output } from "../internal.js"; export const asset = new URL("./payload.bin", import.meta.url); export const label = "../../contracts/command.js"; export const yesCommands = () => ({ commandRuntimeIdentity, helper, output });\n',
    [core + "/dist/commands/yes/index.d.ts"]: 'import type { VirtualShellPlugin } from "../../contracts/plugin.js"; export declare function yesCommands(): VirtualShellPlugin;\n',
    [core + "/dist/commands/yes/helper.js"]: 'import { shellValueFromBytes } from "../../contracts/value.js"; import { yieldTurn } from "../../contracts/yield.js"; import { openFileOutput } from "../../contracts/filesystem-output.js"; import { FsError } from "poe-code/safe-fs"; export const helper = { shellValueFromBytes, yieldTurn, openFileOutput, FsError };\n',
    [core + "/dist/optional-host.js"]: hostRuntime,
    [core + "/dist/optional-host.d.ts"]: hostSource,
    [core + "/dist/index.js"]: "export class Shell {}\n",
    [core + "/dist/index.d.ts"]: "export declare class Shell {}\n",
    [core + "/dist/commands/internal.js"]: "export const output = () => {};\n",
    [core + "/dist/commands/internal.d.ts"]: "export declare const output: () => void;\n",
    [core + "/dist/commands/copy-identity.js"]: "export {};\n",
    [core + "/dist/commands/copy-identity.d.ts"]: "export {};\n",
    [core + "/dist/shell/extensions.d.ts"]: "export interface ShellExtension {}\n",
    [core + "/dist/shell/input.d.ts"]: "export {};\n",
    [root + "/packages/safe-fs/dist/index.js"]: "export class FsError extends Error {}\n",
    [root + "/packages/safe-fs/dist/index.d.ts"]: "export declare class FsError extends Error {}\n",
  };
  for (const name of ["command", "value", "yield", "filesystem-output", "plugin"]) {
    data[core + `/dist/contracts/${name}.js`] = "export {};\n";
    data[core + `/dist/contracts/${name}.d.ts`] = "export {};\n";
  }
  const volume = Volume.fromJSON(data);
  const fileSystem = createFsFromVolume(volume);
  const compilation = { status: 0, rootNames: [core + "/src/optional.ts"], emittedFiles: Object.keys(data).filter(name => name.startsWith(core + "/dist/")) };
  const compile = async () => ({
    ...compilation,
    inputHashes: Object.fromEntries([core + "/src/optional.ts", ...Object.keys(configurations).map(name => core + "/" + name)].map(name => [name, createHash("sha256").update(volume.readFileSync(name)).digest("hex")])),
    emittedHashes: Object.fromEntries(compilation.emittedFiles.filter(name => volume.existsSync(name)).map(name => [name, createHash("sha256").update(volume.readFileSync(name)).digest("hex")])),
  });
  return { volume, compilation, options: { rootDir: root, compile, fileSystem } };
}

describe("optional-owned compiled graph", () => {
  it("rewrites real contract routes and declared support bindings without copying core identity", async () => {
    const { volume, options } = fixture();
    const result = await buildOptionalPackage(options);
    expect(result.status).toBe(0);
    const read = (name: string) => volume.readFileSync(optional + "/dist/opt-in/" + name, "utf8").toString();
    expect(read("optional.js")).toContain('from "@poe-platform/safe-bash"');
    expect(read("optional.d.ts")).toContain('from "@poe-platform/safe-bash/optional-host"');
    expect(read("commands/yes/index.js")).toContain('from "@poe-platform/safe-bash/contracts/command"');
    expect(read("commands/yes/index.js")).toContain('from "@poe-platform/safe-bash/optional-host"');
    expect(read("commands/yes/index.js")).toContain('from "./helper.js"');
    expect(read("commands/yes/index.js")).toContain('label = "../../contracts/command.js"');
    expect(read("commands/yes/helper.js")).toContain('from "@poe-platform/safe-fs"');
    for (const name of ["value", "yield", "filesystem-output"]) expect(read("commands/yes/helper.js")).toContain(`from "@poe-platform/safe-bash/contracts/${name}"`);
    expect(read("commands/yes/index.d.ts")).toContain('from "@poe-platform/safe-bash/contracts/plugin"');
    expect(volume.readFileSync(optional + "/dist/opt-in/commands/yes/payload.bin")).toEqual(Buffer.from([0, 255, 195, 169]));
    expect(Object.keys(volume.toJSON()).filter(name => name.startsWith(optional + "/dist/opt-in/")).sort()).toEqual([
      "commands/yes/helper.js", "commands/yes/index.d.ts", "commands/yes/index.js", "commands/yes/payload.bin", "entrypoints/yes.js", "entrypoints/yes.d.ts", "optional.d.ts", "optional.js",
    ].map(name => optional + "/dist/opt-in/" + name).sort());
    expect(read("optional.js")).not.toContain("sourceMappingURL");
    expect(read("optional.d.ts")).not.toContain("sourceMappingURL");
    expect(read("entrypoints/yes.js")).toBe('export { yesCommands } from "../commands/yes/index.js";\n');
  });

  it("does not select unrelated optional leftovers even when the compiler emitted them", async () => {
    const { volume, compilation, options } = fixture();
    volume.mkdirSync(core + "/dist/commands/dd", { recursive: true });
    const unrelated = core + "/dist/commands/dd/index.js";
    volume.writeFileSync(unrelated, "export const unrelated = true;\n");
    compilation.emittedFiles.push(unrelated);
    await buildOptionalPackage(options);
    expect(volume.existsSync(optional + "/dist/opt-in/commands/dd/index.js")).toBe(false);
  });

  it("refuses an absent support entry rather than inventing an API", async () => {
    const { volume, options } = fixture();
    const manifest = structuredClone(bashManifest);
    delete manifest.exports["./optional-host"];
    volume.writeFileSync(core + "/package.json", JSON.stringify(manifest));
    await expect(buildOptionalPackage(options)).rejects.toThrow("Unmapped core boundary:");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it("refuses a stale or failed compiler result before publishing files", async () => {
    const { volume, compilation, options } = fixture();
    compilation.status = 1;
    await expect(buildOptionalPackage(options)).rejects.toThrow("Successful maintained compilation required");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it("refuses a private module that only shares an optional directory prefix", async () => {
    const { volume, compilation, options } = fixture();
    volume.mkdirSync(core + "/dist/commands/yes-extra", { recursive: true });
    const target = core + "/dist/commands/yes-extra/identity.js";
    volume.writeFileSync(target, "export const identity = {};\n");
    compilation.emittedFiles.push(target);
    volume.writeFileSync(core + "/dist/commands/yes/helper.js", 'export * from "../yes-extra/identity.js";');
    await expect(buildOptionalPackage(options)).rejects.toThrow("Unmapped core boundary:");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it("retains literal dynamic imports and assets without admitting an undeclared external", async () => {
    const { volume, options } = fixture();
    volume.writeFileSync(core + "/dist/commands/yes/helper.js", 'export const load = () => import("yaml"); export { randomBytes } from "node:crypto";');
    const result = await buildOptionalPackage(options);
    expect(result.peerImports).toContain("yaml");
    expect(volume.readFileSync(optional + "/dist/opt-in/commands/yes/helper.js", "utf8")).toContain('import("yaml")');
  });

  it("preserves declaration import types and import aliases across the named support boundary", async () => {
    const { volume, options } = fixture();
    volume.writeFileSync(core + "/dist/commands/yes/index.d.ts", 'export type Context = import("../../shell/extensions.js").ShellExtension;');
    volume.writeFileSync(core + "/dist/commands/yes/helper.js", 'import { output as write } from "../internal.js"; export { write };');
    await buildOptionalPackage(options);
    expect(volume.readFileSync(optional + "/dist/opt-in/commands/yes/index.d.ts", "utf8")).toContain('import("@poe-platform/safe-bash/optional-host").ShellExtension');
    expect(volume.readFileSync(optional + "/dist/opt-in/commands/yes/helper.js", "utf8")).toContain('import { output as write } from "@poe-platform/safe-bash/optional-host"');
  });

  it.each([
    ['import * as helpers from "../internal.js"; export { helpers };', "Unmapped core boundary:"],
    ['export { missing } from "../internal.js";', "Unmapped core boundary:"],
    ['export * from "../internal.js";', "Unmapped core boundary:"],
    ['export const load = name => import(name);', "Nonliteral module reference:"],
    ['export const load = name => require(name);', "Nonliteral module reference:"],
    ['export const asset = name => new URL(name, import.meta.url);', "Nonliteral module reference:"],
    ['export const asset = new URL("../internal.js", import.meta.url);', "Unmapped core asset:"],
    ['export * from "../../../../safe-fs/dist/index.js";', "Module escapes core output:"],
    ['export * from "poe-code/safe-fs/private";', "Unexported peer route:"],
    ['export * from "other-dependency";', "Unmapped external import:"],
  ])("refuses unaccounted edge %s", async (text, message) => {
    const { volume, options } = fixture();
    volume.writeFileSync(core + "/dist/commands/yes/helper.js", text);
    await expect(buildOptionalPackage(options)).rejects.toThrow(message);
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it("refuses support re-exports renamed away from the requested name", async () => {
    const { volume, options } = fixture();
    volume.writeFileSync(core + "/dist/optional-host.js", 'export { output as other } from "./commands/internal.js";');
    await expect(buildOptionalPackage(options)).rejects.toThrow("Unmapped core boundary:");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it("requires both runtime and declaration outputs in the successful compiler inventory", async () => {
    const { volume, compilation, options } = fixture();
    compilation.emittedFiles = compilation.emittedFiles.filter(name => !name.endsWith("commands/yes/index.d.ts"));
    await expect(buildOptionalPackage(options)).rejects.toThrow("Not in successful compiler output:");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it("rejects a different compiler root even when emitted files are present", async () => {
    const { volume, compilation, options } = fixture();
    compilation.rootNames = [core + "/src/index.ts"];
    await expect(buildOptionalPackage(options)).rejects.toThrow("Compilation must match the declared optional config");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it("requires the referenced public target to exist", async () => {
    const { volume, compilation, options } = fixture();
    volume.unlinkSync(core + "/dist/contracts/value.js");
    compilation.emittedFiles = compilation.emittedFiles.filter(name => name !== core + "/dist/contracts/value.js");
    await expect(buildOptionalPackage(options)).rejects.toThrow("ENOENT");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it("rejects optional ownership patterns rather than widening admission", async () => {
    const { volume, options } = fixture();
    const manifest = JSON.parse(volume.readFileSync(core + "/package.json", "utf8").toString());
    manifest.files.push("!dist/**");
    volume.writeFileSync(core + "/package.json", JSON.stringify(manifest));
    await expect(buildOptionalPackage(options)).rejects.toThrow("Unsupported package file exclusion:");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it.each(["input", "output", "asset"])("refuses %s symlink members", async kind => {
    const { volume, options } = fixture();
    if (kind === "input") {
      volume.unlinkSync(core + "/dist/commands/yes/helper.js");
      volume.symlinkSync(core + "/dist/commands/internal.js", core + "/dist/commands/yes/helper.js");
    } else if (kind === "asset") {
      volume.unlinkSync(core + "/src/commands/yes/payload.bin");
      volume.symlinkSync(core + "/dist/commands/internal.js", core + "/src/commands/yes/payload.bin");
    } else {
      volume.symlinkSync(core + "/dist", optional + "/dist/opt-in");
    }
    await expect(buildOptionalPackage(options)).rejects.toThrow();
    expect(volume.existsSync(optional + "/dist/opt-in/optional-host.js")).toBe(kind === "output");
  });

  it("refuses stale destination core files without deleting or overwriting them", async () => {
    const { volume, options } = fixture();
    volume.mkdirSync(optional + "/dist/opt-in", { recursive: true });
    volume.writeFileSync(optional + "/dist/opt-in/identity.js", "retained");
    await expect(buildOptionalPackage(options)).rejects.toThrow("Unexpected existing output member:");
    expect(volume.readFileSync(optional + "/dist/opt-in/identity.js", "utf8")).toBe("retained");
    expect(volume.existsSync(optional + "/dist/opt-in/optional.js")).toBe(false);
  });

  it("rejects entry imports that use a public route to vendor optional code back into the peer", async () => {
    const { volume, options } = fixture();
    const manifest = JSON.parse(volume.readFileSync(core + "/package.json", "utf8").toString());
    manifest.exports["./commands/yes"] = { import: "./dist/commands/yes/index.js", types: "./dist/commands/yes/index.d.ts" };
    volume.writeFileSync(core + "/package.json", JSON.stringify(manifest));
    volume.writeFileSync(core + "/dist/commands/yes/helper.js", 'export * from "@poe-platform/safe-bash/commands/yes";');
    await expect(buildOptionalPackage(options)).rejects.toThrow("Unexported peer route:");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it("refuses to infer missing peer dependencies", async () => {
    const { volume, options } = fixture();
    const manifest = JSON.parse(volume.readFileSync(optional + "/package.json", "utf8").toString());
    delete manifest.devDependencies["@poe-code/safe-fs"];
    volume.writeFileSync(optional + "/package.json", JSON.stringify(manifest));
    await expect(buildOptionalPackage(options)).rejects.toThrow("Missing public peer:");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it("has deterministic output on a second materialization", async () => {
    const { volume, options } = fixture();
    const first = await buildOptionalPackage(options);
    const before = volume.toJSON(optional + "/dist/opt-in");
    expect(await buildOptionalPackage(options)).toEqual(first);
    expect(volume.toJSON(optional + "/dist/opt-in")).toEqual(before);
  });

  it("does not leave a source-map directive on an otherwise empty emitted module", async () => {
    const { volume, options } = fixture();
    volume.writeFileSync(core + "/dist/commands/yes/helper.js", "//# sourceMappingURL=helper.js.map\n");
    await buildOptionalPackage(options);
    expect(volume.readFileSync(optional + "/dist/opt-in/commands/yes/helper.js", "utf8")).not.toContain("sourceMappingURL");
  });

  it("requests exactly one fresh optional compilation through the maintained bridge", async () => {
    const { options } = fixture();
    const calls: unknown[] = [];
    const compile = options.compile;
    await buildOptionalPackage({ ...options, compile: async (request: unknown) => { calls.push(request); return compile(); } });
    expect(calls).toEqual([{ root: core, profile: "optional", fileSystem: options.fileSystem }]);
  });

  it.each(["inputHashes", "emittedHashes"])("rejects missing %s compilation binding", async key => {
    const { volume, options } = fixture();
    const compile = options.compile;
    await expect(buildOptionalPackage({ ...options, compile: async () => ({ ...await compile(), [key]: undefined }) })).rejects.toThrow("Missing compilation byte binding");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it.each(["src/optional.ts", "dist/commands/yes/helper.js", "package.json"])("rejects %s mutation after the compiler captured its bytes", async relative => {
    const { volume, options } = fixture();
    const compile = options.compile;
    await expect(buildOptionalPackage({ ...options, compile: async () => {
      const result = await compile();
      volume.appendFileSync(core + "/" + relative, "\n");
      return result;
    } })).rejects.toThrow("Input changed:");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it.each([undefined, null, false, 0, ""])("preserves exact compiler failure identity: %s", async failure => {
    const { volume, options } = fixture();
    let settled = false;
    await buildOptionalPackage({ ...options, compile: async () => { throw failure; } }).catch((error: unknown) => { settled = true; expect(error).toBe(failure); });
    expect(settled).toBe(true);
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it("copies source assets rather than un-emitted stale output assets", async () => {
    const { volume, options } = fixture();
    volume.writeFileSync(core + "/dist/commands/yes/payload.bin", Buffer.from([9]));
    await buildOptionalPackage(options);
    expect(volume.readFileSync(optional + "/dist/opt-in/commands/yes/payload.bin")).toEqual(Buffer.from([0, 255, 195, 169]));
  });

  it.each(["input", "output"])("rejects %s hard links without modifying the core", async kind => {
    const { volume, options } = fixture();
    const target = core + "/dist/index.js";
    const original = volume.readFileSync(target);
    if (kind === "input") {
      volume.unlinkSync(core + "/dist/commands/yes/helper.js");
      volume.linkSync(target, core + "/dist/commands/yes/helper.js");
    } else {
      volume.mkdirSync(optional + "/dist/opt-in", { recursive: true });
      volume.linkSync(target, optional + "/dist/opt-in/optional.js");
    }
    await expect(buildOptionalPackage(options)).rejects.toThrow("single-link");
    expect(volume.readFileSync(target)).toEqual(original);
  });

  it("refuses stale raw compilation objects without a fresh compiler call", async () => {
    const { options, compilation } = fixture();
    await expect(buildOptionalPackage({ rootDir: root, compilation, fileSystem: options.fileSystem })).rejects.toThrow("fresh maintained compiler callback");
  });

  it.each([undefined, false, 0, ""])("preserves a publication failure rather than reporting success: %s", async failure => {
    const { options } = fixture();
    options.fileSystem.writeFileSync = () => { throw failure; };
    let failed = false;
    await buildOptionalPackage(options).catch((error: unknown) => { failed = true; expect(error).toBe(failure); });
    expect(failed).toBe(true);
  });

  it("keeps the source-map-looking contents of ordinary strings", async () => {
    const { volume, options } = fixture();
    volume.writeFileSync(core + "/dist/commands/yes/helper.js", 'export const label = "//# sourceMappingURL=label.map";\n//# sourceMappingURL=helper.js.map\n');
    await buildOptionalPackage(options);
    const output = volume.readFileSync(optional + "/dist/opt-in/commands/yes/helper.js", "utf8").toString();
    expect(output).toContain('"//# sourceMappingURL=label.map"');
    expect(output).not.toContain("sourceMappingURL=helper.js.map");
  });

  it("maps every named boundary in the actual host source without copying the host or core modules", async () => {
    const { volume, options } = fixture();
    const runtime: string[] = [];
    const declarations: string[] = [];
    let runtimeNames = 0, typeNames = 0;
    for (const statement of hostDeclarations.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) throw new Error("Expected explicit named host re-exports");
      const names = statement.exportClause.elements.map(element => element.name.text);
      const specifier = "../../" + statement.moduleSpecifier.text.slice(2);
      declarations.push(`export type { ${names.join(", ")} } from ${JSON.stringify(specifier)};`);
      if (statement.isTypeOnly) typeNames += names.length;
      else { runtimeNames += names.length; runtime.push(`export { ${names.join(", ")} } from ${JSON.stringify(specifier)};`); }
    }
    expect([runtimeNames, typeNames]).toEqual([5, 20]);
    volume.writeFileSync(core + "/dist/commands/yes/helper.js", runtime.join("\n"));
    volume.writeFileSync(core + "/dist/commands/yes/index.d.ts", declarations.join("\n"));
    const result = await buildOptionalPackage(options);
    const runtimeOutput = volume.readFileSync(optional + "/dist/opt-in/commands/yes/helper.js", "utf8").toString();
    const typesOutput = volume.readFileSync(optional + "/dist/opt-in/commands/yes/index.d.ts", "utf8").toString();
    for (const name of ["codeOf", "pathOf", "output", "compareCopyIdentity", "compareObservedEntries"]) expect(runtimeOutput).toContain(name);
    expect(typesOutput).toContain("ShellIndexedWriter");
    expect(typesOutput).toContain("ReadLine");
    expect(runtimeOutput.split('from "@poe-platform/safe-bash/optional-host"').length - 1).toBe(2);
    expect(typesOutput.split('from "@poe-platform/safe-bash/optional-host"').length - 1).toBe(4);
    expect(result.files).not.toContain("optional-host.js");
    expect(result.files.some((filename: string) => filename.startsWith("contracts/") || filename.startsWith("shell/"))).toBe(false);
  });

  it.each(["../../commands/internal.js", "undeclared-private-peer", "@poe-platform/safe-bash/contracts/command"])("rejects unsupported external import-equals declarations for %s", async specifier => {
    const { volume, options } = fixture();
    volume.writeFileSync(core + "/dist/commands/yes/index.d.ts", `import Reference = require(${JSON.stringify(specifier)}); export type Value = typeof Reference;`);
    await expect(buildOptionalPackage(options)).rejects.toThrow("Unsupported external import-equals:");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it.each(["optional.js.map", "optional.d.ts.map"])("rejects explicit compiler-map asset %s before publication", async name => {
    const { volume, options } = fixture();
    volume.writeFileSync(core + "/dist/optional.js", `export const asset = new URL(${JSON.stringify("./" + name)}, import.meta.url);\n`);
    await expect(buildOptionalPackage(options)).rejects.toThrow("Compiler map assets are not published:");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });

  it.each(["terrain.map", "terrain.js.map"])("does not confuse source-owned %s data with an emitted compiler map", async name => {
    const { volume, options } = fixture();
    volume.writeFileSync(core + "/src/commands/yes/" + name, Buffer.from([0, 255]));
    volume.writeFileSync(core + "/dist/commands/yes/helper.js", `export const asset = new URL(${JSON.stringify("./" + name)}, import.meta.url);`);
    const result = await buildOptionalPackage(options);
    expect(result.files).toContain("commands/yes/" + name);
    expect(volume.readFileSync(optional + "/dist/opt-in/commands/yes/" + name)).toEqual(Buffer.from([0, 255]));
  });

  it("admits the actual private workspace while keeping emitted imports on public peers", async () => {
    const { volume, options } = fixture();
    volume.writeFileSync(core + "/dist/commands/yes/helper.js", 'export const load = () => import("yaml");');
    const before = volume.readFileSync(optional + "/package.json");
    const result = await buildOptionalPackage(options);
    expect(result.peerImports).toContain("@poe-platform/safe-bash");
    expect(result.peerImports).toContain("yaml");
    expect(volume.readFileSync(optional + "/package.json")).toEqual(before);
    expect(bashManifest.private).toBe(true);
    expect(volume.readFileSync(optional + "/dist/opt-in/optional.js", "utf8")).toContain('from "@poe-platform/safe-bash"');
  });

  it.each(["@poe-code/safe-fs"])("requires actual private checkout dependency %s without inventing public install dependencies", async dependency => {
    const { volume, options } = fixture();
    const manifest = structuredClone(bashManifest);
    delete manifest.devDependencies[dependency];
    manifest.peerDependencies = { "@poe-platform/safe-bash": "1.0.0", "@poe-platform/safe-fs": "1.0.0" };
    volume.writeFileSync(optional + "/package.json", JSON.stringify(manifest));
    await expect(buildOptionalPackage(options)).rejects.toThrow("Missing public peer:");
    expect(volume.existsSync(optional + "/dist/opt-in")).toBe(false);
  });
});
