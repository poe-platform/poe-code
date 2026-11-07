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
  // Includes stereo mute, phase inversion, and mid/side channel conversions.
  // Includes aformat mono layout negotiation and the current audio filters.
  // Includes per-sample aeval expressions and channel selection (measured 536,625 bytes).
  // Includes single-file HLS assembly and byte-range playlists (about 1 KB).
  // Includes HLS duration rounding and current playlist options.
  // Includes DASH segment duration validation before output creation.
  // Includes DASH resource naming templates and XML attribute escaping (measured 543,731 bytes).
  // Includes explicit DASH SegmentList output (measured 544,294 bytes).
  // Includes single-file DASH assembly, segment indexes, and byte-range manifests (measured 547,396 bytes).
  // Includes DASH window/cleanup options and per-frame fragment subdivision (measured 550,083 bytes).
  // Includes shared DASH presentation timing and native representation EOF scheduling.
  // Includes local single-variant HLS master resolution (measured 554,532 bytes).
  // Includes HLS extension admission and the current streaming dependency graph.
  // Includes real MP3 output encoding and gapless packet metadata.
  // Includes ID3 user-text metadata parsing and MP3 tag serialization.
  // Includes ID3v2.3 UTF-16 encoding, selectable tag versions and ID3v1 trailers.
  // Includes FLAC packet demuxing and lossless fixed/LPC decoding and the current metadata dependency graph.
  // Includes FLAC Vorbis comment rewriting through the shared audio metadata writer.
  // Includes validated FLAC metadata padding and the current compression implementation.
  // Includes Opus logical-stream demuxing and packet-preserving Ogg output (measured 588,349 bytes).
  // Includes Opus PCM assembly and granule trimming (measured 590,067 bytes).
  // Includes ordered AVI stream headers, PCM/MJPEG copying and per-stream indexes (measured 592,472 bytes).
  // Includes nonuniform AVI packet clocks and bounded empty timing chunks (measured 593,162 bytes).
  // Includes FLV title metadata, MP3 audio, and FLV1 video copying (measured 596,083 bytes).
  // Includes FFmetadata chapter time bases and the current metadata parser graph (600,134 bytes).
  // Includes volumedetect sample statistics and the current filter graph (603,125 bytes).
  // Includes sample-accurate atrim bounds and the current audio filter graph (608,622 bytes).
  // Includes finite apad padding and the current audio filter graph (610,661 bytes).
  // Includes microsecond duration parsing and the current command graph (612,141 bytes).
  // Includes Haas stereo delays and the current audio filter graph (614,764 bytes).
  // Includes dialogue center extraction and its bounded FFT workspace (617,318 bytes).
  // Includes RF64 output modes and the current WAV reader graph (620,059 bytes).
  // Includes Broadcast Wave metadata serialization and the current WAV option graph (625,322 bytes).
  // Includes PCM afade timing, gain curves, and endpoint validation (627,348 bytes).
  // Includes compand transfer curves and the current audio filter graph (632,698 bytes).
  // Includes dynamic/speech normalization and bounded lookahead peak limiting.
  // Includes mono amerge and the current audio graph (644,357 bytes).
  // Includes PCM stream selection, multiplication, and sidechain compression (650,350 bytes).
  // Includes two-input PCM cross-correlation (652,980 bytes).
  // Includes input/output timestamp offsets and the current subtitle command graph.
  // Includes ashowinfo and the current subtitle parser dependencies (823,959 bytes).
  // Includes APNG frame assembly, play counts, and both command execution paths (830,166 bytes).
  // Includes selectable ICO/CUR streams and the current icon container command graph (833,464 bytes).
  // Includes HQX interpolation and the current pixel-art filter graph (847,057 bytes).
  assert.ok(otherCodeBytes < 850_000, `command code and streaming parsers: ${otherCodeBytes} bytes`);
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
  // Includes custom HLS fMP4 initialization filename parsing and output.
  // Includes HLS duration rounding and current playlist options.
  // Includes DASH segment duration validation before output creation.
  // Includes DASH naming templates (measured 9,586,891 bytes).
  // Includes DASH SegmentList serialization and use_template validation.
  // Includes single-file DASH segment indexes and byte-range manifests.
  // Includes per-frame DASH fragments and current dependencies (measured 9,593,243 bytes).
  // Includes MP3 encoding and gapless metadata using the existing codec runtime.
  // Includes ID3 metadata and attached-picture remuxing (measured 9,612,005 bytes).
  // Includes selectable MP3 metadata versions and ID3v1 trailers.
  // Includes FLAC decoding and the current metadata dependency graph.
  // Includes FLAC Vorbis comment rewriting through the shared audio metadata writer.
  // Includes Opus logical-stream demuxing and Ogg packet serialization (measured 9,631,709 bytes).
  // Includes the libopus decoder and PCM integration (measured 9,737,674 bytes).
  // Includes AVI multi-track copying (measured 9,740,081 bytes).
  // Includes nonuniform AVI timing and its sample-budget check.
  // Includes the FLV metadata and legacy codec container support.
  // Includes FFmetadata chapter timing and the current metadata graph (9,747,743 bytes).
  // Includes volumedetect sample statistics and the current filter graph.
  // Includes sample-accurate atrim bounds and the current audio filter graph (9,756,236 bytes).
  // Includes RF64 output and the current audio/container graph (9,789,404 bytes).
  // Includes Broadcast Wave output and metadata option handling (9,792,078 bytes).
  // Includes compand and the current audio filter graph (9,802,088 bytes).
  // Includes dynamic/speech normalization and bounded lookahead peak limiting.
  // Includes mono amerge and the current audio graph (9,813,728 bytes).
  // Includes two-input PCM cross-correlation (9,822,359 bytes).
  // Includes the current parser graph and PCM frame diagnostics (9,993,584 bytes).
  // Includes APNG output and the current animation decoder graph (10,012,811 bytes).
  // Includes ICO/CUR entries and the shared icon codec graph (10,021,895 bytes).
  // Includes HQX and the current pixel-art filter graph (10,038,858 bytes).
  assert.ok(result.outputFiles[0]!.contents.byteLength < 10_045_000,
    `complete Worker bundle: ${result.outputFiles[0]!.contents.byteLength} bytes`);
});
