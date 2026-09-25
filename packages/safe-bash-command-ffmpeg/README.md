# safe-bash-command-ffmpeg

Pure in-memory `ffmpeg` and `ffprobe` commands for `safe-bash`, backed by `@poe-code/mp4-ast` and pluggable media container ASTs (`mp4Ast`, `movAst`, `mkvAst`, `webmAst`, `mpegtsAst`, `aviAst`, `flvAst`, `y4mAst`, `aacAst`, `wavAst`, `mp3Ast`, `flacAst`, `oggAst`, `gifAst`, `image2Ast`).

## Features

- **Dynamic AST-Driven Format Support**: Pass `asts: [...]` to `ffmpegCommands({ asts })` to dynamically determine which container formats, extensions, demuxers, muxers, and codecs are supported by `ffmpeg` and `ffprobe`.
- **Video Merging & Concatenation**: Supports `-f concat -safe 0 -i list.txt -c copy`, `concat:clip1.mp4|clip2.mp4`, and `-filter_complex "concat=n=2:v=1:a=1"`.
- **Trimming, Muxing & Faststart**: Supports `-ss`, `-to`, `-t`, `-map`, `-an`, `-vn`, `-shortest`, `-movflags +faststart`, and `-movflags frag_keyframe+empty_moov`.
- **Filtergraphs & Frame Extraction**: Supports `scale`, `crop`, `pad`, `fps`, `hflip`, `vflip`, `transpose`, `negate`, `drawbox`, `overlay`, `hstack`, `vstack`, and `%03d.png` image sequences.
- **Consumer-Defined Limits**: Imposes no default limits while offering `cloudflareWorkerLimits()` and opt-in/opt-out feature controls (`features: { videoTranscode, filterGraph, lavfiSources }`).
