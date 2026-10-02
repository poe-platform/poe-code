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
  // Count emitted implementations; the portable entry is a zero-byte re-export.
  const imageInputs = Object.keys(result.metafile.inputs).filter(path => path.includes("/image-ast/"));
  assert.ok(imageInputs.some(path => path.endsWith("/dist/portable.js")));
  const imageImplementations = Object.values(result.metafile.outputs)
    .flatMap(output => Object.entries(output.inputs))
    .filter(([path, input]) => path.includes("/image-ast/") && input.bytesInOutput > 0);
  assert.equal(imageImplementations.length, 1);
  assert.ok(imageImplementations[0]![0].endsWith("/dist/index.js"));
  assert.ok(result.outputFiles[0]!.contents.byteLength < 1_500_000);
});
