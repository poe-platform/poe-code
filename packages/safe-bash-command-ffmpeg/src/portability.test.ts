import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

test("ffmpeg bundles for Workers with one image codec implementation", async () => {
  const result = await build({
    entryPoints: [new URL("./index.ts", import.meta.url).pathname],
    bundle: true, minify: true, platform: "browser", format: "esm", target: "es2022", write: false,
    external: ["safe-bash-contracts", "safe-bash-contracts/*"],
    metafile: true, logLevel: "silent"
  });
  const text = result.outputFiles[0]!.text;
  assert.ok(!text.includes('"node:'));
  // Production minification changes private identifiers. Track the shared
  // codec module instead of a function's spelling to detect duplicate bundles.
  const imageInputs = Object.keys(result.metafile.inputs).filter(path => path.includes("/image-ast/"));
  assert.equal(imageInputs.length, 1);
  assert.ok(imageInputs[0]!.endsWith("/dist/portable.js"));
  assert.ok(result.outputFiles[0]!.contents.byteLength < 1_500_000);
});
