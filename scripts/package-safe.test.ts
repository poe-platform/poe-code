import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";
import { build, type BuildOptions } from "esbuild";
import { packageSafeLibraries, parsePackageSafeArguments, rewriteModuleSpecifiers } from "./package-safe.mjs";

const bashManifest = JSON.parse(readFileSync(new URL("../packages/safe-bash/package.json", import.meta.url), "utf8"));

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
  const compilerOptions = { noEmit: true, strict: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
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

it("admits Shell byte argv through an isolated packed private command graph", async () => {
  const { volume, options } = optionalLeftovers();
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
      volume.writeFileSync(`/repo/packages/${name}/dist/${filename.slice(0, -3)}.js`, ts.transpileModule(source, { compilerOptions }).outputText);
      volume.writeFileSync(`/repo/packages/${name}/dist/${filename.slice(0, -3)}.d.ts`, ts.transpileDeclaration(source, { compilerOptions }).outputText);
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
  for (const target of ["index.js", "core.browser.js"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/${target}`, shell.outputFiles[0]!.contents);
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
    volume.writeFileSync(destination, ts.transpileDeclaration(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText);
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
  const plugin = { name: "isolated-packed-files", setup(builder: import("esbuild").PluginBuild) {
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
  const compilerOptions = { module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022, strict: true, noEmit: true, types: [], customConditions: ["browser"] };
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

it("packs qualified private command and contract modules into one canonical relative graph", async () => {
  const { volume, options } = optionalLeftovers();
  for (const [name, dependencies, devDependencies] of [
    ["safe-bash-contracts", {}, {}],
    ["safe-bash-command-wkhtmltopdf", {}, { "safe-bash-contracts": "*" }],
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
    "safe-bash-command-wkhtmltopdf": { version: "0.0.1", dependencies: {}, devDependencies: { "safe-bash-contracts": "*" } },
  };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'export { identity } from "safe-bash-contracts";');
  volume.writeFileSync("/repo/packages/safe-bash/dist/index.d.ts", 'export { identity } from "safe-bash-contracts";');
  volume.writeFileSync("/repo/packages/safe-bash/dist/commands/wkhtmltopdf/index.js", 'export * from "safe-bash-command-wkhtmltopdf";');
  volume.writeFileSync("/repo/packages/safe-bash/dist/commands/wkhtmltopdf/index.d.ts", 'export * from "safe-bash-command-wkhtmltopdf";');
  await packageSafeLibraries({ ...options, outDir: "/output" });
  const read = (path: string) => volume.readFileSync("/output/safe-bash/dist/" + path, "utf8");
  expect(read("safe-bash/index.js")).toContain('"../safe-bash-contracts/index.js"');
  expect(read("safe-bash/commands/wkhtmltopdf/index.js")).toContain('"../../../safe-bash-command-wkhtmltopdf/index.js"');
  expect(read("safe-bash-command-wkhtmltopdf/index.js")).toContain('"../safe-bash-contracts/index.js"');
  expect(read("safe-bash-command-wkhtmltopdf/index.d.ts")).toContain('"../safe-bash-contracts/index.js"');
  const shipped = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
  expect(shipped.dependencies).toEqual({});
  expect(shipped.exports["./commands/wkhtmltopdf"]).toEqual({
    types: "./dist/safe-bash/commands/wkhtmltopdf/index.d.ts", import: "./dist/safe-bash/commands/wkhtmltopdf/index.js",
  });
  volume.writeFileSync("/repo/packages/safe-bash-command-wkhtmltopdf/package.json", JSON.stringify({
    name: "safe-bash-command-wkhtmltopdf", private: false, type: "module", version: "0.0.1",
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
    });
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
  for (const name of ["op", "pandoc", "office-package"]) {
    volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
    volume.writeFileSync(`/repo/packages/${name}/package.json`, JSON.stringify({
      name: name === "op" ? "@poe-platform/op" : `@poe-code/${name}`, private: true,
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    }));
    volume.writeFileSync(`/repo/packages/${name}/dist/index.d.ts`, "export {};\n");
  }
  volume.writeFileSync("/repo/packages/office-package/dist/index.js", "export const codec = 1;\n");
  for (const name of ["op", "pandoc"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/${name}/index.js`,
    `export * from "${name === "op" ? "@poe-platform/op" : "@poe-code/pandoc"}";`);
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

it('ships tesseract command, SDK and strict declarations without its private workspace', async () => {
  const { volume, options } = optionalLeftovers();
  const name = 'safe-bash-command-tesseract';
  const manifest = structuredClone(bashManifest);
  manifest.poeCode.integration.privateWorkspaces = {
    [name]: { version: '0.0.1', dependencies: {}, devDependencies: { 'safe-bash-contracts': '*' } },
    'safe-bash-contracts': structuredClone(bashManifest.poeCode.integration.privateWorkspaces['safe-bash-contracts']),
  };
  const contractsRoot = new URL('../packages/safe-bash-contracts/', import.meta.url);
  volume.mkdirSync('/repo/packages/safe-bash-contracts/dist', { recursive: true });
  for (const filename of ['package.json', 'LICENSE']) volume.writeFileSync('/repo/packages/safe-bash-contracts/' + filename, readFileSync(new URL(filename, contractsRoot)));
  for (const filename of readdirSync(new URL('src/', contractsRoot))) {
    if (!filename.endsWith('.ts') || filename.endsWith('.test.ts')) continue;
    const source = readFileSync(new URL('src/' + filename, contractsRoot), 'utf8');
    const compilerOptions = { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 };
    volume.writeFileSync('/repo/packages/safe-bash-contracts/dist/' + filename.slice(0, -3) + '.js', ts.transpileModule(source, { compilerOptions }).outputText);
    volume.writeFileSync('/repo/packages/safe-bash-contracts/dist/' + filename.slice(0, -3) + '.d.ts', ts.transpileDeclaration(source, { compilerOptions }).outputText);
  }
  // Use the portable filesystem core with its maintained declarations.
  const fsRoot = new URL('../packages/safe-fs/', import.meta.url);
  const fsManifest = JSON.parse(volume.readFileSync('/repo/packages/safe-fs/package.json', 'utf8').toString());
  fsManifest.exports['./core'] = { types: './dist/core.d.ts', import: './dist/core.js' };
  volume.writeFileSync('/repo/packages/safe-fs/package.json', JSON.stringify(fsManifest));
  const fsBuild = await build({ entryPoints: [fileURLToPath(new URL('src/core.ts', fsRoot))], bundle: true,
    write: false, platform: 'browser', format: 'esm', target: 'es2022' });
  volume.writeFileSync('/repo/packages/safe-fs/dist/core.js', fsBuild.outputFiles[0]!.contents);
  volume.writeFileSync('/repo/packages/safe-fs/dist/core.d.ts', ['errors', 'filesystem', 'io'].map(name => `export * from './contracts/${name}.js';`).join('\n'));
  const queue = ['contracts/errors.ts', 'contracts/filesystem.ts', 'contracts/io.ts', 'platform/browser.ts', 'platform/node.ts'];
  const declared = new Set<string>();
  while (queue.length) {
    const relative = queue.pop()!;
    if (declared.has(relative)) continue;
    declared.add(relative);
    const source = readFileSync(new URL('src/' + relative, fsRoot), 'utf8');
    const destination = '/repo/packages/safe-fs/dist/' + relative.slice(0, -3) + '.d.ts';
    volume.mkdirSync(path.dirname(destination), { recursive: true });
    volume.writeFileSync(destination, ts.transpileDeclaration(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText);
    for (const entry of ts.preProcessFile(source).importedFiles) {
      if (!entry.fileName.startsWith('.')) continue;
      const filename = path.posix.normalize(path.posix.join(path.posix.dirname(relative), entry.fileName));
      queue.push(filename.endsWith('.js') ? filename.slice(0, -3) + '.ts' : filename + '.ts');
    }
  }
  volume.writeFileSync('/repo/packages/safe-bash/package.json', JSON.stringify(manifest));
  volume.mkdirSync(`/repo/packages/${name}/dist`, { recursive: true });
  for (const filename of ['package.json', 'LICENSE']) volume.writeFileSync(`/repo/packages/${name}/${filename}`, readFileSync(new URL(`../packages/${name}/${filename}`, import.meta.url)));
  for (const filename of readdirSync(new URL(`../packages/${name}/src`, import.meta.url))) {
    if (!filename.endsWith('.ts') || filename.endsWith('.test.ts')) continue;
    const source = readFileSync(new URL(`../packages/${name}/src/${filename}`, import.meta.url), 'utf8');
    const compilerOptions = { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 };
    volume.writeFileSync(`/repo/packages/${name}/dist/${filename.slice(0, -3)}.js`, ts.transpileModule(source, { compilerOptions }).outputText);
    volume.writeFileSync(`/repo/packages/${name}/dist/${filename.slice(0, -3)}.d.ts`, ts.transpileDeclaration(source, { compilerOptions }).outputText);
  }
  for (const suffix of ['js', 'd.ts']) volume.writeFileSync(`/repo/packages/safe-bash/dist/commands/tesseract/index.${suffix}`, `export * from '${name}';`);
  for (const suffix of ['js', 'd.ts']) volume.writeFileSync(`/repo/packages/safe-bash/dist/contracts/command.${suffix}`, "export * from 'safe-bash-contracts/command';");
  const plugin: import('esbuild').Plugin = { name: 'isolated-tesseract-artifact', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (builder.initialOptions.external?.some(name => args.path === name || args.path.startsWith(name + '/'))) return { path: args.path, external: true };
      let filename = args.path === '@poe-platform/safe-bash/commands/tesseract'
        ? '/output/safe-bash/' + JSON.parse(volume.readFileSync('/output/safe-bash/package.json', 'utf8').toString()).exports['./commands/tesseract'].import
        : path.resolve(args.resolveDir, args.path);
      if (args.path.startsWith('@poe-platform/')) {
        const [owner, ...route] = args.path.slice('@poe-platform/'.length).split('/');
        const pkg = JSON.parse(volume.readFileSync('/output/' + owner + '/package.json', 'utf8').toString());
        const key = route.length ? './' + route.join('/') : '.';
        const target = pkg.exports[key] ?? pkg.exports['./contracts/*'];
        filename = '/output/' + owner + '/' + (target.browser ?? target.import).replace('*', route.slice(1).join('/'));
      }
      if (!filename.startsWith('/output/') && !filename.startsWith(`/repo/packages/${name}/`)) throw new Error('outside isolated artifact: ' + filename);
      return { path: path.normalize(filename), namespace: 'artifact' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'artifact' }, args => ({ contents: volume.readFileSync(args.path, 'utf8').toString(), resolveDir: path.dirname(args.path) }));
  } };
  await packageSafeLibraries({ ...options, outDir: '/output', bundle: async (settings: BuildOptions) => settings.outdir === '/repo/packages' ? build({ ...settings, plugins: [plugin] }) : options.bundle(settings) });
  volume.rmSync('/repo', { recursive: true });
  expect(JSON.parse(volume.readFileSync('/output/safe-bash/package.json', 'utf8').toString()).dependencies).toEqual({ '@poe-platform/safe-fs': options.version });
  const consumer = await build({ stdin: { contents: `import {parseTesseractArguments, tesseractCapabilities, TesseractError, fillTesseractBinary, morphTesseractBinary, createTesseractBudget, renderTesseractTsv} from '@poe-platform/safe-bash/commands/tesseract'; export const parsed = parseTesseractArguments(['image', 'out', '--psm', 'raw_line']); export const recognition = tesseractCapabilities.recognition; export const tsv = (() => {const signal = new AbortController().signal; const budget = createTesseractBudget({inputBytes: 88, work: 1000, retainedBytes: 8192, outputBytes: 256}, signal); const result = renderTesseractTsv([{level: 1, page: 1, block: 0, paragraph: 0, line: 0, word: 0, left: 0, top: 0, width: 1, height: 1, confidence: -1, text: ''}], budget, signal); const text = new TextDecoder().decode(result.bytes); result.dispose(); budget.close(); return text;})(); export const filled = (() => {const signal = new AbortController().signal; const budget = createTesseractBudget({work: 14, retainedBytes: 5, pixels: 1, outputBytes: 1}, signal); const plane = {width: 1, height: 1, dpi: 300, format: 'binary8', pixels: new Uint8Array([1])}; const result = fillTesseractBinary(plane, plane, 4, {maxWidth: 1, maxHeight: 1, maxPixels: 1, maxWork: 1}, budget, signal); const pixel = result.raster.pixels[0]; result.dispose(); const morph = morphTesseractBinary(plane, 'erode', {width: 1, height: 1}, {maxWidth: 1, maxHeight: 1, maxPixels: 1, maxWork: 1}, budget, signal); const morphed = morph.raster.pixels[0]; morph.dispose(); budget.close(); return pixel + morphed;})(); export const denied = (() => {try {parseTesseractArguments(['https://invalid/image', 'out']);} catch (error) {return error instanceof TesseractError && error.code === 'unsupported';}})();`, resolveDir: '/output' }, bundle: true, write: false, format: 'cjs', platform: 'browser', plugins: [plugin] });
  const module = { exports: {} as { parsed: { psm: number }; recognition: boolean; denied: boolean; filled: number; tsv: string } };
  new Function('module', consumer.outputFiles[0]!.text)(module);
  expect(module.exports.parsed.psm).toBe(13);
  expect(module.exports.recognition).toBe(false);
  expect(module.exports.filled).toBe(2);
  expect(module.exports.tsv).toBe('level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t0\t0\t0\t0\t0\t0\t1\t1\t-1\t\n');
  expect(module.exports.denied).toBe(true);
  const commandConsumer = await build({ stdin: { contents: `
    import {createTesseractCommand, tesseract} from '@poe-platform/safe-bash/commands/tesseract';
    import {commandRuntimeIdentity, createCommandArguments} from '@poe-platform/safe-bash/contracts/command';
    export const verification = (async () => {
      const carrier = createCommandArguments(['--help']);
      const output = []; const cleanups = [];
      const context = {args: carrier.args, argumentValues: carrier, signal: new AbortController().signal,
        registerCleanup(callback) {cleanups.push(callback);},
        stdout: {async write(bytes) {output.push(new TextDecoder().decode(bytes));}},
        stderr: {async write() {throw Error('Unexpected help diagnostic');}}};
      const command = createTesseractCommand();
      if (command.runtimeIdentity !== commandRuntimeIdentity) throw Error('Duplicate command contracts');
      const result = await command.execute(context);
      const sdk = await tesseract(context, {action: 'version'});
      await Promise.all(cleanups.map(callback => callback()));
      if (result.exitCode !== 0 || sdk.exitCode !== 0 || !output[0].startsWith('Usage: tesseract')) throw Error('Packed command failed');
    })();`, resolveDir: '/output' }, bundle: true, write: false, format: 'cjs', platform: 'browser', plugins: [plugin] });
  const commandModule = { exports: {} as { verification: Promise<void> } };
  new Function('module', commandConsumer.outputFiles[0]!.text)(commandModule);
  await commandModule.exports.verification;
  volume.mkdirSync('/output/node_modules/@poe-platform', { recursive: true });
  volume.symlinkSync('/output/safe-bash', '/output/node_modules/@poe-platform/safe-bash');
  volume.symlinkSync('/output/safe-fs', '/output/node_modules/@poe-platform/safe-fs');
  volume.writeFileSync('/output/tesseract-consumer.mts', `import {parseTesseractArguments, inspectTraineddata, fillTesseractBinary, morphTesseractBinary, renderTesseractTsv, type TesseractTsvRow, type TesseractRecognitionRequest} from '@poe-platform/safe-bash/commands/tesseract'; const psm: number = parseTesseractArguments(['image', 'out']).psm; const qualified: false = inspectTraineddata(new Uint8Array(), {maxModelBytes: 10, maxComponents: 24}, new AbortController().signal).recognitionQualified; declare const request: TesseractRecognitionRequest; const input: AsyncIterable<Uint8Array> = request.input; const fill: typeof fillTesseractBinary = fillTesseractBinary; const morph: typeof morphTesseractBinary = morphTesseractBinary; declare const row: TesseractTsvRow; const render: typeof renderTesseractTsv = renderTesseractTsv; void row; void render; void morph; void fill; void psm; void qualified; void input;`);
  const compilerOptions = { module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022, strict: true, noEmit: true, types: [] };
  const host = ts.createCompilerHost(compilerOptions);
  const toolRoot = path.dirname(ts.getDefaultLibFilePath(compilerOptions));
  host.fileExists = filename => volume.existsSync(filename) || filename.startsWith(toolRoot + path.sep) && ts.sys.fileExists(filename);
  host.directoryExists = filename => volume.existsSync(filename) || filename.startsWith(toolRoot) && ts.sys.directoryExists(filename);
  host.readFile = filename => volume.existsSync(filename) ? volume.readFileSync(filename, 'utf8').toString() : filename.startsWith(toolRoot + path.sep) ? ts.sys.readFile(filename) : undefined;
  host.realpath = filename => volume.existsSync(filename) ? volume.realpathSync(filename).toString() : filename;
  host.getSourceFile = (filename, version) => { const source = host.readFile(filename); return source === undefined ? undefined : ts.createSourceFile(filename, source, version); };
  volume.appendFileSync('/output/tesseract-consumer.mts', `\nimport {tesseract, createTesseractCommand, tesseractCommands, type TesseractResult} from '@poe-platform/safe-bash/commands/tesseract'; import type {CommandContext} from '@poe-platform/safe-bash/contracts/command'; declare const context: CommandContext; const run: Promise<TesseractResult> = tesseract(context, {input: '-literal', outputbase: '-', psm: 7, variables: [{name: 'value', value: 'a=b'}]}); const command = createTesseractCommand(); const plugin = tesseractCommands(); void run; void command; void plugin;`);
  expect(ts.getPreEmitDiagnostics(ts.createProgram(['/output/tesseract-consumer.mts'], compilerOptions, host)).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
});
