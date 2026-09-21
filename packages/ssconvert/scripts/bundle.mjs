import { build } from "esbuild";

await build({
  entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
  outfile: new URL("../dist/index.js", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  banner: { js: 'import { createRequire as ssconvertCreateRequire } from "node:module"; const require = ssconvertCreateRequire(import.meta.url);' }
});
