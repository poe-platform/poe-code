import { build } from "esbuild";

await build({
  entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
  outfile: new URL("../dist/index.js", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true
});

await build({
  stdin: {
    contents: 'import { snapshotRuntimeFunctions } from "./index.js"; globalThis.snapshot = snapshotRuntimeFunctions({});',
    resolveDir: new URL("../dist/", import.meta.url).pathname,
  },
  outfile: new URL("../dist/testing/worker-runtime-fixture.js", import.meta.url).pathname,
  bundle: true,
  platform: "browser",
  format: "iife",
});
