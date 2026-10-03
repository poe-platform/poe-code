import { relative, sep } from "node:path";
import { expect, it } from "vitest";
import { resolvePrivateCommandBuild, resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { scanPortableRuntime } from "../packages/package-lint/src/portable-runtime.js";
import { memLintFs, pkgJson } from "../packages/package-lint/src/fixtures.js";

it("keeps OpenSSL certificate dependencies inside its published portable bundle", async () => {
  const root = process.cwd();
  const name = "safe-bash-command-openssl";
  const pkg = JSON.parse(readFileSync(path.join(root, "packages", name, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(path.join(root, "packages/safe-bash/package.json"), "utf8"));
  const recipe = resolvePrivateCommandBuild(root,
    { [name]: manifest.poeCode.integration.privateWorkspaces[name] }, [{ dir: name, pkg }],
    { alias: {}, external: ["safe-bash-contracts", "@poe-code/safe-fs", ...Object.keys(pkg.dependencies)], portable: true });
  const result = await build({ ...recipe, metafile: true, sourcemap: false });
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports)
    .filter(entry => entry.external).map(entry => entry.path);
  expect(imports).not.toContain("@peculiar/x509");
  expect(imports).not.toContain("reflect-metadata/lite");
  expect(imports).toContain("safe-bash-contracts");
  expect(imports.every(specifier => specifier === "safe-bash-contracts" ||
    specifier.startsWith("safe-bash-contracts/") || specifier.startsWith("@poe-code/safe-fs/"))).toBe(true);
});

it.each([false, true])("keeps certificate encoding independent of ambient Buffer (minify=%s)", async minify => {
  const root = process.cwd();
  const name = "safe-bash-command-openssl";
  const pkg = JSON.parse(readFileSync(path.join(root, "packages", name, "package.json"), "utf8"));
  const profile = { version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies, portable: true };
  const options = resolvePrivateCommandBuild(root, { [name]: profile }, [{ dir: name, pkg }], { alias: {}, external: [], portable: true });
  const result = await build({ ...options, entryPoints: undefined, outdir: undefined, outfile: "/memory/certificates.js",
    splitting: false, sourcemap: false, format: "iife", minify,
    stdin: { resolveDir: root, contents: `
      import "reflect-metadata/lite";
      import { X509Certificate, X509CertificateGenerator } from "@peculiar/x509";
      globalThis.pending = (async () => {
        const keys = await crypto.subtle.generateKey({name: "ECDSA", namedCurve: "P-256"}, true, ["sign", "verify"]);
        const cert = await X509CertificateGenerator.createSelfSigned({name: "CN=portable.test", keys,
          signingAlgorithm: {name: "ECDSA", hash: "SHA-256"}}, crypto);
        const parsed = new X509Certificate(cert.toString("pem"));
        return parsed.subject === "CN=portable.test" && await parsed.verify({publicKey: keys.publicKey}, crypto);
      })();` },
  });
  const code = result.outputFiles[0]!.text;
  const files = memLintFs({
    "/repo/package.json": pkgJson({name: "root", private: true}),
    "/repo/packages/safe-bash-command-openssl/package.json": pkgJson({name, exports: {".": "./dist/index.js"}}),
    "/repo/packages/safe-bash-command-openssl/dist/index.js": code,
  });
  expect(await scanPortableRuntime(files, "/repo")).toEqual([]);
  const realm = { crypto: webcrypto, TextEncoder, TextDecoder, atob, btoa, Uint8Array, ArrayBuffer, DataView,
    pending: undefined as Promise<boolean> | undefined };
  Object.defineProperty(realm, "Buffer", { get() { throw new Error("Ambient Buffer must not be read"); } });
  runInNewContext(code, realm);
  expect(await realm.pending).toBe(true);
  expect(Object.hasOwn(realm, "process")).toBe(false);
});

it("admits every private workspace into the portable build", () => {
  const root = process.cwd();
  const manifest = JSON.parse(readFileSync(path.join(root, "packages/safe-bash/package.json"), "utf8"));
  const profiles = manifest.poeCode.integration.privateWorkspaces;
  const workspaces = Object.keys(profiles).map(name => {
    const dir = name.split("/").at(-1)!;
    return { dir, pkg: JSON.parse(readFileSync(path.join(root, "packages", dir, "package.json"), "utf8")) };
  });
  const recipe = resolvePrivateCommandBuild(root, profiles, workspaces, { alias: {}, external: [], portable: true });
  for (const { dir, pkg } of workspaces) {
    expect(profiles[pkg.name].portable, pkg.name).toBe(true);
    for (const [route, target] of Object.entries(pkg.exports) as [string, Record<string, string | null>][]) {
      if (Object.hasOwn(profiles[pkg.name].optionalModules ?? {}, route)) continue;
      const runtime = Object.entries(target).find(([condition]) => ["workerd", "worker", "browser", "import", "default"].includes(condition))?.[1];
      if (runtime === null) continue;
      expect(runtime, pkg.name + route).toBeTypeOf("string");
      expect(recipe.entryPoints, pkg.name + route).toHaveProperty(dir + "/" + runtime!.slice(2, -3));
    }
  }
  expect(recipe.conditions).toEqual(["workerd", "worker", "browser"]);
  expect(recipe.platform).toBe("browser");
});

it("preserves the portable export surface when canonical owners remain external", async () => {
  const root = process.cwd();
  const manifest = JSON.parse(readFileSync(path.join(root, "packages/safe-bash/package.json"), "utf8"));
  const names = await Promise.all([[], Object.keys(manifest.poeCode.integration.privateWorkspaces)].map(async external => {
    const options = resolveBrowserShellBuild(root, { external });
    const result = await build({ ...options, sourcemap: false, minifyWhitespace: true });
    const publicOutputs = new Set(Object.keys(options.entryPoints).map(name =>
      path.relative(root, path.join(options.outdir, name + ".js"))));
    const surface = Object.fromEntries(Object.entries(result.metafile!.outputs)
      .filter(([filename]) => publicOutputs.has(filename))
      .map(([filename, output]) => [filename, output.exports]));
    const commandExports = Object.keys(manifest.poeCode.integration.privateWorkspaces)
      // Playwright and structural search expose explicit opt-in subpaths outside core.
      .filter(name => name.startsWith("safe-bash-command-") && !["safe-bash-command-playwright-cli", "safe-bash-command-ast-grep"].includes(name))
      .flatMap(name => {
        // Python exposes both python/python3 through its plural factory.
        if (name === "safe-bash-command-python") return ["pythonCommands", "createPythonCommands", "pythonExecutorCommands", "createPythonExecutorCommands"];
        if (name === "safe-bash-command-safejs") return ["safeJsCommands", "createSafeJsCommands"];
        const title = name.slice("safe-bash-command-".length).split("-")
          .map(word => word[0]!.toUpperCase() + word.slice(1)).join("");
        return [title[0]!.toLowerCase() + title.slice(1) + "Commands", `create${title}Command`, `create${title}Commands`];
      });
    expect(surface["packages/safe-bash/dist/core.browser.js"]).toEqual(expect.arrayContaining(commandExports));
    for (const entry of ["ast-grep.browser.js", "commands/ast-grep/index.browser.js"]) {
      expect(surface["packages/safe-bash/dist/" + entry]).toEqual(expect.arrayContaining(["astGrepCommands", "createAstGrepCommand", "createAstGrepCommands"]));
    }
    if (external.length) {
      const outputs = new Map(result.outputFiles.map(file => [file.path, file.text]));
      const entry = path.join(options.outdir, "commands/csplit/index.browser.js");
      const consumer = await build({
        stdin: { contents: `import * as api from ${JSON.stringify(entry)}; import { createCsplitCommand as canonical } from "safe-bash-command-csplit"; export { api, canonical };` },
        bundle: true, write: false, platform: "browser", format: "cjs",
        alias: { "poe-code/safe-fs/core": path.join(root, "packages/safe-fs/src/core.ts") },
        plugins: [{ name: "packed-csplit-identity", setup(builder) {
          builder.onResolve({ filter: /.*/ }, args => {
            if (args.path === "safe-bash-command-csplit") return { path: args.path, namespace: "owner" };
            const filename = path.resolve(path.dirname(args.importer), args.path);
            return outputs.has(filename) ? { path: filename, namespace: "artifact" } : undefined;
          });
          builder.onLoad({ filter: /.*/, namespace: "artifact" }, args => ({ contents: outputs.get(args.path)!, loader: "js" }));
          builder.onLoad({ filter: /.*/, namespace: "owner" }, () => ({ contents: "export function createCsplitCommand() { return {name: 'csplit'}; } export const createCsplitCommands = () => [createCsplitCommand()]; export const csplitCommands = () => ({}); export const evalSyncCsplit = () => '';", loader: "js" }));
        } }],
      });
      const module = { exports: {} as { api: { createCsplitCommand(): { name: string } }; canonical: unknown } };
      runInNewContext(consumer.outputFiles[0]!.text, { module, TextEncoder, TextDecoder, Uint8Array });
      expect(module.exports.api.createCsplitCommand).toBe(module.exports.canonical);
      expect(module.exports.api.createCsplitCommand().name).toBe("csplit");
    }
    return surface;
  }));
  expect(names[1]).toEqual(names[0]);
}, 120_000);

it("keeps root conditional runtimes unresolved until browser or workerd consumption", async () => {
  const options = resolveBrowserShellBuild(process.cwd(), {
    imports: { "#git-wasm": {
      workerd: "./packages/safe-bash-command-git/dist/runtime.workerd.js",
      default: "./packages/safe-bash-command-git/dist/runtime.js"
    } }
  });
  const result = await build({ ...options, entryPoints: undefined, outdir: undefined,
    outfile: "/memory/consumer.js", splitting: false, inject: [],
    stdin: { contents: 'export { gitModule } from "#git-wasm";',
      resolveDir: path.join(process.cwd(), "packages/safe-bash-command-git") }
  });
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports))
    .toEqual([{ path: "#git-wasm", kind: "import-statement", external: true }]);
  expect(Object.keys(result.metafile!.inputs)).toEqual(["<stdin>"]);
});

it.each([false, true])("keeps copied private runtime assets inside a publishable workspace (portable=%s)", async portable => {
  const name = "safe-bash-command-example";
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {}, portable };
  const pkg = { name, version: profile.version, dependencies: {}, devDependencies: {}, private: true, type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } };
  const options = resolvePrivateCommandBuild("/repo", { [name]: profile }, [{ dir: name, pkg }], { alias: {}, external: [], portable });
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const result = await build({ ...options, metafile: true, plugins: [{ name: "fixture", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => args.path.endsWith(".wasm")
      ? { contents: bytes, loader: "copy" }
      : { contents: args.path.endsWith("buffer.mjs") ? "" : 'import binary from "./engine.wasm"; export { binary };', loader: "js" });
  } }] });
  const asset = result.outputFiles!.find(file => file.path.endsWith(".wasm"))!;
  expect(asset.contents).toEqual(bytes);
  const relative = path.posix.relative("/repo/packages", asset.path).split("/");
  expect(["safe-bash", name]).toContain(relative[0]);
  expect(relative[1]).toBe("dist");
  const entry = result.outputFiles!.find(file => file.path.endsWith("/dist/index.js"))!;
  expect(entry.text).toContain(path.posix.relative(path.posix.dirname(entry.path), asset.path));
});

it.each(["browser", "workerd", "require"])("rejects an unprepared private command %s export", condition => {
  const name = "safe-bash-command-example";
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {} };
  const pkg = {
    name, ...profile, private: true, type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js", [condition]: "./dist/alternate.js" } },
  };
  expect(() => resolvePrivateCommandBuild("/repo", { [name]: profile }, [{ dir: name, pkg }], { alias: {}, external: [] }))
    .toThrow("Unsupported private command export condition");
});

it("runs portable Lua filters without Node globals or builtins", async () => {
  const { define, plugins } = resolveBrowserShellBuild(process.cwd());
  const result = await build({
    stdin: { contents: `import {createLuaFilterCapability} from "./packages/safe-bash-command-pandoc/src/lua-filters.ts";
      const filter = createLuaFilterCapability(async () => new TextEncoder().encode('function Str(el) el.text = string.upper(el.text); return el end'));
      globalThis.pending = filter.apply({metadata: {}, resources: [], blocks: [{t:"Para",c:[{t:"Str",c:"portable"}]}]}, {kind:"lua",path:"upper.lua"}, {to:"plain", checkpoint(){}, charge(){}, bound(){}, async cooperate(){}}).then(document => {globalThis.result = document.blocks[0].c[0].c;});`, resolveDir: process.cwd() },
    bundle: true, platform: "browser", format: "iife", write: false, define, plugins, external: ["fengari"],
  });
  const context = { TextEncoder, TextDecoder, Uint8Array, result: undefined, pending: undefined };
  runInNewContext(result.outputFiles[0]!.text, context, { contextCodeGeneration: { strings: false, wasm: false } });
  await context.pending;
  expect(context.result).toBe("PORTABLE");
});

it("initializes command factories also referenced by a lazy workspace import", async () => {
  const result = await build({
    stdin: { contents: `import {createSsconvertCommand} from "./packages/safe-bash/src/commands/ssconvert/index.ts";
      globalThis.command = createSsconvertCommand();
      globalThis.load = () => import("./packages/safe-bash-command-ssconvert/src/index.ts");`, resolveDir: process.cwd() },
    bundle: true, platform: "node", format: "esm", write: false, packages: "external", alias: {"safe-bash-command-ssconvert": process.cwd() + "/packages/safe-bash-command-ssconvert/src/index.ts"},
  });
  expect(result.outputFiles[0]!.text.split("globalThis.command =")[0]).toMatch(/init_(?:src|index)\w*\(\);/);
});

it("preserves spreadsheet SDK exports through its split workspace prebundle", async () => {
  const surfaces = await Promise.all(["src/index.ts", "dist/index.js"].map(async entry => {
    const result = await build({
      entryPoints: [path.join(process.cwd(), "packages/safe-bash-command-ssconvert", entry)],
      bundle: true, write: false, platform: "browser", format: "esm", metafile: true,
      external: ["@poe-code/safe-fs", "safe-bash-contracts"],
    });
    return Object.values(result.metafile!.outputs).find(output => output.entryPoint)!.exports;
  }));
  expect(surfaces[0]).toEqual(expect.arrayContaining(["chartDataTypes", "createFormattingCapability", "sheetObjects", "sylkGrammar"]));
  expect(surfaces[1]).toEqual(surfaces[0]);
  const consumer = await build({
    stdin: { contents: `import { SsconvertError, createFormattingCapability } from "./packages/safe-bash-command-ssconvert/dist/index.js";
      import { SsconvertError as canonicalError } from "@poe-code/spreadsheet-ast/errors";
      import { createFormattingCapability as canonicalFormatting } from "@poe-code/spreadsheet-engine/formatting";
      export { SsconvertError, canonicalError, createFormattingCapability, canonicalFormatting };`, resolveDir: process.cwd() },
    bundle: true, write: false, platform: "browser", format: "cjs",
  });
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(consumer.outputFiles[0]!.text, { module, TextEncoder, TextDecoder, AbortController, AbortSignal, atob });
  expect(module.exports.SsconvertError).toBe(module.exports.canonicalError);
  expect(module.exports.createFormattingCapability).toBe(module.exports.canonicalFormatting);
});

it("keeps copied WASM assets inside a package dist directory", async () => {
  const name = "safe-bash-command-example";
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {} };
  const pkg = {
    name, ...profile, private: true, type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  };
  const recipe = resolvePrivateCommandBuild("/repo", { [name]: profile }, [{ dir: name, pkg }], { alias: {}, external: [] });
  const result = await build({ ...recipe, plugins: [{
    name: "memory-wasm-fixture",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => args.path.endsWith(".wasm")
        ? { contents: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0), loader: "copy" }
        : { contents: 'import binary from "./module.wasm"; export { binary };', loader: "js" });
    },
  }] });
  const asset = result.outputFiles.find(file => file.path.endsWith(".wasm"));
  expect(asset).toBeDefined();
  expect(relative("/repo", asset!.path).split(sep).slice(0, 3)).toEqual(["packages", "safe-bash", "dist"]);
});

it("keeps workspace subpath imports external in portable private command builds", () => {
  const name = "safe-bash-command-git";
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {}, portable: true };
  const pkg = {
    name, version: "0.0.1", dependencies: {}, devDependencies: {}, private: true, type: "module",
    imports: { "#git-wasm": { types: "./src/runtime.ts", workerd: "./dist/runtime.workerd.js", default: "./dist/runtime.js" } },
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  };
  const recipe = resolvePrivateCommandBuild("/repo", { [name]: profile }, [{ dir: name, pkg }], { alias: {}, external: ["@poe-platform/safe-fs"], portable: true });
  expect(recipe?.external).toEqual(["@poe-platform/safe-fs", "#git-wasm"]);
});

it.each([false, true])("preserves private conditional imports for consumers (portable=%s)", async portable => {
  const name = "safe-bash-command-example";
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {}, portable };
  const pkg = {
    name, ...profile, private: true, type: "module",
    imports: { "#command-runtime-regression": { workerd: "./dist/worker.js", default: "./dist/node.js" } },
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  };
  const recipe = resolvePrivateCommandBuild(process.cwd(), { [name]: profile }, [{ dir: name, pkg }], { alias: {}, external: [], portable });
  const result = await build({
    ...recipe, entryPoints: undefined, outdir: undefined, outfile: "/memory/command.js",
    splitting: false, inject: [],
    stdin: { contents: 'export { runtime } from "#command-runtime-regression";', resolveDir: process.cwd() },
  });
  expect(result.outputFiles.find(file => file.path.endsWith(".js"))!.text).toContain('from "#command-runtime-regression"');
});

it("retains the host environment warning in portable runtimes with Node compatibility", async () => {
  const options = resolveBrowserShellBuild(import.meta.dirname + "/..");
  const result = await build({ ...options, entryPoints: undefined, inject: [],
    stdin: { contents: 'import { warnIfHostProcessEnv } from "./packages/safe-bash/src/shell/env-warning.ts"; export { warnIfHostProcessEnv };', resolveDir: import.meta.dirname + "/.." },
    splitting: false, format: "cjs", sourcemap: false
  });
  const module = { exports: {} as { warnIfHostProcessEnv(env: Record<string, string>): void } };
  const env = { TOKEN: "synthetic" };
  const warnings: string[] = [];
  runInNewContext(result.outputFiles![0]!.text, { module, process: { env }, console: { warn: (message: string) => warnings.push(message) } });
  module.exports.warnIfHostProcessEnv(env);
  module.exports.warnIfHostProcessEnv(env);
  module.exports.warnIfHostProcessEnv({ ...env });
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("secret bindings");
});


it("keeps portable private Git factories importable outside Workers", async () => {
  const name = "safe-bash-command-git";
  const { default: pkg } = await import("../packages/safe-bash-command-git/package.json", { with: { type: "json" } });
  const profile = { version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies, portable: true };
  const options = resolvePrivateCommandBuild(import.meta.dirname + "/..", { [name]: profile }, [{ dir: name, pkg }], { alias: {}, external: ["safe-bash-contracts", "@poe-code/safe-fs/core"], portable: true });
  const result = await build({ ...options, metafile: true });
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect(imports.filter(entry => entry.path.endsWith(".wasm"))).toEqual([]);
});


it("keeps Node prebundling out of portable image command artifacts", async () => {
  const name = "safe-bash-command-sips";
  const { default: pkg } = await import("../packages/safe-bash-command-sips/package.json", { with: { type: "json" } });
  const profile = { version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies, portable: true };
  const options = resolvePrivateCommandBuild(import.meta.dirname + "/..", { [name]: profile }, [{ dir: name, pkg }], { alias: {}, external: ["safe-bash-contracts", "@poe-code/safe-fs/core", "node:*"], portable: true });
  const result = await build({ ...options, metafile: true });
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect(imports.filter(entry => entry.path.startsWith("node:"))).toEqual([]);
});

// A root re-export must not retain asynchronous command engines when unused.
it.each([
  ["cmp", "createCmpCommand", "buildCmpCommand"],
  ["truncate", "createTruncateCommand", "createDefinition"],
])("tree-shakes the unselected %s factory after ESM packaging", async (command, factory, implementation) => {
  const packed = await build({
    entryPoints: [`packages/safe-bash-command-${command}/src/index.ts`],
    bundle: true, format: "esm", platform: "browser", packages: "external", write: false,
  });
  for (const selected of [false, true]) {
    const consumer = await build({
      stdin: { contents: selected ? `export { ${factory} } from "packed-command";` : 'import "packed-command"; export const marker = true;' },
      bundle: true, format: "esm", platform: "browser", packages: "external", write: false,
      plugins: [{ name: "packed-command", setup(builder) {
        builder.onResolve({ filter: /^packed-command$/ }, () => ({ path: "command", namespace: "packed" }));
        builder.onResolve({ filter: /.*/, namespace: "packed" }, args => ({ path: args.path, external: true }));
        builder.onLoad({ filter: /.*/, namespace: "packed" }, () => ({ contents: packed.outputFiles[0]!.text }));
      } }],
    });
    expect(consumer.outputFiles[0]!.text.includes(`function ${implementation}(`)).toBe(selected);
  }
});

it("shares the canonical filesystem for internal runtime-core imports", async () => {
  const options = resolveBrowserShellBuild(process.cwd());
  const result = await build({ ...options, entryPoints: undefined, outdir: undefined,
    outfile: "/memory/runtime-core.js", splitting: false, inject: [], sourcemap: false,
    stdin: { contents: 'export { MemoryFileSystem as internal } from "@poe-code/safe-fs/runtime-core"; export { MemoryFileSystem as publicCore } from "@poe-code/safe-fs/core";', resolveDir: process.cwd() }
  });
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect(imports.every(item => item.external)).toBe(true);
  expect([...new Set(imports.map(item => item.path))]).toEqual(["poe-code/safe-fs/core"]);
  expect(Object.keys(result.metafile!.inputs)).toEqual(["<stdin>"]);
});

it("accepts identical browser and workerd targets for a qualified portable command", () => {
  const name = "safe-bash-command-example";
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {}, portable: true };
  const pkg = { name, ...profile, private: true, type: "module",
    exports: { ".": { types: "./dist/index.d.ts", workerd: "./dist/index.js", browser: "./dist/index.js", import: "./dist/index.js" } } };
  expect(resolvePrivateCommandBuild("/repo", { [name]: profile }, [{ dir: name, pkg }],
    { alias: {}, external: [], portable: true })?.platform).toBe("browser");
});

it("prepares portable conditional entries without falling through blocked host exports", () => {
  const name = "safe-bash-command-example";
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {}, portable: true };
  const pkg = { name, ...profile, private: true, type: "module", exports: {
    ".": { types: { browser: "./dist/index.browser.d.ts", default: "./dist/index.d.ts" },
      browser: "./dist/index.browser.js", import: "./dist/index.js" },
    "./server": { types: "./dist/server.d.ts", browser: null, node: "./dist/server.js", default: null },
    "./shared": { types: "./dist/shared.d.ts", default: "./dist/shared.js" },
  } };
  const recipe = resolvePrivateCommandBuild("/repo", { [name]: profile }, [{ dir: name, pkg }],
    { alias: {}, external: [], portable: true });
  expect(recipe.entryPoints).toEqual({
    [name + "/dist/index.browser"]: "/repo/packages/" + name + "/src/index.browser.ts",
    [name + "/dist/shared"]: "/repo/packages/" + name + "/src/shared.ts",
  });
});
