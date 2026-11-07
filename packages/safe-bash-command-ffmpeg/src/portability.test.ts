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
  // AAC and LAME MP3 encoders share the existing portable runtime.
  const codecBytes = codecImplementations[0]![1].bytesInOutput;
  assert.ok(codecBytes < 7_500_000, "the focused portable codec must remain bounded");
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
  // Includes canonical ffconcat signature probing (118 emitted bytes).
  // Includes concat directive ordering and reversed-range validation.
  // Includes concat version, unknown-keyword, and complete timestamp validation.
  // Includes per-input concat safe policy and filename validation.
  // Includes partial concat output and -xerror handling after a missing segment.
  // Includes rational and native named frame-rate parsing in both execution paths.
  // Includes image sequence startup search and start_number_range validation.
  // Includes the single-filename image2 guard and partial-output error.
  // Includes decoded-frame slicing and bounded image sequence timing.
  // Includes image2 glob traversal and literal input selection (about 1.4 KB).
  // Includes image2 frame_pts validation and timestamp filename selection.
  // Includes whole-packet subtitle slicing and gap-aware subtitle duration.
  // Includes integer-millisecond SRT timestamp parsing.
  // Includes subtitle markup conversion in both execution paths.
  // Includes SRT override decoding and SubRip/WebVTT input header validation.
  // Includes subtitle encoder validation and exact output format selection.
  // Includes ASS parsing, serialization, and codec selection (about 3 KB).
  // Includes verbatim WAV format extensions, fact chunks, and compressed payload tails.
  // Includes G.711 A-law and mu-law sample expansion and codec identification.
  // Includes IMA ADPCM block decoding, packet framing and metadata (about 2.6 KB).
  // Includes MP3/AAC WAV decoding with bounded PCM assembly.
  // Includes AAC/MP3 WAV headers and compressed packet serialization.
  // Includes double-precision PCM32 storage and the float32 Ogg encoder boundary.
  // Includes headerless PCM muxers and G.711 encoding tables.
  // Includes raw PCM input and AU/AIFF container adapters (AU adds about 1.9 KB; AIFF 3.2 KB).
  // Includes CAF chunk validation and PCM parsing/serialization (about 3.7 KB).
  // Includes Wave64 support and output format validation for discard destinations.
  // Includes whole-output audio checksums and portable digest implementations (about 14 KB).
  // Includes per-packet audio checksum timing and formatting (about 1.9 KB).
  // Includes strict input validation, empty-output checks, and configurable decode error thresholds.
  // Includes Matroska chapter/stream metadata and the current ffprobe implementation (about 523 KB).
  // Includes WebM stream-copy codec validation (measured total 525,085 bytes).
  // Includes labeled audio graph resolution (measured total 527,318 bytes).
  // Includes PCM pan mixing and channel routing (measured total 531,276 bytes).
  assert.ok(otherCodeBytes < 533_000, `command code and streaming parsers: ${otherCodeBytes} bytes`);
  // Audio decoders add their tables to the bounded portable codec runtime.
  // Retained PDF rendering shares the image codec graph. Include that required
  // implementation, plus legal notices and stream-map validation, in the complete Worker bundle budget.
  // Include argument validation before publishing outputs.
  // Current dependency graph plus concat comment/blank-line handling (37 emitted bytes).
  // Include independent concat timeline offsets while preserving PCM samples.
  // Current dependency graph plus subtitle packet selection and duration handling.
  // Includes current Matroska metadata and PCM codec mappings (measured 9,561,249 bytes).
  // Includes labeled audio graph resolution and current dependencies (measured 9,570,472 bytes).
  // Includes PCM pan mixing and channel routing.
  assert.ok(result.outputFiles[0]!.contents.byteLength < 9_576_000,
    `complete Worker bundle: ${result.outputFiles[0]!.contents.byteLength} bytes`);
});
