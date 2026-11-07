# safe-bash-command-ffmpeg

Pure in-memory `ffmpeg` and `ffprobe` commands for `safe-bash`, backed by `@poe-code/mp4-ast` and pluggable media container ASTs (`mp4Ast`, `movAst`, `mkvAst`, `webmAst`, `mpegtsAst`, `aviAst`, `flvAst`, `y4mAst`, `aacAst`, `wavAst`, `auAst`, `cafAst`, `aiffAst`, `mp3Ast`, `flacAst`, `oggAst`, `gifAst`, `image2Ast`). MP3 output retains Xing and gapless playback metadata by default; `-write_xing 0` omits them and `-write_xing 1` explicitly enables them.

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
`ebur128=peak=sample` reports loudness every 100 ms and a final integrated
loudness, loudness range, and sample-peak summary without changing PCM samples.
Plain `ebur128` omits sample peaks; true peaks, video, and metadata options are unsupported.
`atrim=start_sample=2025:end_sample=3123` keeps sample frames 2025 through 3122 unchanged.
Use `atrim=start=0.253:end=0.390` for time bounds in seconds; end bounds are exclusive.
`asetpts=PTS-STARTPTS` resets audio timestamps; `asetpts=PTS+0.5/TB` shifts them by half a second. Output time limits honor shifted audio frame timestamps while preserving the retained PCM samples.
Both forms apply to every channel and may omit either bound.
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

WAV output accepts `-write_bext 1` to write Broadcast Wave metadata (`description`, `originator`, `originator_reference`, `origination_date`, `origination_time`, `time_reference`, and `coding_history`) supplied with `-metadata`. The default and `-write_bext 0` omit the extension.

WAV output accepts `-write_peak on` to append a peak envelope, `-write_peak only` for the envelope without audio, and `-write_peak off` (the default) to omit it. Numeric values `1`, `2`, and `0` are also accepted. Peak envelopes require 16-bit PCM output and use 256-frame blocks with positive and negative peaks per channel.

WAV output accepts `-rf64 always` for RF64 with 64-bit sizes, `-rf64 auto` to reserve a size chunk and use RF64 when RIFF overflows, and `-rf64 never` (the default) for ordinary RIFF.

Read and write Sony Wave64 with `ffmpeg -i input.wav output.w64` or `ffmpeg -i input.w64 -c:a pcm_s16le output.wav`; `-f w64` selects the format explicitly.

Read and write uncompressed AIFF (`.aiff`, `.aif`, or `-f aiff`) with signed 8/16/24/32-bit PCM; output defaults to `pcm_s16be`.

Read and write CAF audio (`.caf` or `-f caf`) with signed 8/16/24/32-bit PCM or 32/64-bit floating-point samples in either byte order. Output defaults to `pcm_s16be`; `-c:a copy` preserves encoded PCM samples.

Read and write Sun AU audio with `ffmpeg -i input.wav output.au` or
`ffmpeg -i input.au -c:a pcm_s16le output.wav`. AU defaults to big-endian PCM16.

Encode mono or stereo IMA ADPCM WAV with `-c:a adpcm_ima_wav output.wav`.

MP3 output supports `-id3v2_version 0|3|4` (default `4`; `0` omits ID3v2) and `-write_id3v1 0|1` (default `0`). Stream copy preserves audio packets while rewriting tags.

Ogg Opus input supports audio filters such as `-af volume=0`, with encoder delay and final padding removed.
WAV extraction decodes Ogg Opus/Vorbis, AAC and CBR/VBR MP3 in memory, honoring MP4 edit timing
and MP3 encoder delay and padding:
`ffmpeg -y -i input.mp4 -vn -c:a pcm_s16le audio.wav`. Corrupt or unsupported
audio fails without replacing an existing output. Audio filters, `-ar`, and `-ac` accept AAC input as well as decoded PCM
input, such as WAV or a `lavfi` source. `[0:a][1:a]amix=inputs=2:duration=shortest:normalize=0[mix]` mixes two decoded PCM inputs with matching sample rates and channel layouts. `duration` accepts `longest` (default), `shortest`, or `first`; `weights` sets input gains, and `dropout_transition` controls normalization after an input ends (default 2 seconds, 0 for an immediate change). WAV PCM dropout transitions follow native frame boundaries. Single-input filters before amix are not supported. `[0:a][1:a]acrossfade=ns=2000[mix]` crossfades matching decoded PCM inputs with triangular fades. Use `d` for duration in seconds or `o=0` for sequential fades without overlap. The transition must fit both inputs; other curves and single-input filters before acrossfade are rejected. Labeled single-input audio chains in `-filter_complex` resolve input stream selectors and linked labels, then apply the filters selected by `-map "[label]"`. Unsupported audio filters fail without writing unfiltered output. Audio filters run in chain order; each
`atempo` stage processes the preceding stage’s samples, including `areverse`.
`compand=attacks=0:decays=0:points=-80/-80|-40/-40|-20/-30|0/-20` applies a dB transfer curve to PCM without changing its length. Per-channel attack/decay times, soft knees, output gain, and initial volume are supported; nonzero delay is rejected.
`anull` passes audio through unchanged, alone or in a filter chain.
`[0:a][1:a]join=inputs=2:channel_layout=stereo:map=1.0-FL|0.0-FR[mix]`
routes the second input's first channel to left and the first input's first channel
to right, stopping at the shorter input. Join supports two decoded PCM inputs with
matching sample rates, stereo output, and an explicit map of numeric input channels
to both `FL` and `FR`. Filters after join are supported; filters before join,
other layouts, and implicit channel selection are rejected.
`acompressor=threshold=0.1:ratio=4:attack=1:release=20` compresses changing PCM levels
with attack and release in milliseconds. It supports soft knees, peak/RMS detection,
average/maximum channel linking, upward/downward modes, input gain, makeup and wet/dry mix.

`axcorrelate` computes per-channel cross-correlation from two PCM inputs with matching
sample rates and channel layouts, stopping at the shorter input. For example,
`[0:a][1:a]axcorrelate=size=128:algo=slow[mix]`. `size` accepts 2–131072 samples
(default 256); `algo` accepts `slow`, `fast` (assumes zero means), or `best`
(default). Windows look forward and use silence past each input's end. Filters
can follow axcorrelate; preceding single-input filters are rejected.

`sidechaingate` uses the second audio input to gate the first, stopping at the shorter
input. For example, `[0:a][1:a]sidechaingate=threshold=0.1:ratio=8:attack=1:release=20[mix]`
attenuates the program when the control signal becomes quiet. Supports `range`,
`knee`, `detection=peak|rms`, `link=average|maximum`, `mode=downward|upward`,
`level_in`, `level_sc`, and `makeup`; the control input can have a different channel count.
Inputs must share a sample rate. Filters after the gate are supported; filters before
the gate are currently unsupported.

`sidechaincompress` uses a second audio input to control compression of the first,
for example `[0:a][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=1:release=20[mix]`.
Output retains the first input’s channels and ends with the shorter input. Inputs
must have matching sample rates; preceding filters other than `anull` are unsupported.

`dynaudnorm=f=100:g=5:p=0.5` normalizes changing PCM levels with smoothed frame gains and coupled channels. Supports frame length (`f`/`framelen`), Gaussian window (`g`/`gausssize`), peak (`p`/`peak`), and maximum gain (`m`/`maxgain`); other options fail explicitly.

`afade=t=in:ss=1000:ns=2000` fades PCM without changing its length. Fade out with `t=out`; use `st`/`d` for timing in seconds or `ss`/`ns` for sample counts. Linear (`tri`, default) and quadratic (`qua`) curves support fractional `silence` and `unity` gains. Long option names are also accepted.

`apad=pad_len=19` appends 19 silent samples per channel; `whole_len=16100` pads only until the minimum sample count is reached. `pad_dur` and `whole_dur` accept durations in seconds. Infinite padding and combining padding with a minimum length are rejected.
`silencedetect=noise=-40dB:d=0.1` reports silence starts, ends, and durations on stderr without changing PCM. Add `:mono=1` to measure each channel separately; trailing silence closes at end of input.
`volumedetect` reports interleaved sample count, mean volume, and maximum volume
in dB on stderr, measuring audio after preceding filters without changing PCM samples.
`astats` (also `astats=metadata=0:reset=0`) reports per-channel and overall peak/RMS
levels in dB and the overall sample count on stderr without changing PCM samples.
Metadata injection, periodic resets, and other statistics options are not supported.
`extrastereo=m=0` averages left and right while retaining stereo; `m=-1` swaps them.
The width multiplier defaults to 2.5 (range -10 to 10); `c=0` disables clipping.
`stereotools` supports stereo channel mute (`mutel`, `muter`), phase inversion
(`phasel`, `phaser`), and all `mode` channel conversions, including `lr>ms` and
`ms>lr`. For example, `-af stereotools=mutel=1` silences only the left channel.
Other stereotools options are rejected.
`crossfeed=strength=0.5` applies frequency-dependent headphone crossfeed to stereo audio.
Strength and range default to 0.2 and 0.5 (0–1); slope defaults to 0.5 (0.01–1).
`level_in` and `level_out` default to 0.9 and 1 (0–1).
`crossfeed=strength=0:level_in=1:level_out=1` preserves every sample.
Block processing (`block_size`) is unsupported.
`stereowiden=delay=5:feedback=0.3:crossfeed=0.3:drymix=0.8` widens stereo
with delayed cross-channel subtraction. Delay is in milliseconds (1–100, default 20);
feedback (0–0.9), crossfeed (0–0.8), and drymix (0–1) default to 0.3, 0.3, and 0.8.
Setting `feedback=0:crossfeed=0:drymix=1` preserves the input samples.
`haas` applies the default stereo enhancer: the channel average plus a 2.05 ms
delayed tap on the right and minus a 2.12 ms delayed tap on the left. It preserves
the sample rate and frame count. Custom Haas options are not supported.
`earwax` applies the headphone stereo filter to 44100 Hz stereo input, preserving
the frame count with native signed 16-bit filtering and clipping. Other input
rates and channel counts are rejected.

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
Use `-ch_layout mono` or `-channel_layout mono` for mono output, equivalent to `-ac 1`. Other output layouts are not supported by these options.
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
`0`, `1`, `default`, `+default`, `-default`, and `attached_pic`. Other disposition values fail explicitly.
For FLAC cover art, map the audio and PNG/JPEG inputs with `-map 0:a -map 1:v -c copy -disposition:v:0 attached_pic`; unmarked video streams are omitted.
`-map_chapters -1` removes output chapters; `-map_chapters N` copies chapters from input N. FFmetadata export preserves imported chapter time bases, including sample-accurate boundaries.
`xfade` supports the default `fade` and `transition=wipeleft`; other transitions fail
without creating or replacing output.
`trim` supports `start`, `end`, `duration`, `start_frame`, and `end_frame`; frame
numbers are zero-based and the end frame is excluded. Unsupported trim options fail
without replacing output.
Burned SRT captions use bitmap lettering and bottom spacing that scale with video height.
MicroDVD input (`-f microdvd` or automatic detection) uses the declared frame rate and converts `|` to line breaks; `-c:s copy -f microdvd` preserves caption frame numbers and text.
LRC lyrics support explicit `-f lrc` and automatic detection, infer cue ends from the next timestamp, and write each subtitle line with its own centisecond timestamp.

SubViewer input (`-f subviewer` or detected `.sub` timecodes) preserves centisecond timing, skips information headers, and converts `[br]` to line breaks.
ASS and SRT conversion preserves cue text and timing; ASS output uses a default style and centisecond timestamps. ASS input decodes line breaks and removes positioning/style overrides.
SRT-to-WebVTT conversion removes ASS override blocks and converts `\N` and `\n` to line breaks; `-c:s copy` preserves the original cue text.

`ffprobe` uses the same audio/video implementation as `@poe-platform/safe-bash/commands/ffprobe`, with default limits of 32 MiB input and 1 MiB output. Pass `limits` to override them.

## Features

- **Dynamic AST-Driven Format Support**: Pass `asts: [...]` to `ffmpegCommands({ asts })` to dynamically determine which container formats, extensions, demuxers, muxers, and codecs are supported by `ffmpeg` and `ffprobe`.
- **Video Merging & Concatenation**: Supports `-f concat -safe 0 -i list.txt -c copy`, `concat:clip1.mp4|clip2.mp4`, and `-filter_complex "concat=n=2:v=1:a=1"`. Manifests beginning with the exact `ffconcat version 1.0` signature are detected without `-f concat`. By default (or with `-safe 1`), concat filenames must be relative paths using ASCII letters, digits, underscores, hyphens, and periods, with no component starting with a period; `-safe 0` permits other filenames. Safe mode also rejects manifest `option` directives. Manifest `duration` sets the next segment’s timeline start without trimming samples; use `inpoint`/`outpoint` to trim. WAV concat retains the entire PCM packet that starts before `outpoint`. A missing later concat segment logs an error and preserves media already read; `-xerror` also makes the exit status nonzero. A missing first segment fails without creating output.
- **Trimming, Muxing & Faststart**: Supports input `-itsoffset` and output `-output_ts_offset` to shift timestamps (seconds, duration strings, or `ms`/`us` units), input/output `-ss`, `-to`, `-t` (including lavfi sources), input `-itsscale[:stream_specifier]` to scale packet timestamps while preserving packet durations, input `-sseof` with a negative offset from the end (for example, `-sseof -0.125 -i in.wav` keeps the last 125 ms), `-map`, `-an`, `-vn`, `-shortest`, `-movflags +faststart`, and `-movflags frag_keyframe+empty_moov`.
- **Filtergraphs & Frame Extraction**: Supports `scale`, `crop`, `pad`, `fps`, `hflip`, `vflip`, `transpose`, `rotate`, `negate`, `drawbox`, `overlay`, `hstack`, `vstack`, and `%03d.png` image sequences with independent input/output `-start_number` values and no default frame ceiling. Input searches five candidate indices from `-start_number` (default 0); `-start_number_range` changes that window. After the first image, the sequence stops at the first gap. Output `-frame_pts 1` names images by presentation timestamps in the output frame time base instead of sequence numbers; `-frame_pts 0` keeps default numbering. `-pattern_type glob` reads matching image paths in sorted order; quote the pattern to keep the shell from expanding it. `-pattern_type none` reads the filename literally, including `%02d`. `-pattern_type sequence` selects the default numbered mode. `select` accepts arithmetic with `n` and `t`, and `eq`, `gt`, `between`, `not`, and `mod` functions; invalid or unsupported expressions fail without replacing output. Image sequences duplicate or drop frames to preserve output cadence after `select` and `setpts`; use `-fps_mode passthrough` (or `-vsync 0`) to write each filtered frame once. `hstack` and `vstack` continue to the longer input by repeating the shorter input’s last frame; set `shortest=1` to stop at the shorter input. `crop` positions accept arithmetic with `iw`, `ih`, `ow`, `oh` (and their `in_w`, `in_h`, `out_w`, `out_h` aliases); unsupported expressions fail without replacing output. `overlay` defaults to even x/y positions on the YUV420 chroma grid; `format=yuv422` aligns only x, while `format=auto`, `format=rgb`, and `format=yuv444` preserve integer positions. `overlay` positions accept arithmetic with `main_w`, `main_h`, `overlay_w`, and `overlay_h` (or `W`, `H`, `w`, and `h`); invalid or unsupported expressions fail without replacing output. `rotate` accepts constant radian angles (including `PI` and arithmetic), keeps the input canvas size, and uses bilinear sampling with black fill. Decoded 8-bit planar YUV frames rotate before RGB conversion; `format=rgba,rotate=...` explicitly selects RGB sampling. `drawbox` width and height accept arithmetic with `iw`, `ih`, `in_w`, and `in_h`; omitted or nonpositive dimensions use the frame size, and invalid expressions fail without replacing output. It blends alpha colors such as `red@0.5` and `0xff000080` over existing pixels. Animated GIF output preserves all frames and their timing; probing reports the full animation. The `smptebars` source produces static SMPTE bars.
- **Consumer-Defined Limits**: Imposes no default limits while offering `cloudflareWorkerLimits()` and opt-in/opt-out feature controls (`features: { videoTranscode, filterGraph, lavfiSources }`).

WAV segment output (`-c copy -f segment part%02d.wav`) writes numbered files at audio packet boundaries, with a default target duration of two seconds. Use `-segment_time 1` to change the target and `-segment_list list.csv` to write filenames and actual start/end times. Segment output currently supports one audio track and WAV filenames. Existing segments and lists require `-y` to overwrite.

`-hls_fmp4_init_filename` sets the separate fMP4 initialization filename and its `EXT-X-MAP` URI (default `init.mp4`, relative to the playlist directory). Single-file HLS keeps initialization in the combined media file. `-hls_time` accepts seconds, `s`/`ms`/`us` units, and `HH:MM:SS` or `MM:SS` durations. Invalid durations fail before writing output. HLS stream-copy segments cut at keyframes, so a long GOP can exceed `-hls_time`; the playlist reports actual segment durations. After a late keyframe, later cuts remain scheduled at multiples of the requested interval (for example, a 3-second interval with keyframes every 2 seconds yields 4/2/3-second segments for a 9-second video). `-hls_flags split_by_time` allows cuts between keyframes and disables the independent-segments declaration. `-hls_list_size` keeps the final N entries (default 5; 0 keeps all) and advances the media sequence. Segment files are preserved unless `-hls_flags delete_segments` is set; deletion retains one expired segment by default. `-hls_delete_threshold N` changes that count, capped by FFmpeg’s playlist-duration retention rule. Unlimited playlists do not delete segments. `-hls_playlist_type vod` or `event` emits the corresponding playlist type and keeps every entry and segment regardless of `-hls_list_size` or `delete_segments`. Language selectors `-map 0:m:language:fra` and `-map 0:a:m:language:fra` select French tracks; omit the language value to match any language tag. Negative `-map` selections remove previously selected streams by input, type, or stream index, and later positive maps can select them again.

Multi-file HLS filename templates must contain a numbered placeholder such as `%d` or `%03d`; `%%` produces a literal percent sign. Invalid templates are rejected before writing output. `-hls_flags` accepts `delete_segments`, `omit_endlist`, `split_by_time`, `independent_segments`, `discont_start`, and `round_durations`, including `+`/`-` combinations. `round_durations` rounds playlist durations to integers instead of six decimal places. `discont_start` inserts `#EXT-X-DISCONTINUITY` immediately before the initial segment’s `#EXTINF`; the marker disappears when that segment leaves the playlist window. Unrecognized flags fail before writing output. `-hls_flags single_file` writes one media file with playlist byte ranges computed from the muxed bytes (MPEG-TS or fMP4, including an initialization range). Its default filename is the playlist basename with `.ts` or `.m4s`; an explicit segment filename is used literally without numbered expansion. Playlist windows retain the complete media file even with `delete_segments`.

`-hls_base_url` prepends its value verbatim to media segment URIs in the playlist without changing local output paths or initialization map URIs.

Explicit `-hls_segment_filename` paths resolve from the working directory; default segments are written beside the playlist. Missing HLS parent directories are created. Existing outputs are preserved with exit status 1 unless `-y` is specified; `-n` explicitly requests preservation.


Both commands resolve local HLS and static DASH segment files from the virtual
filesystem, including fMP4 initialization files, and report the actual media
streams. HLS skips local media segments with disallowed file extensions before reading them; disallowed initialization files fail. Put `-allowed_extensions mp4,m4s,txt` before `-i` to replace the default media extension list for that input, or use `ALL` to allow any extension. Missing DASH media fragments are skipped when initialization is available,
preserving surviving packet timestamps; missing initialization files and other read errors fail the command. DASH output (`-f dash` or
`.mpd`) writes the manifest plus `init-stream*.m4s` and `chunk-stream*.m4s` files
beside it. Use `-init_seg_name 'i-$RepresentationID$.mp4'` and
`-media_seg_name 'm-$RepresentationID$-$Number$.m4s'` to customize the names.
Use `-frag_type every_frame` for one fragment per frame inside each media segment, keeping `-seg_duration` unchanged; `none` (default) writes one fragment per segment.
Use `-use_template 0` for explicit `SegmentList` output; the default (`1`) retains `SegmentTemplate`.
Use `-use_timeline 0` for fixed-duration templates without a timeline (`-seg_duration` defaults to 5 seconds); `1` retains the default timeline.
Use `-remove_at_exit 1` to delete the generated manifest and media files when output finishes; the default (`0`) preserves them.
Use `-window_size N` to retain the last N segments per representation in timelines and lists, with their original segment numbers; `0` (default) retains all. Fixed-duration templates keep their full presentation.
Use `-single_file 1` to write `<manifest>-stream<N>.mp4` per representation and a `SegmentList` with initialization, media, and index byte ranges.
`-adaptation_sets "id=0,streams=a id=1,streams=v"` groups output streams into explicit
adaptation sets. Select streams by `a`, `v`, or comma-separated output stream indices;
each stream must belong to exactly one set of the same media type.
Use `-hls_playlist 1` with DASH output to write `master.m3u8` and per-stream `media_N.m3u8` playlists alongside the MPD, sharing its media resources.
DASH input supports a single Period with segment templates, timelines, or segment lists without byte ranges.
Stream copy preserves relative audio/video timing, including AAC priming, and follows native DASH packet scheduling through EOF;
HLS input supports clear and AES-128 encrypted media playlists (local 16-byte keys admitted by `-allowed_extensions`, explicit or media-sequence IVs, and clear initialization segments) with complete segment files or media and initialization byte ranges, including implicit offsets for consecutive ranges in the same media file.
Native H.264 inputs decode with CAVLC/CABAC and reference-frame support. FLAC output accepts `-metadata_header_padding` to reserve padding bytes (`0` removes padding, `-1` selects 8192 bytes); stream copy preserves compressed audio. FLAC encoding accepts `-sample_fmt s16` for explicit 16-bit conversion and `-sample_fmt s32` for 24-bit output. FLAC encoding accepts `-compression_level 0` through `12` (`-1` selects level 5), increasing fixed-predictor search effort while preserving exact 16-bit or 24-bit PCM; compressed bytes may differ from native FFmpeg. FLAC trimming re-encodes exact samples while preserving 16-bit or 24-bit precision; `-c copy -t` and `-c copy -frames:a` retain whole compressed packets. Ogg output accepts `-serial_offset` (0 through 2147483647) to number logical streams consecutively; `-fflags +bitexact` starts numbering at zero unless an offset is supplied. Ogg-to-Ogg `-c copy` preserves Opus or Vorbis packets and metadata without decoding; Opus `-t` copy retains whole packets. `-page_duration` sets the target page duration in integer microseconds for Opus copy and Opus/Vorbis encoding (default `1000000`); `20000` writes one page per 20 ms Opus packet, and `0` disables duration-based flushing. Pages also flush at the Ogg lacing limit. `.ogg` output defaults to Vorbis; use `-c:a libopus` or a `.opus` filename for Opus, or `-c:a flac` for lossless Ogg FLAC. Opus encoding honors `-b:a` in bits per second, including `k` and `M` suffixes (for example, `-b:a 128k`).

`dialoguenhance` extracts dialogue from stereo into a third (front center) channel,
retaining the input frame count and sample rate. Left and right are delayed by
three quarters of the analysis window (1536 samples at 44100 Hz). It accepts
`original` (0–1), `enhance` (0–3), and `voice` (2–32), with defaults `1:1:2`.

`speechnorm=p=0.5` adjusts PCM half-wave gains, limiting loud sections and gradually restoring gain in quiet sections. Supports peak (`p`/`peak`), expansion (`e`/`expansion`), compression (`c`/`compression`), threshold (`t`/`threshold`), and gain adjustment (`r`/`raise`, `f`/`fall`). Channels are processed independently; other options fail explicitly.

`alimiter=limit=0.25:level=0:latency=1` limits PCM peaks with linked channels, lookahead attack, and gradual release. `latency=1` preserves sample positions and drains the delayed tail; the default retains the lookahead delay. Supports `level_in`, `level_out`, `limit`, `attack`, `release`, and automatic output leveling (`level`). Automatic release (`asc=1`) is unsupported and fails explicitly.

`[0:a][1:a]amultiply[out]` multiplies corresponding PCM samples from two inputs
with matching sample rates and channel layouts, ending with the shorter input.
Single-input filters before `amultiply` are not supported.

`[0:a][1:a]amerge=inputs=2[out]` merges two mono inputs at the same sample rate
into stereo, in input order, ending with the shorter input. `amerge` defaults to
two inputs; filters after the merge are supported. Other input layouts and
filters before the merge are currently unsupported.

`[0:a][1:a]astreamselect=inputs=2:map=1[out]` selects the second decoded PCM
input, preserving its channels and samples and ending with the shortest input.
Inputs must share a sample rate. `inputs` defaults to two; `map` must select one
input. Filters after selection are supported; multiple output selections and
filters before selection are currently unsupported.

Use `-frames:s N` to retain at most N subtitle cues per output stream without shortening their intervals; `0` emits no cues.

Use `-fix_sub_duration` before an input to shorten overlapping subtitle events during transcoding. Each event ends no later than the next event starts; the final buffered event is omitted, matching FFmpeg 7.0.2. Stream copy retains the original events.
