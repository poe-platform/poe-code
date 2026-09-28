import { relative, sep } from "node:path";
import { expect, it } from "vitest";
import { resolvePrivateCommandBuild, resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

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
