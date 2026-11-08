import { build } from "esbuild";
import * as files from "node:fs/promises";
import { privateExportStarsPlugin } from "../../../scripts/private-export-stars.mjs";

const manifest = JSON.parse(await files.readFile(new URL("../package.json", import.meta.url), "utf8"));
await files.rm(new URL("../dist/chunks", import.meta.url), { recursive: true, force: true });

const recipe = {
  entryPoints: { index: new URL("../src/index.ts", import.meta.url).pathname },
  outdir: new URL("../dist", import.meta.url).pathname,
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  splitting: true,
  minify: true,
  bundle: true,
  platform: "browser",
  conditions: ["browser"],
  target: "es2022",
  format: "esm",
  external: ["@poe-code/safe-fs", "@poe-code/safe-fs/*", "poe-code/safe-fs", "@poe-code/pdf", "@poe-code/pdf/*", "safe-bash-pdf-engine", "safe-bash-pdf-engine/*", "@poe-code/spreadsheet-ast/*", "@poe-code/pdf-ast", "@poe-code/pdf-ast/*", "pdf-lib", "@pdf-lib/fontkit", "@poe-code/image-ast", "@poe-code/image-ast/*", "@poe-code/office-package", "@poe-code/office-package/*", "@poe-code/spreadsheet-engine", "@poe-code/spreadsheet-engine/*", "@poe-code/spreadsheet-ast", "@poe-code/xlsx-ast", "@poe-code/xlsx-ast/*", ...Object.keys(manifest.devDependencies ?? {})],
  sourcemap: true
};
// A lazy self-import shares the entry namespace with split chunks. Make its
// external star bindings explicit so that sharing cannot erase public exports.
await build({ ...recipe, plugins: [privateExportStarsPlugin(new Map(), files,
  new URL("../src", import.meta.url).pathname, async specifier => {
    if (!recipe.external.some(name => specifier === name || specifier.startsWith(name + "/"))) return undefined;
    const result = await build({
      stdin: { contents: `export * from ${JSON.stringify(specifier)};`, resolveDir: new URL("../src", import.meta.url).pathname },
      bundle: true, write: false, platform: recipe.platform, conditions: recipe.conditions,
      target: recipe.target, format: recipe.format, metafile: true,
    });
    return Object.values(result.metafile.outputs).find(output => output.entryPoint).exports;
  }
)] });

await build({
  stdin: {
    contents: "import { snapshotRuntimeFunctions, createSsconvertCommand } from \"./index.js\"; globalThis.snapshot = snapshotRuntimeFunctions({}); globalThis.command = createSsconvertCommand();",
    resolveDir: new URL("../dist/", import.meta.url).pathname,
  },
  outfile: new URL("../dist/testing/worker-runtime-fixture.js", import.meta.url).pathname,
  bundle: true,
  platform: "browser",
  tsconfigRaw: {},
  format: "iife",
});
