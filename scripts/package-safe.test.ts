import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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
    [name]: { version: "0.0.1", dependencies: {}, devDependencies: { "safe-bash-contracts": "*", "@poe-code/safe-fs": "*" } },
  };
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify(manifest));
  const commandManifest = JSON.parse(readFileSync(new URL("../packages/safe-bash-command-exiftool/package.json", import.meta.url), "utf8"));
  volume.mkdirSync("/repo/packages/" + name + "/dist", { recursive: true });
  volume.writeFileSync("/repo/packages/" + name + "/package.json", JSON.stringify(commandManifest));
  volume.writeFileSync("/repo/packages/" + name + "/LICENSE", "Original first-party implementation\n");
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
  expect(shipped.exports["./commands/exiftool"]).toEqual({ types: "./dist/safe-bash/commands/exiftool/index.d.ts", import: "./dist/safe-bash/commands/exiftool/index.js" });
  expect(read("dist/safe-bash/commands/exiftool/index.js")).toContain('"../../../safe-bash-command-exiftool/index.js"');
  expect(read("dist/safe-bash/commands/exiftool/index.d.ts")).toContain('"../../../safe-bash-command-exiftool/index.js"');
  const consumer = await import("data:text/javascript;base64," + Buffer.from(read("dist/safe-bash-command-exiftool/scalar.js")).toString("base64"));
  expect(consumer.encodeJsonScalar("1e999")).toBe("1e999");
  expect(consumer.encodeJsonScalar("a\0b\x7f")).toBe('"ab\\u007F"');
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
