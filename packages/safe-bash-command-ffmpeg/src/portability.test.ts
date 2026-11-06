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
  assert.ok(codecBytes < 7_000_000, "the focused portable codec must remain bounded");
  const otherCodeBytes = Object.values(result.metafile.outputs)
    .flatMap(output => Object.entries(output.inputs))
    .filter(([path]) => !["/media-codecs/", "/image-ast/", "/pdf-ast/"].some(owner => path.includes(owner)))
    .reduce((total, [, input]) => total + input.bytesInOutput, 0);
  // Includes PCM conversion, lossless WAV copying, audio probe metadata,
  // native single-precision drawbox blending, named overlay offsets, xfade input validation,
  // HLS playlist window handling, trim bounds, native-pixel video filtering,
  // MP3/Vorbis packet timing and PCM assembly, pad chroma alignment,
  // WAV output PCM precision selection, output time range validation, map input validation,
  // protection against overwriting an input file, independent output groups,
  // bounded stream looping, and strict forced input format selection.
  // Includes rejection of negative durations and stream-scoped audio filter selection.
  // Includes fixed-point PCM16 mono mixing (209 emitted bytes).
  // Includes unity-tempo correlation, Hann blending, and partial-window flushing.
  // Includes frame-evaluated volume and timeline enable expressions.
  // Includes concat directive ordering and reversed-range validation.
  assert.ok(otherCodeBytes < 455_900, "command code and streaming parsers remain bounded independently of media/image/PDF codecs");
  // Audio decoders add their tables to the bounded portable codec runtime.
  // Retained PDF rendering shares the image codec graph. Include that required
  // implementation, plus legal notices and stream-map validation, in the complete Worker bundle budget.
  // Include argument validation before publishing outputs.
  // Current dependency graph plus concat comment/blank-line handling (37 emitted bytes).
  // Include independent concat timeline offsets while preserving PCM samples.
  assert.ok(result.outputFiles[0]!.contents.byteLength < 9_018_000);
});
