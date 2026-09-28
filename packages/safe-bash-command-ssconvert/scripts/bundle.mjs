import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

await build({
  entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
  outfile: new URL("../dist/index.js", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  conditions: ["browser"],
  target: "node22",
  format: "esm",
  external: ["@poe-code/safe-fs", "poe-code/safe-fs", ...Object.keys(manifest.devDependencies ?? {})],
  sourcemap: true
});

await build({
  stdin: {
    contents: 'import { snapshotRuntimeFunctions, createSsconvertCommand } from "./index.js"; globalThis.snapshot = snapshotRuntimeFunctions({}); globalThis.command = createSsconvertCommand();',
    resolveDir: new URL("../dist/", import.meta.url).pathname,
  },
  outfile: new URL("../dist/testing/worker-runtime-fixture.js", import.meta.url).pathname,
  bundle: true,
  platform: "browser",
  // Consume the built exports without repository TypeScript source aliases.
  tsconfigRaw: {},
  format: "iife",
});
