import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

test("ffmpeg bundles for Workers with one image codec implementation", async () => {
  const result = await build({
    entryPoints: [new URL("./index.ts", import.meta.url).pathname],
    bundle: true, platform: "browser", format: "esm", write: false,
    external: ["safe-bash-contracts", "safe-bash-contracts/*"],
    metafile: true, logLevel: "silent"
  });
  const text = result.outputFiles[0]!.text;
  assert.ok(!text.includes('"node:'));
  assert.equal(text.split("function encodeHeifImage(").length - 1, 1);
  assert.ok(text.length < 1_500_000);
});
