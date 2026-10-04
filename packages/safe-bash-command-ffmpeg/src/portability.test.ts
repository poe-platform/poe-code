import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

test("ffmpeg bundles for Workers with one image codec implementation", async () => {
  const result = await build({
    entryPoints: [new URL("./index.ts", import.meta.url).pathname],
    bundle: true, minify: true, platform: "browser", format: "esm", target: "es2022", write: false,
    external: ["safe-bash-contracts", "safe-bash-contracts/*"],
    alias: { "safe-bash-command-ffprobe": new URL("../../safe-bash-command-ffprobe/src", import.meta.url).pathname },
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
  const codecImplementations = Object.values(result.metafile.outputs)
    .flatMap(output => Object.entries(output.inputs))
    .filter(([path, input]) => path.includes("/media-codecs/") && input.bytesInOutput > 0);
  assert.equal(codecImplementations.length, 1);
  const codecBytes = codecImplementations[0]![1].bytesInOutput;
  assert.ok(codecBytes < 6_000_000, "the focused portable codec must remain bounded");
  const otherCodeBytes = Object.values(result.metafile.outputs)
    .flatMap(output => Object.entries(output.inputs))
    .filter(([path]) => !["/media-codecs/", "/image-ast/", "/pdf-ast/"].some(owner => path.includes(owner)))
    .reduce((total, [, input]) => total + input.bytesInOutput, 0);
  assert.ok(otherCodeBytes < 400_000, "command code and streaming parsers remain bounded independently of media/image/PDF codecs");
  // Retained PDF rendering shares the image codec graph. Include that required
  // implementation, plus legal notices, in the complete Worker bundle budget.
  assert.ok(result.outputFiles[0]!.contents.byteLength < 8_000_000);
});
