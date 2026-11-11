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
  // Current portable codec runtime measures 9,082,087 emitted bytes.
  const codecBytes = codecImplementations[0]![1].bytesInOutput;
  assert.ok(codecBytes < 9_085_000, "the focused portable codec must remain bounded");
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
  // Includes tremolo modulation and the current audio filter graph (852,824 bytes).
  // Includes GIF input options and WAV encoder metadata.
  // Includes FLAC stereo transforms, side-channel precision and command options.
  // Includes FLAC LPC order search, partition bounds and exact Rice selection (872,276 bytes).
  // Includes per-frame RGB histograms and the current video filter graph (878,315 bytes).
  // Includes per-frame vectorscopes and the current video filter graph (884,356 bytes).
  // Includes the oscilloscope renderer and its CGA statistics glyphs (889,166 bytes).
  // Includes datascope readouts and the current filter graph (892,012 bytes).
  // Includes pixscope magnification, statistics glyphs, and the current filter graph (906,336 bytes).
  // Includes Matroska ASS packet fields and style overrides (908,889 bytes).
  // Includes image2 atomic publication and the current command graph (919,493 bytes).
  // Includes the native RGB testsrc calibration renderer (921,522 bytes).
  // Includes scheduled volume commands, ReplayGain, and the PCM audio gate (926,366 bytes).
  // Includes silence removal and the current audio filter graph (934,065 bytes).
  // Includes aexciter harmonic processing and its bounded per-channel state.
  // Includes mpdecimate and the current video filter graph (943,146 bytes).
  // Includes cycle-based decimation metrics and timestamp resampling (944,504 bytes).
  // Includes tinterlace scan-line weaving (946,673 bytes).
  // Includes contact-sheet extraction with untile (948,900 bytes).
  // Includes elapsed xfade progress and the current command graph (950,528 bytes).
  // Includes tanh soft clipping and the current audio filter graph (956,408 bytes).
  // Includes transpose option validation and geometry passthrough (958,495 bytes).
  // Includes rotate fill colors and the current rotation sampling graph (960,008 bytes).
  // Includes negate option validation and component availability checks (961,770 bytes).
  // Includes fps start-time offsets in the input and output time bases (963,021 bytes).
  // Includes crop option validation before frame publication (964,482 bytes).
  // Includes crop aspect-ratio propagation and PNG resolution metadata.
  // Includes scale size notation, output-dimension expressions, and interpolation flags (970,095 bytes).
  // Includes 16-bit PNG format selection, channel layout, and current command graph (972,260 bytes).
  // Includes indexed pal8 PNG output and error diffusion (974,139 bytes).
  // Includes subtitle filter option validation before frame publication (976,314 bytes).
  // Includes subtitle color/alignment overrides and original-canvas aspect scaling (977,528 bytes).
  // Includes PCM frame limits and the current raw-audio codec validation (981,042 bytes).
  // Includes explicit frame checksum hash selection and the current command graph (983,646 bytes).
  // Includes frame hash format versions and the current checksum command graph (985,258 bytes).
  // Includes per-frame video checksums and the current command graph (990,464 bytes).
  // Includes completion progress statistics and destination handling (993,507 bytes).
  // Includes stream metadata selection and the current command graph (996,354 bytes).
  // Includes output-stream frame selectors and encoded timed-text copying (999,989 bytes).
  // Includes per-input MP4 timestamp rebasing and stream-copy timestamp controls (1,002,056 bytes).
  // Includes input synchronization and output seeking with initial non-key packet copying (1,004,412 bytes).
  // Includes input display transforms and the current stream-copy option graph (1,007,630 bytes).
  // Includes MP4 timescale options and explicit color-box writing (1,010,761 bytes).
  // Includes decode-time interleaving of MP4 track payloads.
  // Includes MP4 initial media and fragment controls.
  // Includes global/per-fragment MP4 indexes and fragment addressing (1,017,195 bytes).
  // Includes MP4 timecode references, authoring, and mapped-video retention (1,020,633 bytes).
  // Includes M4A text/compilation metadata and the current portable command graph (1,026,245 bytes).
  // Includes aresample first_pts padding and trimming (1,029,023 bytes).
  // Includes arealtime pacing, option validation, and cancellable timers (1,031,102 bytes).
  // Includes stream IDs and H.264 bitstream filtering with validation before writing.
  // Includes SPS metadata rewriting and the current bitstream filter graph (1,042,470 bytes).
  // Includes AAC codec validation and the current packet-filter graph (1,044,691 bytes).
  // Includes copied-packet timestamps and the current Matroska attachment graph (1,052,313 bytes).
  // Includes concat H.264 automatic parameter-set insertion (1,055,437 bytes).
  // Includes HLS playlist resumption and the current command graph (1,065,871 bytes).
  // Includes loudnorm processing and the current command graph (1,085,414 bytes).
  // Includes explicit AVI H.264 framing and the current container metadata graph (1,094,559 bytes).
  // Includes speaker-layout validation and the current audio mixing graph (1,101,689 bytes).
  // Includes headerless RGB input and the current container graph (1,117,724 bytes).
  // Includes the current command graph, retained image packets, and separate image2 planes.
  // Includes configurable PCM resampling support (measured 1,145,221 bytes).
  // Includes WAV ADPCM/G.726 encoding and G.711 container handling (measured 1,161,162 bytes).
  // Current command graph with native expression powers measures 1,168,987 bytes.
  // Includes ordered image2 brace alternatives and the current command graph (1,178,057 bytes).
  // Current dependencies plus asubcut measure 1,294,815 bytes (baseline 1,291,909).
  // Current command graph, including apad frame boundaries, measures 1,405,997 bytes.
  // Current audio timestamp handling and atrim integer expressions measure 1,413,903 bytes.
  // Current audio graph plus single-precision dialogue FFT (about 2.9 KB) measures 1,441,358 bytes.
  // Current dependency graph and scheduled stereowiden feedback measure about 1.463 MB.
  // Current command graph with scheduled afade unity updates measures about 1.473 MB.
  // Current dependency graph and per-frame atrim bounds measure about 1.49 MB.
  // Includes current decimate options and clean-source graph routing (1,555,037 bytes).
  // Includes native tinterlace plane weaving and the current command graph (1,565,735 bytes).
  // Current graph plus mpdecimate options measures 1,759,688 bytes (1,182 added bytes).
  // Current command graph plus pullup measures 2,023,788 bytes (4,687 added bytes).
  // Current graph with swaprect measures 2,131,685 bytes (2,129,282 without it).
  assert.ok(otherCodeBytes < 2_140_000, `command code and streaming parsers: ${otherCodeBytes} bytes`);
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
  // Includes compensation delay and the current audio filter graph (10,045,564 bytes).
  // Includes GIF packet copying and the current GIF muxer graph (10,052,052 bytes).
  // Includes FLAC stereo encoding and the current predictor graph (10,061,688 bytes).
  // Includes FLAC prediction, partition and Rice searches (10,068,721 bytes).
  // Includes per-frame RGB histograms and the current media dependency graph (10,194,004 bytes).
  // Includes per-frame vectorscopes and the current media dependency graph.
  // Includes oscilloscope rendering and statistics (10,204,599 bytes).
  // Includes pixscope rendering and the current media dependency graph (10,221,740 bytes).
  // Includes Matroska ASS decoding and the current media dependency graph (10,224,328 bytes).
  // Includes image2 boolean validation and the current media dependency graph (10,247,258 bytes).
  // Includes atomic image publication and the current media dependency graph (10,259,090 bytes).
  // Includes the native testsrc renderer (10,261,109 bytes).
  // Includes scheduled volume commands, ReplayGain, and the PCM audio gate (10,265,955 bytes).
  // Includes silence removal and the current audio filter graph.
  // Includes default mpdecimate block comparisons and retained-frame selection.
  // Includes cycle-based decimation (10,286,621 bytes).
  // Includes contact-sheet extraction with untile (10,290,146 bytes).
  // Includes tanh soft clipping and the current media dependency graph (10,297,108 bytes).
  // Includes transpose validation and geometry passthrough (10,299,197 bytes).
  // Includes rotate fill colors and the current rotation sampling graph.
  // Includes fps option validation and timestamp rounding (10,303,456 bytes).
  // Includes trim duration anchoring, validation, and greedy end bounds (10,304,270 bytes).
  // Includes crop option validation before frame publication (10,305,200 bytes).
  // Includes crop aspect-ratio propagation and PNG metadata (10,307,408 bytes).
  // Includes scale size notation, expressions, and interpolation flags (10,310,795 bytes).
  // Includes 16-bit PNG format output and current dependencies (10,312,964 bytes).
  // Includes pal8 conversion and the current image codec graph (10,315,957 bytes).
  // Includes subtitle option validation, style overrides, and original_size scaling (10,318,887 bytes).
  // Includes PCM frame limits and the current raw-audio codec validation (10,322,309 bytes).
  // Includes explicit frame checksum hash selection and the current dependency graph (10,325,595 bytes).
  // Includes per-frame video checksums and the current dependency graph (10,332,258 bytes).
  // Includes completion progress statistics and destination handling (10,335,256 bytes).
  // Includes stream metadata selection and the current dependency graph (10,338,252 bytes).
  // Includes output-stream frame selectors and encoded timed-text copying (10,341,672 bytes).
  // Includes timestamp controls, input synchronization, and output packet selection (10,346,301 bytes).
  // Includes input display transforms and the current dependency graph (10,350,179 bytes).
  // Includes initial MP4 media preservation when fragmenting (10,354,186 bytes).
  // Includes MP4 segment indexes and fragment addressing (10,358,842 bytes).
  // Includes MP4 timecode references, authoring, and mapped-video retention (10,362,272 bytes).
  // Includes M4A text/compilation metadata and the current dependency graph (10,368,562 bytes).
  // Includes arealtime pacing and the current audio filter graph (10,372,978 bytes).
  // Includes stream IDs and validated H.264 bitstream filtering (10,376,189 bytes).
  // Includes SPS metadata rewriting and the current dependency graph (10,384,154 bytes).
  // Includes AAC codec validation and the current dependency graph (10,386,300 bytes).
  // Includes copied-packet timestamps and the current dependency graph (10,393,910 bytes).
  // Includes concat H.264 automatic parameter-set insertion (10,397,149 bytes).
  // Includes HLS playlist resumption and the current media dependency graph.
  // Includes loudness normalization and audio frame metadata (10,426,993 bytes).
  // Includes explicit AVI H.264 framing and current container metadata (10,436,718 bytes).
  // Includes speaker-layout validation and the current media dependency graph (10,458,818 bytes).
  // Includes headerless RGB input and the current media dependency graph (10,474,196 bytes).
  // Current command graph and media dependencies, including image2 planes, measure 10,700,030 bytes.
  // Includes the current WAV encoders and G.711 container graph (measured 10,720,719 bytes).
  // Current dependency graph with native expression powers measures 10,736,115 bytes.
  // Includes ordered image2 brace alternatives and the current dependency graph (10,745,986 bytes).
  // Current dependencies plus asubcut measure 10,868,764 bytes (baseline 10,865,858).
  // Current dependencies and apad frame boundaries measure 12,780,764 bytes.
  // Current dependencies and the volumedetect histogram measure 12,790,767 bytes.
  // Current dependencies plus the dialogue FFT measure 12,817,734 bytes.
  // Current dependencies and scheduled stereowiden feedback measure about 12.839 MB.
  // Current dependencies and per-frame atrim bounds measure about 12.873 MB.
  // Current portable graph with two-input decimation measures 13,212,355 bytes.
  // Double-rate field weaving and the current graph measure about 13.226 MB.
  // Current graph plus mpdecimate options measures 13,479,618 bytes.
  // Current graph plus pullup measures 13,749,458 bytes (baseline 13,744,771).
  // Current graph with swaprect measures 13,872,645 bytes.
  assert.ok(result.outputFiles[0]!.contents.byteLength < 13_885_000,
    `complete Worker bundle: ${result.outputFiles[0]!.contents.byteLength} bytes`);
});
