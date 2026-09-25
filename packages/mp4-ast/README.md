# @poe-code/mp4-ast

Pure TypeScript multimedia container and bitstream AST engine for MP4 (`ISOBMFF`), QuickTime (`MOV`), Fragmented MP4 (`fMP4`), Matroska (`MKV`), WebM (`WebM`), MPEG-TS (`.ts`), AVI (`.avi`), FLV (`.flv`), YUV4MPEG2 (`.y4m`), ADTS AAC (`.aac`), WAV, MP3, FLAC, OGG, GIF, and Image sequences.

## Features

- **Lossless MP4 / Multi-Container Merging (`concatMp4`)**: Concatenates multiple videos at the sample/packet level without pixel re-encoding, automatically handling multi-entry `stsd` codec tables (`sample_description_index = 1, 2, ...`) and aligning video/audio durations at segment boundaries.
- **Keyframe & Edit-List Cutting (`sliceMp4`)**: Trims video and audio tracks by time range (`startSeconds`, `endSeconds`, `durationSeconds`) with optional `edts`/`elst` sub-GOP accuracy.
- **Track Muxing & Remapping (`muxMp4`)**: Mixes tracks across files, strips audio (`stripAudio`) or video (`stripVideo`), updates display rotation (`0`, `90`, `180`, `270`), and relocates `moov` before `mdat` (`faststart`).
- **Modular AST Registry (`createMediaAstRegistry`, `allMediaAsts`)**: Pluggable format descriptors consumed by `ffmpeg` and `ffprobe` to dynamically determine which container formats, extensions, demuxers, muxers, and codecs are enabled.
- **Consumer-Defined Resource Limits (`MediaResourceLimits`, `cloudflareWorkerLimits`)**: Imposes zero default restrictions while offering a ready-made Cloudflare Worker limit preset and `MediaBudgetTracker`.
