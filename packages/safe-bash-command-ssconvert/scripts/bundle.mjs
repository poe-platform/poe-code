import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
await rm(new URL("../dist/chunks", import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: { index: new URL("../src/index.ts", import.meta.url).pathname },
  outdir: new URL("../dist", import.meta.url).pathname,
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  splitting: true,
  bundle: true,
  platform: "browser",
  conditions: ["browser"],
  target: "es2022",
  format: "esm",
  external: ["@poe-code/safe-fs", "poe-code/safe-fs", ...Object.keys(manifest.devDependencies ?? {})],
  sourcemap: true
});

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
