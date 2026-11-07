# safe-bash-command-ffmpeg

Pure in-memory `ffmpeg` and `ffprobe` commands for `safe-bash`, backed by `@poe-code/mp4-ast` and pluggable media container ASTs (`mp4Ast`, `movAst`, `mkvAst`, `webmAst`, `mpegtsAst`, `aviAst`, `flvAst`, `y4mAst`, `aacAst`, `wavAst`, `auAst`, `cafAst`, `aiffAst`, `mp3Ast`, `flacAst`, `oggAst`, `gifAst`, `image2Ast`).

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
Use `-abort_on empty_output` to fail with status 234 when processing produces no
media frames across all outputs. Empty streams remain valid without this flag.
Use `-max_error_rate N` to set the decoder failure threshold (default `2/3`);
exceeding it returns status 69 after writing output. Error accounting matches
FFmpeg 7.0.2: partial decode failures have rate 0, wholly failed decoding has rate 1.
`-xerror` still fails on individual errors; stream copy does not decode.
Use `-progress pipe:1` for a machine-readable completion record on stdout, including
`out_time` and `progress=end`. `-nostats` is accepted and leaves these records enabled.
Progress currently supports stdout destinations and emits a final record after processing.
`adelay=0S|1S` delays each audio channel independently and pads with silence.
Use uppercase `S` for sample frames, lowercase `s` for seconds, or no suffix for
milliseconds. `adelay=1S:all=1` repeats the last delay for remaining channels;
without `all=1`, unspecified channels are unchanged.
Default `scale` on decoded H.264 uses native YUV pixels before RGB conversion.
Explicit `-f` raw audio output writes headerless `s8`, `u8`, `s16le/be`, `s24le/be`,
`s32le/be`, `f32le/be`, `f64le/be`, `mulaw`, and `alaw` samples, for example
`ffmpeg -i input.wav -f s16le output.pcm`.
Verify a single audio stream with `-f hash -` (SHA256), `-f md5 -`, or
`-f crc -` (Adler-32). These hash decoded PCM16 samples, without container
headers; `-f hash -hash sha512 digest.txt` selects another digest and writes a file.
Use `-map 0:a -map 1:a -f streamhash -` for a separate digest per mapped audio
stream, in output order, labeled `0,a,SHA256=...`, `1,a,SHA256=...`, and so on.
Hash selection supports MD5, SHA160, SHA224, SHA256, SHA384, and SHA512.
Audio filters and explicit PCM encoders apply before hashing; `-c:a copy` hashes
the encoded audio packets. Use `-vn` to exclude video.
Read headerless samples with input format, rate, and channel options:
`ffmpeg -f s16be -ar 8000 -ac 1 -i input.pcm -c:a pcm_s16le output.wav`.

Read and write Sony Wave64 with `ffmpeg -i input.wav output.w64` or `ffmpeg -i input.w64 -c:a pcm_s16le output.wav`; `-f w64` selects the format explicitly.

Read and write uncompressed AIFF (`.aiff`, `.aif`, or `-f aiff`) with signed 8/16/24/32-bit PCM; output defaults to `pcm_s16be`.

Read and write CAF audio (`.caf` or `-f caf`) with signed 8/16/24/32-bit PCM or 32/64-bit floating-point samples in either byte order. Output defaults to `pcm_s16be`; `-c:a copy` preserves encoded PCM samples.

Read and write Sun AU audio with `ffmpeg -i input.wav output.au` or
`ffmpeg -i input.au -c:a pcm_s16le output.wav`. AU defaults to big-endian PCM16.

Encode mono or stereo IMA ADPCM WAV with `-c:a adpcm_ima_wav output.wav`.

WAV extraction decodes Ogg Vorbis, AAC and CBR/VBR MP3 in memory, honoring MP4 edit timing
and MP3 encoder delay and padding:
`ffmpeg -y -i input.mp4 -vn -c:a pcm_s16le audio.wav`. Corrupt or unsupported
audio fails without replacing an existing output. Audio filters, `-ar`, and `-ac` accept AAC input as well as decoded PCM
input, such as WAV or a `lavfi` source. Labeled single-input audio chains in `-filter_complex` resolve input stream selectors and linked labels, then apply the filters selected by `-map "[label]"`. Unsupported audio filters fail without writing unfiltered output. Audio filters run in chain order; each
`atempo` stage processes the preceding stage’s samples, including `areverse`.
`anull` passes audio through unchanged, alone or in a filter chain.
`extrastereo=m=0` averages left and right while retaining stereo; `m=-1` swaps them.
The width multiplier defaults to 2.5 (range -10 to 10); `c=0` disables clipping.
`stereotools` supports stereo channel mute (`mutel`, `muter`), phase inversion
(`phasel`, `phaser`), and all `mode` channel conversions, including `lr>ms` and
`ms>lr`. For example, `-af stereotools=mutel=1` silences only the left channel.
Other stereotools options are rejected.

Swap stereo PCM channels with `-af 'channelmap=map=1|0:channel_layout=stereo'`.
Numeric channel maps support mono/stereo output and reject unavailable input channels.
`aeval=val(1)|val(0)` evaluates separate expressions against the input samples to swap
stereo channels. Mono/stereo expressions support arithmetic, `val(channel)`, `ch`,
`n`, `t`, `s`, `nb_in_channels`, and `nb_out_channels`; `c=same` retains the input
layout and repeats the last expression when needed.
Split stereo PCM into distinct mono files with
`-filter_complex '[0:a]channelsplit=channel_layout=stereo[L][R]' -map '[L]' left.wav -map '[R]' right.wav`.
Use `-af channelsplit=channel_layout=stereo:channels=FR` to extract only the right
channel (`FL` selects the left). Other channel layouts are not supported.
`pan` supports mono/stereo output, numbered channels and named channels from the
input layout: `-af 'pan=mono|c0=c1'` extracts the right channel and
`-af 'pan=stereo|FL=FR|FR=FL'` swaps stereo channels. Weighted sums use `=`,
and `<` normalizes gains, for example `pan=mono|c0<2*c0+c1`.
`aformat=channel_layouts=mono` (or `aformat=cl=mono`) downmixes stereo by
averaging left and right samples, or preserves mono input. Other `aformat`
options and layouts are not supported.
These filters also work in labeled single-input audio graphs with `-map`.
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
ASS and SRT conversion preserves cue text and timing; ASS output uses a default style and centisecond timestamps. ASS input decodes line breaks and removes positioning/style overrides.
SRT-to-WebVTT conversion removes ASS override blocks and converts `\N` and `\n` to line breaks; `-c:s copy` preserves the original cue text.

`ffprobe` uses the same audio/video implementation as `@poe-platform/safe-bash/commands/ffprobe`, with default limits of 32 MiB input and 1 MiB output. Pass `limits` to override them.

## Features

- **Dynamic AST-Driven Format Support**: Pass `asts: [...]` to `ffmpegCommands({ asts })` to dynamically determine which container formats, extensions, demuxers, muxers, and codecs are supported by `ffmpeg` and `ffprobe`.
- **Video Merging & Concatenation**: Supports `-f concat -safe 0 -i list.txt -c copy`, `concat:clip1.mp4|clip2.mp4`, and `-filter_complex "concat=n=2:v=1:a=1"`. Manifests beginning with the exact `ffconcat version 1.0` signature are detected without `-f concat`. By default (or with `-safe 1`), concat filenames must be relative paths using ASCII letters, digits, underscores, hyphens, and periods, with no component starting with a period; `-safe 0` permits other filenames. Safe mode also rejects manifest `option` directives. Manifest `duration` sets the next segment’s timeline start without trimming samples; use `inpoint`/`outpoint` to trim. WAV concat retains the entire PCM packet that starts before `outpoint`. A missing later concat segment logs an error and preserves media already read; `-xerror` also makes the exit status nonzero. A missing first segment fails without creating output.
- **Trimming, Muxing & Faststart**: Supports input/output `-ss`, `-to`, `-t` (including lavfi sources), `-map`, `-an`, `-vn`, `-shortest`, `-movflags +faststart`, and `-movflags frag_keyframe+empty_moov`.
- **Filtergraphs & Frame Extraction**: Supports `scale`, `crop`, `pad`, `fps`, `hflip`, `vflip`, `transpose`, `rotate`, `negate`, `drawbox`, `overlay`, `hstack`, `vstack`, and `%03d.png` image sequences with independent input/output `-start_number` values and no default frame ceiling. Input searches five candidate indices from `-start_number` (default 0); `-start_number_range` changes that window. After the first image, the sequence stops at the first gap. Output `-frame_pts 1` names images by presentation timestamps in the output frame time base instead of sequence numbers; `-frame_pts 0` keeps default numbering. `-pattern_type glob` reads matching image paths in sorted order; quote the pattern to keep the shell from expanding it. `-pattern_type none` reads the filename literally, including `%02d`. `-pattern_type sequence` selects the default numbered mode. `select` accepts arithmetic with `n` and `t`, and `eq`, `gt`, `between`, `not`, and `mod` functions; invalid or unsupported expressions fail without replacing output. Image sequences duplicate or drop frames to preserve output cadence after `select` and `setpts`; use `-fps_mode passthrough` (or `-vsync 0`) to write each filtered frame once. `hstack` and `vstack` continue to the longer input by repeating the shorter input’s last frame; set `shortest=1` to stop at the shorter input. `crop` positions accept arithmetic with `iw`, `ih`, `ow`, `oh` (and their `in_w`, `in_h`, `out_w`, `out_h` aliases); unsupported expressions fail without replacing output. `overlay` defaults to even x/y positions on the YUV420 chroma grid; `format=yuv422` aligns only x, while `format=auto`, `format=rgb`, and `format=yuv444` preserve integer positions. `overlay` positions accept arithmetic with `main_w`, `main_h`, `overlay_w`, and `overlay_h` (or `W`, `H`, `w`, and `h`); invalid or unsupported expressions fail without replacing output. `rotate` accepts constant radian angles (including `PI` and arithmetic), keeps the input canvas size, and uses bilinear sampling with black fill. Decoded 8-bit planar YUV frames rotate before RGB conversion; `format=rgba,rotate=...` explicitly selects RGB sampling. `drawbox` width and height accept arithmetic with `iw`, `ih`, `in_w`, and `in_h`; omitted or nonpositive dimensions use the frame size, and invalid expressions fail without replacing output. It blends alpha colors such as `red@0.5` and `0xff000080` over existing pixels. Animated GIF output preserves all frames and their timing; probing reports the full animation. The `smptebars` source produces static SMPTE bars.
- **Consumer-Defined Limits**: Imposes no default limits while offering `cloudflareWorkerLimits()` and opt-in/opt-out feature controls (`features: { videoTranscode, filterGraph, lavfiSources }`).

WAV segment output (`-c copy -f segment part%02d.wav`) writes numbered files at audio packet boundaries, with a default target duration of two seconds. Use `-segment_time 1` to change the target and `-segment_list list.csv` to write filenames and actual start/end times. Segment output currently supports one audio track and WAV filenames. Existing segments and lists require `-y` to overwrite.

`-hls_fmp4_init_filename` sets the separate fMP4 initialization filename and its `EXT-X-MAP` URI (default `init.mp4`, relative to the playlist directory). Single-file HLS keeps initialization in the combined media file. `-hls_time` accepts seconds, `s`/`ms`/`us` units, and `HH:MM:SS` or `MM:SS` durations. Invalid durations fail before writing output. HLS stream-copy segments cut at keyframes, so a long GOP can exceed `-hls_time`; the playlist reports actual segment durations. After a late keyframe, later cuts remain scheduled at multiples of the requested interval (for example, a 3-second interval with keyframes every 2 seconds yields 4/2/3-second segments for a 9-second video). `-hls_flags split_by_time` allows cuts between keyframes and disables the independent-segments declaration. `-hls_list_size` keeps the final N entries (default 5; 0 keeps all) and advances the media sequence. Segment files are preserved unless `-hls_flags delete_segments` is set; deletion retains one expired segment by default. `-hls_delete_threshold N` changes that count, capped by FFmpeg’s playlist-duration retention rule. Unlimited playlists do not delete segments. `-hls_playlist_type vod` or `event` emits the corresponding playlist type and keeps every entry and segment regardless of `-hls_list_size` or `delete_segments`. Language selectors `-map 0:m:language:fra` and `-map 0:a:m:language:fra` select French tracks; omit the language value to match any language tag. Negative `-map` selections remove previously selected streams by input, type, or stream index, and later positive maps can select them again.

Multi-file HLS filename templates must contain a numbered placeholder such as `%d` or `%03d`; `%%` produces a literal percent sign. Invalid templates are rejected before writing output. `-hls_flags` accepts `delete_segments`, `omit_endlist`, `split_by_time`, `independent_segments`, `discont_start`, and `round_durations`, including `+`/`-` combinations. `round_durations` rounds playlist durations to integers instead of six decimal places. `discont_start` inserts `#EXT-X-DISCONTINUITY` immediately before the initial segment’s `#EXTINF`; the marker disappears when that segment leaves the playlist window. Unrecognized flags fail before writing output. `-hls_flags single_file` writes one media file with playlist byte ranges computed from the muxed bytes (MPEG-TS or fMP4, including an initialization range). Its default filename is the playlist basename with `.ts` or `.m4s`; an explicit segment filename is used literally without numbered expansion. Playlist windows retain the complete media file even with `delete_segments`.

`-hls_base_url` prepends its value verbatim to media segment URIs in the playlist without changing local output paths or initialization map URIs.

Explicit `-hls_segment_filename` paths resolve from the working directory; default segments are written beside the playlist. Missing HLS parent directories are created. Existing outputs are preserved with exit status 1 unless `-y` is specified; `-n` explicitly requests preservation.


Both commands resolve local HLS and static DASH segment files from the virtual
filesystem, including fMP4 initialization files, and report the actual media
streams. Missing referenced files fail the command. DASH output (`-f dash` or
`.mpd`) writes the manifest plus `init-stream*.m4s` and `chunk-stream*.m4s` files
beside it. Use `-init_seg_name 'i-$RepresentationID$.mp4'` and
`-media_seg_name 'm-$RepresentationID$-$Number$.m4s'` to customize the names.
Use `-use_template 0` for explicit `SegmentList` output; the default (`1`) retains `SegmentTemplate`.
Use `-use_timeline 0` for fixed-duration templates without a timeline (`-seg_duration` defaults to 5 seconds); `1` retains the default timeline.
DASH input supports a single Period with segment templates, timelines, or segment lists;
HLS input requires an unencrypted media playlist without byte ranges.
Native H.264 inputs decode with CAVLC/CABAC and reference-frame support. `.ogg` output defaults to Vorbis; use `-c:a libopus` or a `.opus` filename for Opus, or `-c:a flac` for lossless Ogg FLAC.
