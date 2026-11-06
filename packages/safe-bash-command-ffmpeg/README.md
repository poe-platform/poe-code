# safe-bash-command-ffmpeg

Pure in-memory `ffmpeg` and `ffprobe` commands for `safe-bash`, backed by `@poe-code/mp4-ast` and pluggable media container ASTs (`mp4Ast`, `movAst`, `mkvAst`, `webmAst`, `mpegtsAst`, `aviAst`, `flvAst`, `y4mAst`, `aacAst`, `wavAst`, `mp3Ast`, `flacAst`, `oggAst`, `gifAst`, `image2Ast`).

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { ffmpegCommands, cloudflareWorkerLimits } from "@poe-platform/safe-bash/commands/ffmpeg";

const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(ffmpegCommands({ limits: cloudflareWorkerLimits() }));
await shell.exec("ffmpeg -f lavfi -i color=c=red:s=16x16:r=2:d=1 -an /clip.mp4");
const probe = await shell.exec("ffprobe -show_streams -of json /clip.mp4");
await shell.dispose();
```

Register the plugin explicitly; importing it does not enable commands. Media I/O
uses the shell's virtual filesystem and byte streams. Input accepts `/dev/stdin`
and `/dev/fd/0`; output accepts `/dev/stdout` and `/dev/fd/1`, alongside `-`
and `pipe:` aliases. Shell and media input limits count bytes cumulatively across
stdin chunks, media files, playlists, image sequences, and subtitles. The portable command bundle
requires no Node builtins and supports browser and Worker runtimes. These commands
implement the listed AST capabilities, not every native FFmpeg codec or option.
Default `scale` on decoded H.264 uses native YUV pixels before RGB conversion.
WAV extraction decodes Ogg Vorbis, AAC and CBR/VBR MP3 in memory, honoring MP4 edit timing
and MP3 encoder delay and padding:
`ffmpeg -y -i input.mp4 -vn -c:a pcm_s16le audio.wav`. Corrupt or unsupported
audio fails without replacing an existing output. Audio filters, `-ar`, and `-ac` accept AAC input as well as decoded PCM
input, such as WAV or a `lavfi` source. Audio filters run in chain order; each
`atempo` stage processes the preceding stage’s samples, including `areverse`.
`anull` passes audio through unchanged, alone or in a filter chain.
`volume` and `atempo` default to 1 and accept named primary arguments, such as
`volume=volume=0.5` and `atempo=tempo=2`, as well as positional values.
`atempo` accepts arithmetic such as `atempo=1/2`; the result must be between 0.5 and 100.
Audio filters accept instance labels, such as `areverse@flip`, `volume@quiet=0.5`,
and `atempo@fast=2`, with the same behavior as their unlabeled forms.
`volume=if(lt(t\,0.5)\,0\,1):eval=frame` changes gain at audio frame timestamps;
`eval=once` (the default) evaluates a constant gain. Expressions accept escaped commas or single quotes.
`atempo=1` still aligns and blends audio windows, so it can change PCM samples and clip length.
`-filter:a:0 volume=0` (or `-af:0 volume=0`)
mutes the first output audio stream; numeric audio selectors follow output mapping
and leave nonmatching streams unchanged. Filtering a matching stream with `-c:a copy`
fails without writing output. `-ac -1` retains the input channel count. `-ac 1` downmixes stereo and
5.1 WAV audio (back or side surrounds) using normalized FFmpeg weights, preserving
center dialogue and omitting LFE. Stereo upmixing with `-ac 3` or `-ac 4` preserves
left and right audio and leaves added channels silent. Other conversions from
multichannel inputs fail explicitly. Unsupported audio filters fail
without creating or replacing the output. Stream copying remains supported. Without `-map`, automatic audio selection keeps one track, preferring the default track, then the most channels, then input order. Use `-map 0:a` to copy every audio track from the first input. Global metadata defaults to the first input;
`-map_metadata N` copies it from input N, and `-map_metadata -1` suppresses copying.
Explicit `-metadata key=value` tags override copied metadata.
Each output filename closes its option group: `-t 0.025 a.wav -t 0.075 b.wav`
writes both files with independent durations. Output options reset after each filename;
trailing options without a filename do not change earlier outputs.
`-stream_loop -1` repeats an input up to a finite output `-t` or `-to`, subject to
media resource limits. Without either output bound, infinite looping fails explicitly.
`-metadata:s:a:0 language=fra` sets the first output audio track’s language;
stream selectors also accept an absolute index (`s:1`), a type (`s:a`), or all streams (`s`).
`-disposition:a:0 0 -disposition:a:1 default` selects the second output audio track as the MP4 default.
Disposition selectors accept a type, an absolute index, or all streams; supported values are
`0`, `1`, `default`, `+default`, and `-default`. Other disposition values fail explicitly.
`-map_chapters -1` removes output chapters; `-map_chapters N` copies chapters from input N.
`xfade` supports the default `fade` and `transition=wipeleft`; other transitions fail
without creating or replacing output.
`trim` supports `start`, `end`, `duration`, `start_frame`, and `end_frame`; frame
numbers are zero-based and the end frame is excluded. Unsupported trim options fail
without replacing output.
Burned SRT captions use bitmap lettering and bottom spacing that scale with video height.

`ffprobe` uses the same audio/video implementation as `@poe-platform/safe-bash/commands/ffprobe`, with default limits of 32 MiB input and 1 MiB output. Pass `limits` to override them.

## Features

- **Dynamic AST-Driven Format Support**: Pass `asts: [...]` to `ffmpegCommands({ asts })` to dynamically determine which container formats, extensions, demuxers, muxers, and codecs are supported by `ffmpeg` and `ffprobe`.
- **Video Merging & Concatenation**: Supports `-f concat -safe 0 -i list.txt -c copy`, `concat:clip1.mp4|clip2.mp4`, and `-filter_complex "concat=n=2:v=1:a=1"`. Manifests beginning with the exact `ffconcat version 1.0` signature are detected without `-f concat`. By default (or with `-safe 1`), concat filenames must be relative paths using ASCII letters, digits, underscores, hyphens, and periods, with no component starting with a period; `-safe 0` permits other filenames. Safe mode also rejects manifest `option` directives. Manifest `duration` sets the next segment’s timeline start without trimming samples; use `inpoint`/`outpoint` to trim. WAV concat retains the entire PCM packet that starts before `outpoint`. A missing later concat segment logs an error and preserves media already read; `-xerror` also makes the exit status nonzero. A missing first segment fails without creating output.
- **Trimming, Muxing & Faststart**: Supports input/output `-ss`, `-to`, `-t` (including lavfi sources), `-map`, `-an`, `-vn`, `-shortest`, `-movflags +faststart`, and `-movflags frag_keyframe+empty_moov`.
- **Filtergraphs & Frame Extraction**: Supports `scale`, `crop`, `pad`, `fps`, `hflip`, `vflip`, `transpose`, `rotate`, `negate`, `drawbox`, `overlay`, `hstack`, `vstack`, and `%03d.png` image sequences with independent input/output `-start_number` values and no default frame ceiling. Input searches five candidate indices from `-start_number` (default 0); `-start_number_range` changes that window. After the first image, the sequence stops at the first gap. `-pattern_type glob` reads matching image paths in sorted order; quote the pattern to keep the shell from expanding it. `-pattern_type none` reads the filename literally, including `%02d`. `-pattern_type sequence` selects the default numbered mode. `select` accepts arithmetic with `n` and `t`, and `eq`, `gt`, `between`, `not`, and `mod` functions; invalid or unsupported expressions fail without replacing output. Image sequences duplicate or drop frames to preserve output cadence after `select` and `setpts`; use `-fps_mode passthrough` (or `-vsync 0`) to write each filtered frame once. `hstack` and `vstack` continue to the longer input by repeating the shorter input’s last frame; set `shortest=1` to stop at the shorter input. `crop` positions accept arithmetic with `iw`, `ih`, `ow`, `oh` (and their `in_w`, `in_h`, `out_w`, `out_h` aliases); unsupported expressions fail without replacing output. `overlay` defaults to even x/y positions on the YUV420 chroma grid; `format=yuv422` aligns only x, while `format=auto`, `format=rgb`, and `format=yuv444` preserve integer positions. `overlay` positions accept arithmetic with `main_w`, `main_h`, `overlay_w`, and `overlay_h` (or `W`, `H`, `w`, and `h`); invalid or unsupported expressions fail without replacing output. `rotate` accepts constant radian angles (including `PI` and arithmetic), keeps the input canvas size, and uses bilinear sampling with black fill. Decoded 8-bit planar YUV frames rotate before RGB conversion; `format=rgba,rotate=...` explicitly selects RGB sampling. `drawbox` width and height accept arithmetic with `iw`, `ih`, `in_w`, and `in_h`; omitted or nonpositive dimensions use the frame size, and invalid expressions fail without replacing output. It blends alpha colors such as `red@0.5` and `0xff000080` over existing pixels. Animated GIF output preserves all frames and their timing; probing reports the full animation. The `smptebars` source produces static SMPTE bars.
- **Consumer-Defined Limits**: Imposes no default limits while offering `cloudflareWorkerLimits()` and opt-in/opt-out feature controls (`features: { videoTranscode, filterGraph, lavfiSources }`).

HLS stream-copy segments cut at keyframes, so a long GOP can exceed `-hls_time`; the playlist reports actual segment durations. `-hls_list_size` keeps the final N entries (default 5; 0 keeps all) and advances the media sequence. Segment files are preserved unless `-hls_flags delete_segments` is set; deletion retains one expired segment by default. `-hls_delete_threshold N` changes that count, capped by FFmpeg’s playlist-duration retention rule. Unlimited playlists do not delete segments. Language selectors `-map 0:m:language:fra` and `-map 0:a:m:language:fra` select French tracks; omit the language value to match any language tag. Negative `-map` selections remove previously selected streams by input, type, or stream index, and later positive maps can select them again.

Explicit `-hls_segment_filename` paths resolve from the working directory; default segments are written beside the playlist. Missing HLS parent directories are created. Existing outputs are preserved with exit status 1 unless `-y` is specified; `-n` explicitly requests preservation.


Both commands resolve local HLS and static DASH segment files from the virtual
filesystem, including fMP4 initialization files, and report the actual media
streams. Missing referenced files fail the command. DASH output (`-f dash` or
`.mpd`) writes the manifest plus `init-stream*.m4s` and `chunk-stream*.m4s` files
beside it, with one complete media fragment per audio/video track. DASH input
supports a single Period with segment templates, timelines, or segment lists;
HLS input requires an unencrypted media playlist without byte ranges.
Native H.264 inputs decode with CAVLC/CABAC and reference-frame support. `.ogg` output defaults to Vorbis; use `-c:a libopus` or a `.opus` filename for Opus, or `-c:a flac` for lossless Ogg FLAC.
