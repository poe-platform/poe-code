import { relative, sep } from "node:path";
import { expect, it } from "vitest";
import { resolvePrivateCommandBuild, resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import path from "node:path";

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
      globalThis.pending = filter.apply({"pandoc-api-version": [1,23,1], meta: {}, blocks: [{t:"Para",c:[{t:"Str",c:"portable"}]}]}, {kind:"lua",path:"upper.lua"}, {to:"plain", checkpoint(){}, charge(){}, bound(){}, async cooperate(){}}).then(document => {globalThis.result = document.blocks[0].c[0].c;});`, resolveDir: process.cwd() },
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
