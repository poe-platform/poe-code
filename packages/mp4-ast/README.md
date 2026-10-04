# @poe-code/mp4-ast

Portable multimedia container and bitstream AST engine for MP4 (`ISOBMFF`), QuickTime (`MOV`), Fragmented MP4 (`fMP4`), Matroska (`MKV`), WebM (`WebM`), MPEG-TS (`.ts`), AVI (`.avi`), FLV (`.flv`), YUV4MPEG2 (`.y4m`), ADTS AAC (`.aac`), WAV, MP3, FLAC, OGG, GIF, and Image sequences.

For cooperative hosts, `muxMp4Steps` and `sliceMp4Steps` return generators that pause between track/sample batches. Yield to your host event loop and check cancellation before resuming; their final values match the synchronous APIs.

WAV probing skips decoded PCM channel arrays. Use `wavAst().parse(bytes, { decodeAudio: false })` or `parseWav(bytes, { decodeAudio: false })` to retain encoded samples without decoding audio; parsing decodes audio by default. Metadata-only probing also skips per-packet sample allocation. Byte-buffer APIs still retain the input. For caller-owned range reads, use `await probeWavSource({ size, read(offset, length) }, { filename, signal })`: it reads headers in requests of at most 16 bytes, skips sample payloads, and returns the same media metadata schema. The caller keeps ownership of the source and closes it. Packet/frame enumeration remains on the byte-buffer probe API. The ffprobe command uses this path for explicit `-f wav` metadata requests on filesystems with retained reads.

## Features

- **Lossless MP4 / Multi-Container Merging (`concatMp4`)**: Concatenates multiple videos at the sample/packet level without pixel re-encoding, automatically handling multi-entry `stsd` codec tables (`sample_description_index = 1, 2, ...`) and aligning video/audio durations at segment boundaries. Decoded audio is concatenated at the first segment’s sample rate and channel count, using linear resampling, mono duplication, and averaging when downmixing to mono. Alignment gaps contain silence; mixing encoded and decoded segments in one audio track requires decoding all segments first.
- **Keyframe & Edit-List Cutting (`sliceMp4`)**: Slices decoded audio at rounded PCM sample boundaries. Trims video and audio tracks by time range (`startSeconds`, `endSeconds`, `durationSeconds`) with `edts`/`elst` edit lists preserving keyframe preroll and the requested playback duration by default. Set `useEditList: false` for sample cutting without preroll (for example, at HLS keyframe boundaries).
- **Track Muxing & Remapping (`muxMp4`)**: Mixes tracks across files, strips audio (`stripAudio`) or video (`stripVideo`), updates display rotation (`0`, `90`, `180`, `270`), and relocates `moov` before `mdat` (`faststart`).
- **Modular AST Registry (`createMediaAstRegistry`, `allMediaAsts`)**: Pluggable format descriptors consumed by `ffmpeg` and `ffprobe` to dynamically determine which container formats, extensions, demuxers, muxers, and codecs are enabled.
- **Consumer-Defined Resource Limits (`MediaResourceLimits`, `cloudflareWorkerLimits`)**: Imposes zero default restrictions while offering a ready-made Cloudflare Worker limit preset and `MediaBudgetTracker`.

`hlsAst()` and `dashAst()` parse local media playlists using a caller-provided
`resolveResource(uri)` option. The URI is relative to the manifest; return the
referenced file bytes. HLS supports MPEG-TS and fMP4 segments with `EXT-X-MAP`.
DASH supports a static single Period, `SegmentTemplate` (duration or timeline),
`SegmentList`, and `BaseURL`, selecting the first representation per adaptation
set. Missing resources fail rather than producing synthetic streams. Encrypted
HLS, master playlists, and byte-range segments are not supported.

For DASH output, `serializeDashDocument(doc)` returns `{ manifest, resources }`.
Write the manifest and each `resources` entry beside it; the output contains one
initialization file and one complete media fragment per audio/video track.
`dashAst().serialize(doc)` returns only the manifest bytes.
H.264 decoding handles native CAVLC/CABAC streams, reference pictures, delayed B frames, SPS cropping, and color conversion. `decodeH264Samples` yields complete tracks in presentation order; standalone access units can pass their `avcC` configuration to `decodeH264FrameToRgba`.

FLAC output encodes decoded PCM as lossless 16-bit verbatim frames. Ogg output defaults to Vorbis; `{ audioCodec: "opus" }` selects Opus and `{ audioCodec: "flac" }` selects Ogg FLAC. `.opus` format output defaults to Opus. All write complete audio packets with page checksums and accurate final durations. Encoding requires decoded PCM. The codecs run as static JavaScript in browsers and Workers, without native processes or runtime WebAssembly compilation.
