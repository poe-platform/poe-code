import { expect, it } from "vitest";
import { build } from "esbuild";
import { resolvePrivateCommandBuild } from "./bundle-safe-bash.mjs";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";

it.each(["shell-entry.ts", "core.browser.ts"])("provides a shell and composable registry without optional command engines through %s", async entry => {
  const root = process.cwd();
  const options = resolveBrowserShellBuild(root);
  const result = await build({ ...options, entryPoints: undefined, outdir: undefined, splitting: false,
    outfile: "/memory/shell.js", sourcemap: false,
    stdin: { contents: `export { Shell, CommandRegistry, createCommandArguments } from "./packages/safe-bash/src/${entry}";`, resolveDir: root },
  });
  const inputs = Object.values(result.metafile!.outputs).flatMap(output => Object.entries(output.inputs)
    .filter(([, input]) => input.bytesInOutput > 0).map(([filename]) => filename));
  const forbidden = ["pdf-ast", "spreadsheet", "ssconvert", "ffmpeg", "git-rust", "wasm.generated", "/commands/python/", "/commands/llm/"];
  expect(inputs.filter(input => forbidden.some(name => input.includes(name)))).toEqual([]);
  expect(result.outputFiles[0]!.text).toContain("class");
});

it("bundles private commands from their module graph so selected commands share an engine", async () => {
  const names = ["safe-bash-command-first", "safe-bash-command-second"];
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {} };
  const recipe = resolvePrivateCommandBuild("/repo", Object.fromEntries(names.map(name => [name, profile])), names.map(name => ({
    dir: name, pkg: { name, ...profile, private: true, type: "module", exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    } },
  })), { alias: {}, external: [] });
  const result = await build({ ...recipe, sourcemap: false, metafile: true, plugins: [{
    name: "memory-command-graph",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => ({ path: args.path, namespace: "memory" }));
      builder.onLoad({ filter: /.*/, namespace: "memory" }, args => ({
        // Model the independently bundled workspace outputs: the same engine
        // has lost its original module identity in each dist entry.
        contents: args.path === "engine" ? 'export const engine = () => "shared-engine-sentinel";'
          : args.path.includes("/src/") ? 'export { engine } from "engine";'
          : 'export const engine = () => "shared-engine-sentinel";',
        loader: "js",
      }));
    },
  }] });
  const outputs = result.outputFiles.map(file => file.text).join("\n");
  expect(outputs.split("shared-engine-sentinel").length - 1).toBe(1);
  expect(Object.keys(result.metafile!.inputs)).toContain("memory:engine");
});

it("retains explicitly prebuilt entrypoints for workspaces that transform their runtime", () => {
  const name = "safe-bash-command-transformed";
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {} };
  const recipe = resolvePrivateCommandBuild("/repo", { [name]: profile }, [{ dir: name, pkg: {
    name, ...profile, private: true, type: "module", poeCode: { bundle: { prebuilt: true } },
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  } }], { alias: {}, external: [] });
  expect(recipe!.entryPoints[name + "/dist/index"]).toBe("/repo/packages/" + name + "/dist/index.js");
});

it("admits a scoped portable engine as the canonical public owner", () => {
  const name = "@poe-code/example-engine";
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {}, portable: true };
  const recipe = resolvePrivateCommandBuild("/repo", { [name]: profile }, [{ dir: "example-engine", pkg: {
    name, ...profile, private: true, type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  } }], { alias: {}, external: [name], portable: true });
  expect(recipe!.entryPoints["example-engine/dist/index"]).toBe("/repo/packages/example-engine/src/index.ts");
});

it("shares the published filesystem core for runtime-core imports", async () => {
  const root = process.cwd();
  const recipe = resolveBrowserShellBuild(root);
  const result = await build({ ...recipe, entryPoints: undefined, outdir: undefined, splitting: false,
    outfile: "/memory/core.js", sourcemap: false,
    stdin: { contents: 'export { MemoryFileSystem } from "@poe-code/safe-fs/runtime-core";', resolveDir: root }
  });
  expect(result.metafile!.outputs[Object.keys(result.metafile!.outputs)[0]!]!.imports)
    .toContainEqual(expect.objectContaining({ path: "poe-code/safe-fs/core", external: true }));
});
