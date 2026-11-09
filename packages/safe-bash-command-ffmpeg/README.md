# safe-bash-command-ffmpeg Headerless `-f rawvideo` output preserves YUV420 planes and supports packed `rgb24`, `bgr24`, and `rgba` via `-pix_fmt`; `-c:v copy` retains original packet bytes, including AVI row padding.

Headerless RGB and YUV420 input supports `-f rawvideo -pixel_format rgb24 -video_size WIDTHxHEIGHT -framerate FPS` (use `-pixel_format yuv420p` for YUV420; also `-pix_fmt`, `-s`, and `-r` before `-i`). Stream copy preserves partial final packets; decoding emits complete frames only.

Pure in-memory `ffmpeg` and `ffprobe` commands for `safe-bash`, backed by `@poe-code/mp4-ast` and pluggable media container ASTs (`mp4Ast`, `movAst`, `mkvAst`, `webmAst`, `mpegtsAst`, `aviAst`, `flvAst`, `y4mAst`, `aacAst`, `ac3Ast`, `wavAst`, `auAst`, `ircamAst`, `cafAst`, `aiffAst`, `mp3Ast`, `flacAst`, `oggAst`, `gifAst`, `image2Ast`). Targa output (`.tga` or `-c:v targa`) preserves RGBA pixels with top-left origin; RLE is enabled by default (`-rle 1`), and `-rle 0` writes uncompressed pixels. MP3 output retains Xing and gapless playback metadata by default; `-write_xing 0` omits them and `-write_xing 1` explicitly enables them. ICO and CUR inputs expose each PNG- or DIB-backed entry as a separate video stream, preserving transparency. FFmpeg selects the largest image automatically; use `-map 0:v:1` to select the second entry. AVI output supports `-reserve_index_space` in bytes per stream; zero uses the default reservation. H.264 stream copies from Matroska to AVI require `-bsf:v h264_mp4toannexb`; MP4 inputs convert automatically.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { ffmpegCommands, cloudflareWorkerLimits } from "@poe-platform/safe-bash/commands/ffmpeg";

const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(ffmpegCommands({ limits: cloudflareWorkerLimits() }));
await shell.exec("ffmpeg -f lavfi -i color=c=red:s=16x16:r=2:d=1 -an /clip.mp4");
const probe = await shell.exec("ffprobe -show_streams -of json /clip.mp4");
await shell.dispose();
```

MPEG-TS program maps (`-map 0:p:202`) select streams by program ID; `-map 0:p:202:a:0` selects the first audio stream in that program. Missing programs fail unless the map ends in `?`.

MP4/MOV output `-streamid 0:21 -streamid 1:43 -use_stream_ids_as_track_ids 1` assigns track IDs to output stream ordinals after mapping. Without the muxer switch, IDs remain sequential starting at 1; with it, unassigned streams use ID 0. Options apply only to the next output.

AAC decoding retains the complete final frame, including samples beyond the container duration; explicit `-t`/`-to` limits still trim PCM at the requested sample. Audio stream copy keeps the full last packet selected by input or output `-t`/`-to`, so its end can exceed the requested cutoff. Output `-ss` with PCM WAV stream copy drops packets that start before the seek time, including in segmented output; segment lists retain the actual packet timestamps. Use `-map 0:a -c copy -f tee 'one.wav|two.wav'` to duplicate mapped audio into multiple destinations. Tee requires explicit maps; `[select=1:f=wav]one.wav` selects the second mapped output stream. Destination options support `f`, `select` (stream index or type selector), and `onfail=ignore|abort`; ignored failures are logged, and at least one destination must succeed.

MP4/MOV output `-video_track_timescale N` sets the video time base to `1/N`, rescaling packet timestamps, durations, and edit offsets while preserving stream-copy packet bytes. `0` keeps the default. `-map 0:1 -c copy -f data output.bin` writes the selected stream’s packet payloads without a container header; the data muxer requires exactly one stream and also supports stdout. Data stream maps (`-map 0:d` or `-map 0:d:0`) select timecode tracks; output container support still applies. Video-only stream maps such as `-map 0:v -c copy` retain the source video's timecode track and link. `-map 0 -dn -c copy` suppresses copying input data streams while retaining the video’s linked timecode for MP4/MOV output. `-write_tmcd 0` disables timecode output; `-write_tmcd 1` (or the automatic default, `-1`) preserves it when present.

Subtitle `-bsf:s mov2textsub` removes the two-byte text length and trailing style data from each packet; `text2movsub` prepends the two-byte length without changing text or markup. Both preserve packet timestamps, durations, and gap packets and can be chained with `null`.

Bitstream filters (`-bsf[:stream_specifier]`) support `null` and chains of `null`. `-bsf:v` also supports H.264 `filter_units=remove_types=6` (pipe-separated types and inclusive ranges) and `h264_metadata=aud=insert` and `h264_metadata=level=4.1:colour_primaries=1` (rewriting configuration and in-band sequence parameters), applied in chain order. `-bsf:v` and `-bsf:a` support `chomp` to strip trailing zero bytes from each packet while preserving timestamps and duration. They also support `noise=drop=EXPR` with packet index `n` (starting at zero), for example `noise=drop=gte(n\,2)` to keep the first two packets. Positive results drop packets; zero keeps the original bytes and timestamps without adding noise. Negative probabilistic drop values are unsupported. Audio `pcm_rechunk=n=8:p=0` repackets interleaved PCM into eight-sample packets, keeping a short final packet; `p=1` (the default) pads the last packet with zero bytes. The default packet size is 1024; `nb_out_samples` and `pad` are aliases for `n` and `p`. `setts=ts=TS+200:duration=10` changes packet timestamps and duration in stream time-base units while preserving payloads. `pts` and `dts` expressions override the shared `ts` expression; expressions support `N`, `TS`, `PTS`, `DTS`, `DURATION`, `STARTPTS`, `STARTDTS`, `TB`, and `SR`. Filters run in chain order, including after PCM rechunking. Unsupported filters, options, and empty chain entries fail before replacing output.

Output `-aspect[:stream_specifier] RATIO` sets the display aspect ratio (for example, `16:9` or `1.7777778`). With MP4 stream copy, it updates pixel-aspect metadata without changing encoded dimensions or packet bytes. Use `-aspect:v:1 1:1` to target only the second output video stream.

Input `-display_rotation[:stream_specifier] ANGLE` overrides matching video streams before mapping; for example, `-display_rotation:v:0 90 -i clip.mp4` rotates the first input video. Unmatched selectors leave orientation unchanged. Input `-display_hflip[:stream_specifier]` and `-display_vflip[:stream_specifier]` set horizontal and vertical display reflections without changing stream-copy sample bytes. They combine with `-display_rotation` before mapping and apply only to the next input. Like FFmpeg 7, `-metadata:s:v:0 rotate=90` does not change the display matrix; use `-display_rotation` before the input to override orientation.

Register the plugin explicitly; importing it does not enable commands. Media I/O
uses the shell's virtual filesystem and byte streams. Input accepts `/dev/stdin`
and `/dev/fd/0`; output accepts `/dev/stdout` and `/dev/fd/1`, alongside `-`
and `pipe:` aliases. Shell and media input limits count bytes cumulatively across
stdin chunks, media files, playlists, image sequences, and subtitles. The portable command bundle
requires no Node builtins and supports browser and Worker runtimes. These commands
implement the listed AST capabilities, not every native FFmpeg codec or option.
The `ass` filter burns in ASS captions, for example `-vf ass=captions.ass`, using the same timed bitmap text renderer as `subtitles`.

The `subtitles` filter also reads embedded text tracks from media containers, including MKV SubRip and MP4 mov_text; use `si` or `stream_index` to select a stream.

The `subtitles` filter supports `force_style` overrides for `PrimaryColour`
(ASS `&HAABBGGRR`, with inverted alpha) and `Alignment` (libass SSA alignment
bits). For example, `subtitles=captions.srt:force_style='PrimaryColour=&H000000FF,Alignment=8'`
burns red captions at the left-center of the frame. Other style fields are not implemented.
The `lavfi` color source uses FFmpeg 7's limited-range BT.601 RGB samples: red
becomes `(253, 0, 0)` in PNG output; existing RGB PNG inputs retain their samples.
Use `-abort_on empty_output` to fail with status 234 when processing produces no
media frames in any output file. An output with both empty and nonempty streams
remains valid. Empty outputs remain valid without this flag.
Use `-abort_on empty_output_stream` to fail with status 234 when any mapped output
stream has no frames, even if other streams contain media. The diagnostic identifies
each empty output stream.
Combine abort flags with `+`, or use numeric masks: `0` disables checks, `1`
checks empty outputs, `2` checks empty streams, and `3` enables both checks.
With explicit `-n`, refusing an existing output returns status 0, matching FFmpeg
7.0.2, while reporting the refusal and preserving the file. Use `-y` to replace it.
Use `-max_error_rate N` to set the decoder failure threshold (default `2/3`);
exceeding it returns status 69 after writing output. Error accounting matches
FFmpeg 7.0.2: partial decode failures have rate 0, wholly failed decoding has rate 1.
`-xerror` still fails on individual errors; stream copy does not decode.
For output seeking with `-ss` and `-c:v copy`, `-copyinkf` retains initial non-key
video packets from the requested start. Their compressed payloads are preserved;
frames before the next keyframe may not be independently decodable.
Use `-progress pipe:1` for a machine-readable completion record on stdout,
`-progress pipe:2` for stderr, or `-progress report.txt` for a file in the virtual
filesystem. Records include
`out_time` and `progress=end`. Video outputs also report `frame`, `fps`, and
`stream_<output>_<stream>_q`; audio-only outputs omit these video fields. Single-file outputs report `total_size` in bytes and
`bitrate` in kbits/s; null output keeps both fields at `N/A`. `-nostats` is accepted and leaves these records enabled.
Progress emits a final record after processing. `speed` reports processed media seconds per elapsed second with an `x` suffix, or `N/A` when either duration is zero.
`ebur128=peak=sample` reports loudness every 100 ms and a final integrated
loudness, loudness range, and sample-peak summary without changing PCM samples.
Plain `ebur128` omits sample peaks; true peaks, video, and metadata options are unsupported.
`loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json` normalizes mono or stereo
samples and reports measured input/output loudness, peaks, range, and thresholds.
Use `-ar 48000` to resample its 192 kHz output. Supports `I`, `TP`, `LRA`
(and lowercase aliases), plus `print_format=none|json|summary`; two-pass measured
options and multichannel layouts are unsupported. Short clips use peak-constrained
linear gain; longer clips use smoothed loudness gain and a linked lookahead limiter.
`atrim=start_sample=2025:end_sample=3123` keeps sample frames 2025 through 3122 unchanged.
Use `atrim=start=0.253:end=0.390` for time bounds in seconds; end bounds are exclusive.
`asetpts=PTS-STARTPTS` resets audio timestamps; `asetpts=PTS+0.5/TB` shifts them by half a second. Output time limits honor shifted audio frame timestamps while preserving the retained PCM samples.
Both forms apply to every channel and may omit either bound.
`compensationdelay=cm=34:mm=3:dry=0:wet=1` delays every channel by the sound travel time for the supplied distance, preserving sample rate and frame count. Supports `mm`, `cm`, `m`, `dry`, `wet`, and `temp` (Celsius), including positional options. Delayed samples start with silence and the tail is trimmed to the original length.

`adelay=0S|1S` delays each audio channel independently and pads with silence.
Use uppercase `S` for sample frames, lowercase `s` for seconds, or no suffix for
milliseconds. `adelay=1S:all=1` repeats the last delay for remaining channels;
without `all=1`, unspecified channels are unchanged.
`asetrate=16000` changes the sample rate without resampling PCM, changing playback speed and duration. Later filters use the new rate; `r` and `sample_rate` are accepted option names.
`format` accepts `monob`, `pal8`, `rgba`, `bgra`, `rgb24`, `bgr24`, `gray`, `gray8`, `ya8` (grayscale with alpha), `rgba64be`, `rgb48be`, `gray16be`, `yuv420p`, `yuv422p`, and `yuv444p`, directly or with `pix_fmts=`, including `|`-separated lists. `monob` uses ordered monochrome dithering, discards alpha, and writes packed 1-bit grayscale PNGs. `pal8` uses FFmpeg’s fixed 256-color palette with error diffusion, discards alpha, and writes 8-bit indexed PNGs. `gray` and `gray8` use full-range BT.601 luminance, discard alpha, and write single-channel grayscale PNGs. The 16-bit formats write 16-bit PNG samples with RGBA, RGB, or grayscale layout respectively, expanding the decoded 8-bit channels. The YUV formats convert to limited-range BT.601 with the selected chroma subsampling and discard alpha before subsequent filters run. Every list entry is validated before output is replaced. Other pixel formats and options (including `color_spaces` and `color_ranges`) are unsupported and fail explicitly.
Default `scale` on decoded H.264 uses native YUV pixels before RGB conversion.
`scale` accepts width/height expressions, including `ow`/`out_w` and `oh`/`out_h` references to the opposite output dimension, and `flags=neighbor`, `bilinear`, `bicubic`, `area`, or `lanczos`. Area averages pixel coverage when reducing and uses bilinear sampling when enlarging.
`force_original_aspect_ratio=decrease|increase` fits the requested bounds; `force_divisible_by=1..256` rounds constrained sizes down or up to multiples (default 1). Divisibility has no effect when aspect fitting is disabled.
Invalid expressions, unsupported flags, and unsupported options fail before replacing output.
`datascope=size=320x240` renders monochrome hexadecimal RGB pixel values for each frame, preserving timing. `s` and positional size are also accepted; the default is `1280x720` (`hd720`). Other datascope options are unsupported.

`untile=3x1` splits contact sheets into frames in row order, including blank cells. It accepts `layout=3x1`, defaults to `6x5`, and requires sheet dimensions divisible by the grid.

`tile=3x1:init_padding=1` leaves the first cell blank before placing input frames. Initial blank cells use the background color and participate in overlap; values at or above the frame capacity are ignored.

`tile=3x1:overlap=1` carries the last frame of each contact sheet into the next sheet. Overlap is capped at one less than `nb_frames` (or the grid capacity); a partial final sheet is padded with the tile background color.

Numbered image output applies `-r` after video filters using CFR frame selection. `setpts` retains frame durations, matching FFmpeg 9; FFmpeg 7 cleared durations and can emit fewer frames. Output `-r` requires automatic or constant-frame-rate sync (`-fps_mode auto` or `cfr`). Combining it with `passthrough`, `vfr`, or `drop` (including legacy `-vsync` equivalents) fails before replacing output files.

`mpdecimate` removes near-duplicate decoded RGB frames using default 8×8 block thresholds against the last retained frame. Use `-fps_mode passthrough` to preserve their original timestamps. Custom mpdecimate options are unsupported.
`decimate=cycle=4` (or `decimate=4`) drops one frame per complete cycle, preferring duplicates and otherwise using scene changes and overlapping 32×32 block differences. The default cycle is 5; supported cycles are 2–25. Incomplete final cycles are retained, and output timestamps use the reduced frame rate. Use `-fps_mode passthrough` to write each retained frame once. Options other than `cycle` are unsupported.

`vectorscope` renders each decoded RGB frame as a 256×256 plot of blue against inverted red, preserving frame timing. The default grayscale mode adds 1/255 intensity per sample and resets for each frame; custom options are unsupported.

`oscilloscope` overlays the default RGB sampling line, component traces, grid, and statistics on each frame, preserving dimensions and timing. It processes decoded RGB pixels; custom oscilloscope options are unsupported.

`waveform` renders each decoded RGB frame as a 256-row red-component waveform monitor, preserving width and timing. It supports the default column, mirrored, intensity-0.04 mode; waveform options are not supported.
Explicit `-f` raw audio output writes headerless `s8`, `u8`, `u16le/be`, `u24le/be`, `u32le/be`, `s16le/be`, `s24le/be`,
`s32le/be`, `f32le/be`, `f64le/be`, `mulaw`, and `alaw` samples, for example
`ffmpeg -i input.wav -f s16le output.pcm`. Explicit encoders and copied audio must match
the output format’s PCM codec; mismatches fail before writing sample data.
Use `-f framehash -format_version 1 -` for version 1 per-packet audio or video hashes;
AC-3 elementary input is detected by its frame headers or selected with `-f ac3`. `-c:a copy -f framemd5 -` hashes the original compressed frames on the native 90 kHz packet clock; AC-3 decoding and encoding are not supported.

`framehash` and `framemd5` default to version 2 and accept `-format_version 1` or `2`.
`framemd5`, `framehash`, and `framecrc` write one row per video frame, with timestamps,
duration, raw pixel byte count, and a digest (MD5, SHA256, or Adler-32 respectively).
`framemd5` and `framehash` report copied streams’ codec extradata sizes and the selected
digest before the stream headers, including ALAC configuration. `framecrc` uses Adler-32
for these headers. PCM output has no extradata header.
For audio, these formats retain PCM packet boundaries after filtering, including the
short final packet, and checksum each packet separately. MP3 inputs are decoded before
filtering, preserving encoder-delay and end-padding trimming in the checksum packets.
`framecrc` includes a `#software` header by default; `-bitexact` or `-fflags +bitexact` omits it without changing packet rows.
For AAC decoded to PCM, audio rows follow decoder frames, skipping priming and
retaining the complete final frame even when the container duration ends earlier.
With `-map 0:s -c:s copy`, they checksum original subtitle packets, retaining style
bytes, blank gap packets, and the source time base. Copied audio checksums retain priming timestamps;
`framecrc` also reports AAC discard flags and skip-sample or trailing-padding side data.

Verify audio streams with `-f hash -` (SHA256), `-f md5 -`, or
`-f crc -` (Adler-32). These hash decoded PCM16 samples, without container
headers; `-f hash -hash sha512 digest.txt` selects another digest and writes a file.
Multiple mapped streams contribute packets in timestamp order to one digest, with
output stream order breaking timestamp ties.
Use `-map 0:a -map 1:a -f streamhash -` for a separate digest per mapped audio
stream, in output order, labeled `0,a,SHA256=...`, `1,a,SHA256=...`, and so on.
With `-c:a adpcm_ima_wav` or `-c:a flac`, stream hashes cover the encoder's compressed packets, excluding container headers, and honor the codec's encoding options.
Video with retained native pixel planes (including YUV420 Y4M input) is also supported: checksums cover frame pixels without container headers, and `streamhash` labels video streams with `v`.
Hash selection supports RIPEMD128, RIPEMD160, RIPEMD256, RIPEMD320, CRC32, MD5, SHA160, SHA224, SHA256, SHA384, SHA512,
SHA512/224, and SHA512/256. `hash` and `streamhash` also support case-insensitive `adler32` selection and emit the native lowercase `adler32` label.
Whole-output and per-stream hashes also accept `-hash murmur3` case-insensitively,
emitting FFmpeg's native 128-bit digest with the lowercase `murmur3` label.
Audio filters and explicit PCM encoders apply before hashing; `-c:a copy` hashes
the encoded audio packets. ADTS AAC stream-copy checksums include the original ADTS
headers and use the native `1/28224000` packet time base; the reported audio sample
rate remains the source sample rate. Use `-vn` to exclude video.
Read headerless samples, including unsigned `u16le/be`, `u24le/be`, and `u32le/be`,
with input format, rate, and channel options:
`ffmpeg -f s16be -ar 8000 -ac 1 -i input.pcm -c:a pcm_s16le output.wav`.
`-ac` requires a complete integer channel count, including hexadecimal (`0x10`) and exponent (`1e1`) forms; malformed values fail before replacing output. Raw input requires a positive count; output `-ac 0` retains the input channel count.
Raw PCM decoding ignores an incomplete trailing frame when complete frames precede it; input containing only an incomplete frame fails. Stream copy preserves all payload bytes.
Input `-sample_rate 8000` also sets the raw PCM sample rate; place it before `-i`.
Channel counts accept stream selectors on input and output: `-ac:a`, `-ac:a:0`, and `-ac:0`. Only matching audio streams change; the last matching option wins. For example, `-i input.wav -ac:a:0 1 output.wav` downmixes the first audio stream to mono.

Input `-ch_layout stereo` or `-channel_layout stereo` sets two channels, equivalent to `-ac 2`; `mono` sets one channel. Place these options before `-i`. Input `-guess_layout_max N` limits channel-layout guessing for unmasked WAV audio to at most N channels. With stereo input, 0 or 1 retains an unknown two-channel layout; 2 guesses stereo. Explicit layouts remain unchanged, and the option resets for each input.
WAV input `-max_size 2049` limits PCM16 mono packets to 2048 bytes after sample alignment. Place it before the affected `-i`; zero (the default) selects automatic packet sizing. This is independent of the output file limit `-fs`.

WAV ID3 `CHAP` frames supply chapter times and nested titles to ffprobe and FFmetadata output; `-map_chapters -1` suppresses them.

WAV input `-ignore_length 1` reads audio through EOF when a recording outgrows its data header. Place it before the affected `-i`; `-ignore_length 0` (the default) honors the declared length.

Quad WAV supports `-ac 1` and `-ac 2`, mixing back speakers into their matching front sides with normalized FFmpeg weights. Stream copy retains all four speakers and the quad channel mask.

Output `-ac 6` upmixes 3.0, 2.1, and quad WAV to 5.1, preserving each named speaker (including LFE) and leaving absent speakers silent.

Output `-ac 1`, `-ac 2`, and `-ac 6` downmix 7.1 WAV to mono, stereo, and 5.1 with normalized FFmpeg speaker weights. Mono and stereo omit LFE; 5.1 retains LFE and folds side speakers into the corresponding back speakers.

Output `-ac 8` expands 5.1(back) and 5.1(side) WAV to 7.1, preserving each named speaker and leaving the missing side or rear pair silent.

Output `-ac 2` downmixes 5.1(back) and 5.1(side) WAV to stereo, mixing center into both sides and each surround into its corresponding side, excluding LFE. Three-channel WAV downmixing with `-ac 1` or `-ac 2` respects the channel mask: 3.0 mixes front center into the output, while 2.1 excludes LFE.
With `-c:v copy`, output `-ss` starts at the next video keyframe, preserving its timestamp gap; input `-ss` retains the preceding keyframe for preroll.
With `-c:a copy`, input `-ss` seeks to the exact sample frame; output `-ss` starts at the next raw packet. Transcoding seeks to the exact sample in either position.

WAV output to stdout uses unknown (`0xffffffff`) RIFF and data lengths; regular files contain finalized lengths. WAV output writes the encoder identification in LIST/INFO even with `-map_metadata -1`. Use `-bitexact` or `-fflags +bitexact` to omit it while preserving user tags and PCM audio.

WAV output accepts `-write_channel_mask 0` and `-write_channel_mask 1`; both preserve the channel mask and speaker order, including 5.1(side), during encoding and stream copy.

WAV output accepts `-write_bext 1` to write Broadcast Wave metadata (`description`, `originator`, `originator_reference`, `origination_date`, `origination_time`, `time_reference`, and `coding_history`) supplied with `-metadata`. The default and `-write_bext 0` omit the extension.

WAV output accepts `-write_peak on` to append a peak envelope, `-write_peak only` for the envelope without audio, and `-write_peak off` (the default) to omit it. Numeric values `1`, `2`, and `0` are also accepted. Peak envelopes require 16-bit PCM output and default to 256-frame blocks with positive and negative peaks per channel. Set `-peak_block_size 0..65536` (0 omits the envelope), `-peak_format 1|2` for byte width, and `-peak_ppv 1|2` for one magnitude or separate positive/negative peaks.

For headerless PCM, place `-skip_initial_bytes N` before `-i` to skip N input bytes before decoding. For example, `-f s16le -ar 8000 -ac 2 -skip_initial_bytes 4 -i input.raw output.wav` skips one stereo frame. The offset applies only to the next input.

WAV output accepts `-rf64 always` for RF64 with 64-bit sizes, `-rf64 auto` to reserve a size chunk and use RF64 when RIFF overflows, and `-rf64 never` (the default) for ordinary RIFF.

Read and write Sony Wave64 with `ffmpeg -i input.wav output.w64` or `ffmpeg -i input.w64 -c:a pcm_s16le output.wav`; `-f w64` selects the format explicitly.

Read QuickTime IMA ADPCM AIFF-C audio (`ima4`) and convert it to PCM; write mono or stereo audio with `-c:a adpcm_ima_qt output.aiff`. Read and write AIFF-C G.711 audio with `-c:a pcm_alaw` or `-c:a pcm_mulaw`. Read and write AIFF-C floating-point audio with `fl32` and `fl64` compression tags (`-c:a pcm_f32be` or `-c:a pcm_f64be`). Read G.711 AIFF-C audio with `alaw` and `ulaw` compression tags. Read and write uncompressed AIFF (`.aiff`, `.aif`, or `-f aiff`) with signed 8/16/24/32-bit PCM. Input widths from 1 to 32 bits use the next whole-byte signed PCM storage size; output defaults to `pcm_s16be`. Select `-c:a pcm_s16le` to write little-endian PCM in AIFF-C (`sowt`). When an input has multiple sound chunks, files decode the last chunk; stdin decodes the first chunk after the audio header.

Read and write CAF audio (`.caf` or `-f caf`) with signed 8/16/24/32-bit PCM or 32/64-bit floating-point samples in either byte order. CAF input and output also support G.711 μ-law (`pcm_mulaw`) and A-law (`pcm_alaw`). QuickTime IMA ADPCM (`adpcm_ima_qt`) CAF input supports decoding and stream copy to CAF or MOV, preserving packet padding. Encode mono or stereo IMA4 with `-c:a adpcm_ima_qt output.caf`; the final packet is padded to 64 frames. Output defaults to `pcm_s16be`; `-c:a copy` preserves encoded PCM samples. Known CAF mono/stereo layouts are retained; quad stream copies use the native FFmpeg 7.0.2 `quad(side)` output layout.

Copy PCM audio into native-readable NUT with `ffmpeg -i input.wav -c copy output.nut`.

Read Creative Voice PCM16 and G.711 audio, including continuation blocks, with
`ffmpeg -i input.voc -c:a pcm_s16le output.wav`; use `-f voc` before `-i` for explicit input selection.
Write VOC with `ffmpeg -i input.wav -c:a pcm_s16le output.voc` or `-f voc`. PCM16 is the default; G.711 encoding and `-c:a copy` are also supported.

Read and write Sun AU audio with `ffmpeg -i input.wav output.au` or
`ffmpeg -i input.au -c:a pcm_s16le output.wav`. AU defaults to big-endian PCM16. Encode mono 16000 Hz audio as G.722 with `-c:a g722 -b:a 64000 -f au output.au`; G.722 AU input also decodes to PCM. Encode mono 8000 Hz audio as little-endian G.726 with `-c:a g726le -b:a 32000 -f au output.au` (32 kbit/s only).
Read native IRCAM PCM16, mu-law, and A-law files by automatic detection or `-f ircam -i input`; stereo channels are preserved.

Encode mono or stereo Yamaha ADPCM WAV with `-c:a adpcm_yamaha output.wav`. Encode mono 8000 Hz PCM to G.726 WAV with `-c:a g726 output.wav` (32 kbit/s by default); `-b:a 16k`, `24k`, `32k`, or `40k` selects the bitrate. Encode mono or stereo Microsoft ADPCM WAV with `-c:a adpcm_ms output.wav`, or decode it to PCM including padded final blocks. Microsoft ADPCM encoding also accepts `-block_size` (32–8192, power of two; default 1024). Encode mono or stereo IMA ADPCM WAV with `-c:a adpcm_ima_wav output.wav`; `-block_size` selects a power-of-two block size from 32 through 8192 bytes (default: 1024). Select `-trellis 1..16` for trellis encoding; `-trellis 0` (the default) uses greedy encoding. Three-channel input defaults to stereo; an explicit output `-ac 3` is rejected.

AIFF output supports `-write_id3v2 0|1` (default `0`) and `-id3v2_version 3|4` (default `4`) to write an embedded ID3 metadata chunk while preserving copied audio.

MP3 output supports `-id3v2_version 0|3|4` (default `4`; `0` omits ID3v2) and `-write_id3v1 0|1` (default `0`). Stream copy preserves audio packets while rewriting tags.

Ogg Opus input supports audio filters such as `-af volume=0`, with encoder delay and final padding removed.
WAV extraction decodes Ogg Opus/Vorbis, AAC and CBR/VBR MP3 in memory, honoring MP4 edit timing
and MP3 encoder delay and padding:
`ffmpeg -y -i input.mp4 -vn -c:a pcm_s16le audio.wav`. Corrupt or unsupported
audio fails without replacing an existing output. Audio filters, `-ar`, and `-ac` accept AAC input as well as decoded PCM
input, such as WAV or a `lavfi` source. `[0:a][1:a]amix=inputs=2:duration=shortest:normalize=0[mix]` mixes two decoded PCM inputs with matching sample rates and channel layouts. `duration` accepts `longest` (default), `shortest`, or `first`; `weights` sets input gains, and `dropout_transition` controls normalization after an input ends (default 2 seconds, 0 for an immediate change). WAV PCM dropout transitions follow native frame boundaries. Single-input filters before amix are not supported. `[0:a][1:a]acrossfade=ns=2000[mix]` crossfades matching decoded PCM inputs with triangular fades. Use `d` for duration in seconds or `o=0` for sequential fades without overlap. The transition must fit both inputs; other curves and single-input filters before acrossfade are rejected. Labeled single-input audio chains in `-filter_complex` resolve input stream selectors and linked labels, then apply the filters selected by `-map "[label]"`. An unlabeled complex audio output is routed to the first destination; later destinations use automatic stream selection. Unsupported audio filters fail without writing unfiltered output. Audio filters run in chain order; each
`atempo` stage processes the preceding stage’s samples, including `areverse`.
Input-side `-ss`, `-t`, and `-to` cut audio before filtering; output-side cuts apply to the filtered samples.
`compand=attacks=0:decays=0:points=-80/-80|-40/-40|-20/-30|0/-20` applies a dB transfer curve to PCM without changing its length. Per-channel attack/decay times, soft knees, output gain, and initial volume are supported; nonzero delay is rejected.

`mcompand` applies FFmpeg’s default five-band companding curve at 48 kHz. Custom quoted band specifications support attack/decay pairs, soft knees, transfer points, crossover frequencies, and initial volume. Crossovers must be below half the sample rate; nonzero delay and gain are rejected.
`anull` and `acopy` pass audio through unchanged, alone or in a filter chain.

`-filter_complex "showwavespic=s=600x240:split_channels=1:colors=white|white" -frames:v 1 waveform.png` renders audio as a single waveform image. Split channels occupy separate rows; the default overlay keeps each channel’s magnitude independent. Labeled audio inputs and mapped image outputs are supported, as are following video filters. Rendering supports linear scaling, scaled drawing, and average (default) or peak sample aggregation; other scaling/drawing modes and preceding audio filters are rejected.
`arealtime` preserves audio samples while pacing frame timestamps at the requested
`speed` (default 1). Its `limit` duration (default 2 seconds) resets pacing across
timestamp discontinuities. Waits honor cancellation and command resource limits.
`deesser=i=0.8:m=0.5:f=0.5` reduces sibilance independently per channel. Intensity (`i`, default 0), maximum deessing (`m`, default 0.5), and frequency (`f`, default 0.5) accept values from 0 to 1. Output mode `s` selects input (`i`/`0`), processed audio (`o`/`1`, default), or removed sibilance (`e`/`2`). Positional options follow `i:m:f:s`.

`adeclick` removes impulsive noise from decoded PCM using autoregressive interpolation.
It accepts `window`/`w`, `overlap`/`o`, `arorder`/`a`, `threshold`/`t`,
`burst`/`b`, and `method`/`m` (`add` or `save`), with native defaults.
`[0:a][1:a]join=inputs=2:channel_layout=stereo:map=1.0-FL|0.0-FR[mix]`
routes the second input's first channel to left and the first input's first channel
to right, stopping at the shorter input. Join supports two decoded PCM inputs with
matching sample rates, stereo output, and an explicit map of numeric input channels
to both `FL` and `FR`. Filters after join are supported; filters before join,
other layouts, and implicit channel selection are rejected.
`agate=threshold=0.05:ratio=4:attack=0.1:release=1` attenuates quiet PCM sections
while preserving sample count and timing. It supports native defaults, range, knee,
attack/release, peak/RMS detection, channel linking, input/makeup gain, and downward/upward modes.

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

`acontrast=contrast=50` applies a nonlinear audio contrast transfer while preserving sample rate, channels, and frame count. Contrast ranges from 0 to 100 (default 33); positional `acontrast=50` is also supported. Zero contrast still applies the native sine transfer.

`tremolo=f=5:d=0.75` modulates PCM volume while preserving sample rate, channels, and frame count. Frequency (`f`, 0.1–20000 Hz) defaults to 5 Hz; depth (`d`, 0–1) defaults to 0.5. Positional `tremolo=5:0.75` is also supported.

`afade=t=in:ss=1000:ns=2000` fades PCM without changing its length. Fade out with `t=out`; use `st`/`d` for timing in seconds or `ss`/`ns` for sample counts. Linear (`tri`, default) and quadratic (`qua`) curves support fractional `silence` and `unity` gains. Long option names are also accepted.

`aselect='not(mod(n,2))'` keeps even-numbered decoded audio frames; `aselect='eq(n,1)'` keeps only the second frame. Frame numbers start at zero. Selected frames retain both channels, partial final frames, and timestamps; WAV output concatenates their samples.

`aloop=loop=2:size=8:start=0` repeats the first eight samples per channel twice, then keeps the remaining samples in order. Positional options (`aloop=2:8:0`) are also accepted. `loop=0` or `size=0` leaves the audio unchanged. Active loops require `start=0` and a finite nonnegative loop count; output duration and memory limits apply before allocation.

`aresample=first_pts=-1600` pads leading silence; positive `first_pts` discards leading samples. Timestamps use the input sample rate, with FFmpeg’s default 1 ms compensation threshold. It also accepts `aresample=clev=0` (or `aresample=center_mix_level=0`) to set the center-channel gain when downmixing. Output `-center_mix_level 0` sets the same gain; values from -32 to 32 are accepted, and all contributing speakers are renormalized. Use `-surround_mix_level 0` (or `aresample=slev=0` / `aresample=surround_mix_level=0`) to remove surround contributions when downmixing 5.1 or 7.1 to mono or stereo; it accepts the same gain range and renormalizes the remaining speakers. Use `-lfe_mix_level 1` (or `aresample=lfe_mix_level=1`) to include the subwoofer when downmixing 5.1 or 7.1 to mono or stereo; the default is zero, and the same gain range and normalization apply. Use `-rematrix_maxval 2` (or `aresample=rematrix_maxval=2`) to raise the maximum coefficient sum for speaker downmixing; values from 0 to 1000 are accepted, with zero selecting the default normalization limit of 1 for PCM16. Use `-rematrix_volume 0.5` (or `aresample=rematrix_volume=0.5`) to scale channel-mix coefficients after normalization and before PCM rounding. Values from -1000 to 1000 are accepted; zero retains the default gain, and negative values normalize the largest coefficient to the reciprocal of their magnitude. Use `-resampler swr` (or `0`) for the default resampler, or `-resampler soxr` (or `1`) for SoXR-compatible 20-bit HQ linear-phase FIR resampling. SoXR uses zero-padded boundaries and rounds the output duration, including very short clips; it ignores SWR-specific filter/window/phase options. Its direct FIR evaluation can differ from native SoXR’s multistage processing and PCM dithering. Use `-ar` to change the output sample rate and `-filter_type blackman_nuttall` to select the Blackman-Nuttall resampling window; `-filter_type kaiser` selects the default Kaiser window. Use `-kaiser_beta 2` to change its sidelobes; values from 2 to 16 are accepted, with a default of 9. Use `-resample_cutoff 0.5` to set the resampling cutoff ratio from 0 to 1; zero selects the default 0.97 for SWR. SoXR uses a default passband of approximately 0.9137 and clamps nonzero values to 0.8–0.995. The codec option `-cutoff` does not change PCM resampling. Use `-phase_shift 0` to interpolate between integer resampling phases; values from 0 to 24 set the phase resolution, with a default of 10. Use `-exact_rational 0` to retain the power-of-two phase count; the default `-exact_rational 1` uses the reduced input/output rate denominator when it fits within that count. Use `-linear_interp 0` to select the lower phase without blending; `-linear_interp 1` keeps the default interpolation between adjacent phases. Set `-filter_size 4` to shorten the resampling filter and change its impulse response; the default is 32, and nonnegative integer sizes are accepted. Very short clips follow FFmpeg’s resampler startup and flush limits, so rate conversion can produce fewer samples or empty output; an unchanged rate preserves all samples. `-swr_flags res` is accepted and preserves equal-rate PCM samples.

`apad=pad_len=19` appends 19 silent samples per channel; `whole_len=16100` pads only until the minimum sample count is reached. `pad_dur` and `whole_dur` accept durations in seconds. Infinite padding and combining padding with a minimum length are rejected.
`showinfo` reports video frame timestamps, durations, dimensions, pixel format, Adler-32 plane checksums, means, and standard deviations on stderr at info log level or above, without changing pixels. Use `showinfo=checksum=0` to omit checksum statistics. It measures the frames at its position in the filter chain; RGB/RGBA images and retained native planar YUV pixels are supported.

`signalstats` measures per-frame Y/U/V levels, saturation, hue, temporal differences, and effective bit depths. Add `stat=brng` to count broadcast-range violations and `out=brng` to highlight them (yellow by default; `color`/`c` selects another color). Read measurements with `signalstats=stat=brng,metadata=print`. RGB inputs convert to limited-range BT.601 YUV444; retained 8-bit planar YUV inputs preserve their sampling. Temporal-outlier (`tout`) and vertical-repetition (`vrep`) modes are unsupported.

`aphasemeter=video=0` measures stereo phase correlation without changing PCM. Read each frame's value with `aphasemeter=video=0,ametadata=mode=print:key=lavfi.aphasemeter.phase:file=phase.txt`. Omit `file` to print at info log level on stderr, or use `file=-` for stdout. Add per-frame tags with `ametadata=mode=add:key=audit:value=left,ametadata=mode=print:key=audit:file=tag.txt`; adding an existing key preserves its value. Omit `key` in print mode to print all tags. Video generation and metadata modes other than `add` and `print` are unsupported.

`ashowinfo` reports audio frame timestamps, sample counts, and PCM Adler-32 checksums on stderr at info log level or above, without changing the samples.

`silencedetect=noise=-40dB:d=0.1` reports silence starts, ends, and durations on stderr without changing PCM. Add `:mono=1` to measure each channel separately; trailing silence closes at end of input.

`replaygain` measures track gain and sample peak at its position in the filter
chain and reports them at info log level, without changing PCM. It uses 50 ms
ReplayGain weighting windows and the loudest 5% of windows. Stereo audio at
ReplayGain's standard sample rates (8–192 kHz) is supported; other rates,
channel layouts, and filter options are rejected.

`volumedetect` reports interleaved sample count, mean volume, and maximum volume
in dB on stderr, measuring audio after preceding filters without changing PCM samples.
`astats` (also `astats=metadata=0:reset=0`) reports per-channel and overall peak/RMS
levels in dB and the overall sample count on stderr without changing PCM samples.
Metadata injection, periodic resets, and other statistics options are not supported.
`crystalizer=i=2` sharpens changes between successive samples independently per channel.
Intensity defaults to 2 (range -10 to 10); negative values smooth the audio.
Clipping is enabled by default; `c=0` preserves peaks for subsequent filters.
`extrastereo=m=0` averages left and right while retaining stereo; `m=-1` swaps them.
The width multiplier defaults to 2.5 (range -10 to 10); `c=0` disables clipping.
`stereotools` supports stereo channel mute (`mutel`, `muter`), phase inversion
(`phasel`, `phaser`), and all `mode` channel conversions, including `lr>ms` and
`ms>lr`. For example, `-af stereotools=mutel=1` silences only the left channel.
Input and output gains (`level_in`, `level_out`) default to 1, range from 0.015625
to 64, and apply before and after channel processing. For example,
`stereotools=level_in=2:level_out=0.5` preserves the original levels without
clipping the intermediate signal. Other stereotools options are rejected.
Both filters accept case-insensitive Boolean
words (`true`/`false`, `yes`/`no`, `on`/`off`, `y`/`n`, `enable`/`disable`,
`enabled`/`disabled`) and decimal 0/1 values, such as `phasel=True` or `c=OFF`.
Both `extrastereo` and `stereotools` convert mono input to stereo before processing,
with each channel receiving the mono samples at √½ gain.
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

Swap stereo PCM channels with `-af 'channelmap=FR|FL'` or
`-af 'channelmap=map=1|0:channel_layout=stereo'`.
Channel maps accept input speaker names or numeric indices and allow repeated sources.
With only `channel_layout=stereo`, `channelmap` preserves the input channels;
with only `channel_layout=mono`, it selects the first input channel without downmixing.
Output layouts accept `mono`, `stereo`, `quad`, `5.1`, the count aliases `1c`,
`2c`, `6c`, speaker lists such as `FL+FR`, and decimal or hexadecimal speaker masks
such as `0x3`. Explicit layouts must match the map length and preserve the output
speaker metadata, including `1:FR` and `0|1|1|0:quad`.
Omitted layouts use native defaults for one through eight channels, including
2.1 for three channels and 4.0 (not quad) for four channels. Explicit input-output pairs such
as `0-1|1-0` or `FL-FR|FR-FL` route channels by destination, regardless of pair
order. Named destinations retain their speaker layout, including `1-FR` and
`0-FC|1-LFE`. Unavailable inputs, duplicate destinations, and mixed numeric/named
endpoint syntax are rejected before writing output.
`aeval=val(1)|val(0)` evaluates separate expressions against the input samples to swap
stereo channels. Explicit output layouts include `c=quad`, `c=5.1`, speaker lists
such as `c=FL+FR`, masks such as `c=0x3`, and channel aliases such as `c=2c`.
With no layout option, each expression produces one output channel (up to 64),
so `aeval=val(0)|val(1)|0` adds a silent third channel.
Expressions support arithmetic, `val(channel)`, `ch`,
`n`, `t`, `s`, `nb_in_channels`, and `nb_out_channels`; `c=same` retains the input
layout and repeats the last expression when needed. `aeval=abs(val(1))` rectifies negative
right-channel samples; `abs(x)` also accepts constants and arithmetic expressions. `sin(x)` takes radians, and
`PI` is available for waveforms such as `aeval=sin(PI*n/2)/2`.
`enable=0` bypasses the filter; `enable=1` applies it. Timeline expressions use
frame index `n` and timestamp `t`. Empty fields between `|` separators
are skipped, including leading and trailing fields; at least one expression is required.
Conditionals `if(condition,then[,else])` and `ifnot(condition,then[,else])` evaluate
only the selected branch and default an omitted else to zero. For example,
`aeval=if(n\,1/n\,0)` avoids division by zero at the first sample. Both branches
must still contain valid expressions. `st(index,value)` and `ld(index)`
store and read ten initially zero registers per output channel expression. Registers
persist across samples and remain separate even when the last expression is repeated.
Duplicate an audio input into independently filtered outputs with
`-filter_complex '[1:a]asplit=2[x][t];[t]volume=0.5[y]' -map '[x]' one.wav -map '[y]' two.wav`.
`asplit` defaults to two outputs; `asplit=outputs=3` selects three.
Split stereo PCM into distinct mono files with
`-filter_complex '[0:a]channelsplit=channel_layout=stereo[L][R]' -map '[L]' left.wav -map '[R]' right.wav`.
Mono and 5.1 input are remixed to stereo before selecting a stereo output channel.
Use `-af channelsplit=channel_layout=stereo:channels=FR` to extract only the right
channel (`FL` selects the left). Stereo layouts also accept `0x3`, `FL+FR`, and
`2c`; channel selections accept masks (`0x1` for left, `0x2` for right) and
`stereo` or `0x3` for both outputs. Matching mono and 5.1 inputs also support
named speaker extraction: `-af channelsplit=mono:FC`,
`-af channelsplit=5.1:FC`, or `-af channelsplit=5.1:LFE`.
The selected speaker is retained in the output channel layout.
`pan` supports mono, stereo, quad and 5.1 output, numbered channels and named channels from the
input layout: `-af 'pan=mono|c0=c1'` extracts the right channel and
`-af 'pan=stereo|FL=FR|FR=FL'` swaps stereo channels. PCM16 mixing uses native Q15
gains and rounds half steps toward positive infinity, including native 32-bit overflow
for large gains; floating-point filter paths retain floating-point mixing. Weighted sums use `=`,
and `<` divides gains by the sum of their magnitudes, preserving polarity, for example `pan=mono|c0<2*c0+-1*c1`.
Terms accept hexadecimal gains (`0x1`, `0x1p-1`), subtraction (`c0-c1`), compact gains (`.5c1`), and signed exponents
(`1e+0*c1` or `5e-1c1`). Nonfinite gains such as `nan`, `inf`, and `1e999` are accepted;
`pan=mono|c0=nan*c0` produces silence on PCM16 input/output. Floating-point paths retain nonfinite samples.
Stereo layouts also accept `0x3` and `FL+FR`. `pan=5.1|FC=c1|LFE=c0` routes
stereo into center and LFE; unassigned speakers stay silent. Output preserves
the layout’s speaker order and channel mask.
Each input channel may appear only once per output equation, including zero-gain
terms; the same input may be used in separate output equations.
All input references in a pan filter must use the same style: named or numbered.
Output labels may mix styles, as in `pan=stereo|FL=c0|c1=c1`.
Valid input channels absent from the input contribute silence: on stereo,
`pan=mono|c0=FC` is silent and `pan=mono|c0=c0+c2` preserves the left channel.
Numbered input channels range from `c0` to `c63`. Invalid identifiers and output
channels outside the selected layout fail without replacing existing output.
Use `-ch_layout mono` or `-channel_layout mono` for mono output, equivalent to `-ac 1`. Other output layouts are not supported by these options.
`aformat=channel_layouts=mono` (or `aformat=cl=mono`) downmixes stereo by
averaging left and right samples, or preserves mono input.
`aformat=sample_fmts=u8` or `s16` (alias `f`) quantizes samples through that
intermediate PCM format, even when the output codec has higher precision.
Other `aformat` sample formats, options and layouts are not supported.
These filters also work in labeled single-input audio graphs with `-map`.
`volume` and `atempo` default to 1 and accept named primary arguments, such as
`volume=volume=0.5` and `atempo=tempo=2`, as well as positional values.
Volume expressions support `sin(x)`, `cos(x)` (angles in radians), and `tanh(x)`, such as `volume=sin(t):eval=frame`. These functions also work in `aeval`, such as `aeval=tanh(val(ch)):c=same`.

Volume expressions support `lerp(start,end,weight)` for linear interpolation without clamping the weight, such as `volume='lerp(0.25,0.75,t)':eval=frame`.
Volume expressions support the `PI` constant in arithmetic, such as `volume=PI/4`.
Volume expressions support `^` and `pow(base,exponent)`, including negative exponents. Powers group left to right before a leading sign: `2^3^2` is 64 and `-2^2` is -4.
Filter expressions support `floor`, `ceil`, `trunc`, and `round` (halfway values round away from zero), including stepped volume ramps such as `volume='floor(t*10)/10':eval=frame` and per-sample `aeval='floor(val(ch)*10)/10':c=same`.
Volume expressions accept SI prefixes (`volume=1k`, `volume=500m`), binary prefixes (`volume=1Ki`), and the byte multiplier `B` (`volume=1KiB`).
`atempo` accepts arithmetic such as `atempo=1/2`; the result must be between 0.5 and 100.
Audio filters accept instance labels, such as `areverse@flip`, `volume@quiet=0.5`,
and `atempo@fast=2`, with the same behavior as their unlabeled forms.
`volume=if(lt(t\,0.5)\,0\,1):eval=frame` changes gain at audio frame timestamps;
`eval=once` (the default) evaluates a constant gain. Numeric modes are `precision=0/1/2` for fixed/float/double and `eval=0/1` for once/frame. Expressions accept escaped commas or single quotes.
`st(index,value)` stores a value in one of ten expression-local registers; `ld(index)` reads it (initially zero). Registers persist from setup through frame evaluations and reset when a command replaces the expression. For example, `volume='st(0,ld(0)+0.1)':eval=frame` starts at gain 0.2 and increases by 0.1 each frame.
`volume` in an expression holds the previous gain, starting as NaN during setup; `eval=frame` evaluates again for each audio frame.
`asendcmd=c='0.25 volume@v volume 0.25',volume@v=1` changes the named gain on the first audio frame at or after 0.25 seconds. Inline `c`/`commands` schedules support semicolon-separated time/target/volume/gain commands (optionally `[enter]`) targeting subsequent volume filters; target `volume` addresses all subsequent volume instances. Other command actions, interval flags, and command files are unsupported.
The volume counters `nb_samples` and `nb_consumed_samples` are unavailable (NaN), as in native FFmpeg.
`volume` supports ReplayGain `drop` (default), `ignore`, `track`, and `album` modes,
with `replaygain_preamp` (-60–60 dB) and `replaygain_noclip` (enabled by default).
Tagged gain replaces the volume multiplier; untagged audio keeps the requested volume.
With `eval=frame`, `startt` and `startpts` retain the first audio frame's timestamp in seconds and sample time-base units; both are NaN with `eval=once`.
With `eval=frame`, a NaN gain becomes silence; `isnan()` can supply a fallback gain.
`atempo=1` still aligns and blends audio windows, so it can change PCM samples and clip length.
`-filter:a:0 volume=0` (or `-af:0 volume=0`)
mutes the first output audio stream; numeric audio selectors follow output mapping
and leave nonmatching streams unchanged. Filtering a matching stream with `-c:a copy`
fails without writing output. Negative output `-ac` values retain the input channel count and layout. `-ac 1` downmixes stereo and
5.1 WAV audio (back or side surrounds) using normalized FFmpeg weights, preserving
center dialogue and omitting LFE. Stereo upmixing with `-ac 3` or `-ac 4` preserves
left and right audio and leaves added channels silent. Other conversions from
multichannel inputs fail explicitly. Unsupported two-channel speaker layouts (such as
`BL+BR` or `FL+FC`) fail when converting channel layouts or using `extrastereo`;
`anull` preserves them. Stereo and `FC+LFE` remain supported. Unsupported audio filters fail
without creating or replacing the output. Stream copying remains supported. Without `-map`, automatic audio selection keeps one track, preferring the default track, then the most channels, then input order. Use `-map 0:a` to copy every audio track from the first input. Global metadata defaults to the first input;
`-map_metadata N` copies it from input N, and `-map_metadata -1` suppresses copying. MP4/M4A output accepts `-movflags +use_metadata_tags` to retain arbitrary named tags, such as `-metadata session_id=abc123`, alongside standard tags.
Explicit global selectors are accepted on either side: `-map_metadata N:g`,
`-map_metadata:g N`, and `-map_metadata:g N:g`.
Repeated global maps fill missing tags in argument order, keeping the first mapped value for duplicate keys.
Explicit `-metadata key=value` tags override copied metadata. M4A/MP4 stream copies preserve composer tags; `-metadata composer=Writer` replaces the composer and `-metadata composer=` removes it. M4A/MP4 copies preserve the compilation flag; `-metadata compilation=0` writes an explicit false flag, `compilation=1` sets it, and `compilation=` removes it.
Each output filename closes its option group: `-t 0.025 a.wav -t 0.075 b.wav`
writes both files with independent durations. Output options reset after each filename;
trailing options without a filename do not change earlier outputs.
`-stream_loop -1` repeats an input up to a finite output `-t` or `-to`, subject to
media resource limits. Without either output bound, infinite looping fails explicitly.
`-metadata:s:m:language:fra language=deu` changes only output tracks whose language is French;
add a type (`-metadata:s:a:m:language:fra`) to restrict matching to audio.
`-metadata:s:a:0 language=fra` sets the first output audio track’s language;
`-metadata:s:a:1 handler_name=Bob` sets the second output audio track’s MP4 handler name.
Stream selectors also accept an absolute index (`s:1`), a type (`s:a`), or all streams (`s`).
`-disposition:a:0 0 -disposition:a:1 default` selects the second output audio track as the MP4 default.
Disposition selectors accept a type, an absolute index, all streams, or an output language
(`-disposition:m:language:fra default` or `-disposition:a:m:language:fra default`); supported values are
`0`, `1`, `default`, `comment`, and `attached_pic`, with `+`/`-` flag updates and combinations such as
`default+comment`. MP4 output writes `comment` as a commentary track role. Other disposition values fail explicitly.
For FLAC cover art, map the audio and PNG/JPEG inputs with `-map 0:a -map 1:v -c copy -disposition:v:0 attached_pic`; unmarked video streams are omitted.
Chapters default to the first input with chapters, independently of stream selection. `-map_chapters -1` removes output chapters; `-map_chapters N` copies chapters from input N. MP4/M4A `-movflags +disable_chpl` omits the Nero chapter box while retaining the referenced QuickTime chapter track; `-movflags -disable_chpl` restores the Nero box. FFmetadata export preserves imported chapter time bases, including sample-accurate boundaries. Concat manifests accept `chapter id start end` directives and export them with a microsecond time base; chapters do not trim the concatenated media.
`xfade` supports the default `fade` and `transition=wipeleft`; other transitions fail
without creating or replacing output.
`trim` supports `start` (`starti`), `end` (`endi`), `duration` (`durationi`), `start_frame`, `end_frame`, `start_pts`, and `end_pts`; frame
numbers are zero-based. `start_frame=-1` leaves the frame start unset, preserving any time or PTS start bound; lower values are invalid. Positional options follow `start:end:start_pts:end_pts:duration:start_frame:end_frame`;
for example, `trim=0.5:1` keeps frames from 0.5 seconds up to 1 second. Positional integer bounds round to the nearest integer, with ties to even.
PTS bounds use the input time base, and end bounds are exclusive. Unsupported trim options fail
without replacing output.
`framestep=3` (or `framestep=step=3`) keeps frames 0, 3, 6, and so on, preserving their timestamps. The default step is 1; use `-fps_mode passthrough` to write each selected frame once.
`loop=loop=2:size=2:start=3` (or `loop=2:2:3`) repeats the buffered two-frame sequence twice, then resumes the remaining input with shifted timestamps. As in FFmpeg, `start=3` buffers input frames 2 and 3 (zero-based); starts 0 and 1 both begin at the first frame. A buffer ending at EOF repeats the available frames. Defaults disable looping. Only finite nonnegative loop counts, sizes up to 32767, and nonnegative frame starts are supported; infinite loops and time-based starts are rejected. Expansion respects media resource limits.
`shuffleframes="2 0 1"` (or `shuffleframes=mapping=2|0|1`) reorders each group of three frames. Indices start at zero, repeated indices duplicate pictures, and `-1` drops an output slot. Output slots keep their original timestamps; incomplete final groups are dropped. The default mapping is `0`. Use `-fps_mode passthrough` to preserve gaps without duplicating frames.
`tinterlace=mode=interleave_top` (or `tinterlace=4`) combines each pair of frames: even-numbered rows come from the first frame and odd-numbered rows from the second, counting from zero. Output keeps the first frame’s timestamp and spans both frames; an unmatched final frame is dropped. Other modes and options are unsupported. Use `-fps_mode passthrough` to write each resulting frame once.

`telecine=pattern=23` applies a repeating field cadence to progressive frames, weaving alternating scan lines when a pair spans two input frames. The default pattern is `23`; `first_field=bottom` reverses field order (default: `top`). Pattern digits specify fields per input frame; zero skips a frame, and an unmatched final field is dropped. Output timing follows the cadence. Use `-fps_mode passthrough` to write each resulting frame once.

`tblend=all_mode=difference` emits the absolute RGB difference between adjacent frames, starting with the second input frame and retaining its timestamp. Repeated frames produce black output. Other blend modes and options are unsupported. Use `-fps_mode passthrough` to preserve the resulting sequence.
Burned SRT, WebVTT, and ASS captions use bitmap lettering and bottom spacing that scale with video height. ASS input preserves cue timing and text; its font and positioning styles are not rendered.
MicroDVD input (`-f microdvd` or automatic detection) uses the declared frame rate and converts `|` to line breaks; `-c:s copy -f microdvd` preserves caption frame numbers and text.
RealText input (`-f realtext` or automatic detection) preserves `<time begin="…" end="…">` intervals and `<br/>` line breaks while removing window and clear markup.

SAMI input (`-f sami`, `.smi`, or `.sami`) preserves millisecond SYNC timing and `<br>` line breaks; each cue ends at the next SYNC.

LRC lyrics support explicit `-f lrc` and automatic detection, infer cue ends from the next timestamp, and write each subtitle line with its own centisecond timestamp.

TTML output (`-f ttml` or `.ttml`) preserves subtitle cue timing, line breaks, and XML-escaped text.
PJS input (`-f pjs` or automatic detection) reads quoted cues with decisecond timing.
JACOsub input (`-f jacosub` or automatic detection) reads tick rates and timing shifts, and exports alignment and inline line breaks to SRT.

MPL2 input (`-f mpl2`) reads decisecond cue timing and converts `|` to line breaks.

SubViewer v1 input (`-f subviewer1` or detected script header) reads bracketed timestamps and ends each cue at the next marker, omitting headers and empty trailing cues.

SubViewer input (`-f subviewer` or detected `.sub` timecodes) preserves centisecond timing, skips information headers, and converts `[br]` to line breaks.
ASS and SRT conversion preserves cue text and timing; ASS output uses a default style and centisecond timestamps. ASS input decodes line breaks and retains the first explicit `\an` alignment override in each cue when converting to SRT. Matroska output with `-c:s ass` encodes basic SRT styling and line breaks; `-c:s copy` retains ASS packets and the original script header.
Matroska ASS-to-SRT conversion decodes event fields, basic style overrides and escaped line breaks while preserving cue timing.
Add external files to Matroska with `-attach notes.txt -metadata:s:t:0 mimetype=text/plain`. Repeat `-attach` for multiple files; attachment indices follow any copied attachments. Filenames default to the source basename and can be overridden with `-metadata:s:t:0 filename=guide.txt`.
Extract an input attachment with `-dump_attachment:t:1 notes.txt -i input.mkv -map 0:v -c copy output.mkv`; `t:0` selects the first attachment. Use `v:0` or `a:0` to extract codec initialization bytes instead. An empty destination uses the attachment’s stored filename. Extraction is independent of `-map`; existing destinations require `-y`.

SRT-to-WebVTT conversion removes ASS override blocks and converts `\N` and `\n` to line breaks; `-c:s copy` preserves the original cue text. SRT dialogue continues across blank lines until the next timed cue. Signed SRT hours are accepted; a leading `+` requires `-f srt`. SRT output shifts negative timestamps to zero by default while preserving cue durations.

`ffprobe` uses the same audio/video implementation as `@poe-platform/safe-bash/commands/ffprobe`, with default limits of 32 MiB input and 1 MiB output. Pass `limits` to override them.

## Features

- **Dynamic AST-Driven Format Support**: Pass `asts: [...]` to `ffmpegCommands({ asts })` to dynamically determine which container formats, extensions, demuxers, muxers, and codecs are supported by `ffmpeg` and `ffprobe`.
- **Video Merging & Concatenation**: Supports `-f concat -safe 0 -i list.txt -c copy`, `concat:clip1.mp4|clip2.mp4`, and `-filter_complex "concat=n=2:v=1:a=1"`. Explicit `stream` declarations and `exact_stream_id` select concat input streams; WAV PCM uses stream ID `0`. A nonmatching declaration fails without replacing output. Manifests beginning with the exact `ffconcat version 1.0` signature are detected without `-f concat`. By default (or with `-safe 1`), concat filenames must be relative paths using ASCII letters, digits, underscores, hyphens, and periods, with no component starting with a period; `-safe 0` permits other filenames. Safe mode also rejects manifest `option` directives. With `-safe 0`, `option ignore_editlist 1` after a `file` ignores that MP4/MOV file’s edit list, using its full media timeline; `0` retains the edits. The option applies only to that file. Concat inserts H.264 SPS/PPS headers at IDR pictures by default (`-auto_convert 1`); set `-auto_convert 0` before the input to preserve the original packets. Manifest `stream_meta key value` attaches metadata to the preceding `stream` declaration, including track titles when copying audio into Matroska. Manifest `file_packet_meta key value` attaches packet tags only to the preceding file; output containers may omit these tags. Manifest `duration` sets the next segment’s timeline start without trimming samples; use `inpoint`/`outpoint` to trim. All three timing directives accept an explicit positive sign, such as `outpoint +0.5`. WAV concat seeks to the exact PCM sample frame at `inpoint`, including during stream copy, and retains the entire PCM packet that starts before `outpoint`. A missing or undecodable later concat segment logs an error and preserves media already read; `-xerror` also makes the exit status nonzero. A missing or undecodable first segment fails without replacing existing output.
- **Trimming, Muxing & Faststart**: Supports `-copyts` to retain MP4/MOV input timestamps and `-copyts -start_at_zero` to shift the input start to zero while preserving stream offsets (`-start_at_zero` alone keeps normal timestamp rebasing), input `-itsoffset` and output `-output_ts_offset` to shift timestamps (seconds, duration strings, or `ms`/`us` units), input/output `-ss`, `-to`, `-t` (including lavfi sources), input `-itsscale[:stream_specifier]` to scale packet timestamps while preserving packet durations, input `-sseof` with a negative offset from the end (for example, `-sseof -0.125 -i in.wav` keeps the last 125 ms), `-map`, `-an`, `-vn`, `-shortest`, `-movflags +faststart` (moves the movie header before media; default output and `-movflags -faststart` keep it after media), `-movflags +write_colr` (writes MP4 color information even when unspecified), and `-movflags frag_keyframe+empty_moov` (starts each fragment at a video keyframe while preserving packet data and timestamps; omit `empty_moov` to keep the first group of samples in the initial movie). `-movflags frag_every_frame` splits at every frame, including non-keyframes; add `empty_moov` to include the first frame in a fragment. `-frag_duration 500000` splits MP4 at half-second packet boundaries, including non-keyframes (microseconds; zero disables time-based cuts); add `-movflags +empty_moov` to fragment the initial samples too. `-fragment_index 7` starts MP4 fragment sequence numbers at 7 (default: 1; accepts integers from 1 to 2147483647). Fragmented MP4 includes a random-access trailer; `-movflags +skip_trailer` omits it. Fragmented MP4 uses explicit absolute base offsets; add `-movflags +default_base_moof` for moof-relative addressing. `-movflags +empty_moov+global_sidx` writes a global segment index per track; `+empty_moov+dash` writes indexes before each fragment using moof-relative addressing. Both default to keyframe fragment boundaries; `global_sidx` takes precedence when combined with `dash`. Unknown or unsupported `-movflags` names fail before writing output.
- **Filtergraphs & Frame Extraction**: Supports `scale` (`force_original_aspect_ratio=decrease` fits within the requested dimensions; `increase` fills them; `disable` keeps the exact dimensions), `hqx` (HQ pixel-art scaling with `n=2`, default `n=3`, or `n=4`), `xbr` (edge-blended pixel-art scaling with `n=2`, `n=3` (default), or `n=4`), `super2xsai` (2× pixel-art scaling), `epx` (pixel-art scaling with `n=2` or the default `n=3`), `crop` (width and height can reference each other through `ow`/`out_w` and `oh`/`out_h`), `pad` (width and height can reference each other through `ow`/`out_w` and `oh`/`out_h`, for example `pad=oh*2:6:0:0`; `aspect=1/1` expands the canvas to the requested display aspect ratio, accounting for sample aspect ratio), `fps`, `hflip` and `vflip` (accept instance identifiers such as `hflip@named` and `vflip@named`; accept per-frame `enable` expressions using `n` and `t`; invalid expressions and unsupported options fail before replacing output), `transpose`, `rotate`, `negate` (RGBA `components=r+g+b+a` selects channels; the default inverts RGB and preserves alpha), `bitplanenoise` (measures the selected `bitplane=1..16`, default 1; `filter=1` renders its neighbor-agreement mask, and `metadata=print` reports per-plane noise), `histogram` (default 256×636 stacked RGB histograms for each frame; custom options are unsupported), `drawbox`, `overlay`, `hstack`, `vstack`, and `%03d.png` image sequences with independent input/output `-start_number` values and no default frame ceiling. Input `-start_number` accepts signed 32-bit indices, including negative values (`f%03d.png` at -1 reads `f-001.png`). Input searches five candidate indices from `-start_number` (default 0); `-start_number_range` changes that window. After the first image, the sequence stops at the first gap. Output `-atomic_writing 1` writes each image to a `.tmp` file and renames it into place; `-atomic_writing 0` (the default) writes directly. Output `-strftime 1` expands calendar patterns such as `stamp-%Y-%m-%d-%H-%M-%S-%%.png` using the current clock and virtual `TZ` (UTC by default); `%%` produces a literal percent. Frames with the same expanded filename replace earlier frames. `-strftime 0` keeps sequence numbering, and `-update 1` keeps the filename literal. Output `-frame_pts 1` names images by presentation timestamps in the output frame time base instead of sequence numbers; `-enc_time_base 1:1000` (also `1/1000`) selects ticks of one millisecond for encoded image filenames, and `0` uses the default frame time base. The setting applies to one output. `-frame_pts 0` keeps default numbering. Both accept native case-insensitive boolean spellings such as `true`/`false`, `yes`/`no`, `on`/`off`, and `enabled`/`disabled`. Image2 is autodetected for numbered image filenames and paths containing `*` or `?`; bracket-only glob patterns need `-f image2`. Ordinary single images reject `-pattern_type` unless `-f image2` is supplied. `-pattern_type glob` reads matching image paths in sorted order with C-locale UTF-8 byte matching (`?` consumes one byte, so `é` needs two and `😀` needs four), including C-locale POSIX bracket classes such as `f[[:digit:]].png` and `f[[:alpha:]].png`; quote the pattern to keep the shell from expanding it. `-pattern_type none` reads the filename literally, including `%02d`. `-pattern_type glob_sequence` (the default) accepts numbered sequences and percent-prefixed glob tokens: `f%*.png` reads `fa.png`, `fb.png`, and other matching files. Prefix each glob metacharacter with `%`; unprefixed metacharacters stay literal. Explicit `-pattern_type glob` keeps percent signs literal, so `f%*.png` matches `f%a.png`. `-pattern_type sequence` selects only numbered mode. Numbered inputs accept one numeric field (`%d` or `%02d`); repeated numeric fields are supported only in output patterns. Numeric selectors `1`, `2`, and `3` are equivalent to `glob`, `sequence`, and `none`, respectively. `select` accepts arithmetic with `n`, `t`, `start_t`, `prev_t`, `selected_n`, `prev_selected_n`, `prev_selected_t`, and `key`, and `eq`, `lt`, `lte`, `gt`, `gte`, `between`, `isnan`, `not`, and `mod` functions. Selection counts and previous selected frame values update only when a frame is kept; previous values start as NaN, testable with `isnan`; invalid or unsupported expressions fail without replacing output. Image sequences duplicate or drop frames to preserve output cadence after `select` and `setpts`; use `-fps_mode passthrough` (or `-vsync 0`) to write each filtered frame once. `-fps_mode` also accepts `:v`, `:v:0`, `:V`, `:V:0`, or `:0` to target the single output video stream. It accepts case-insensitive `passthrough`, `cfr`, `vfr`, `auto`, and `drop`; invalid values (including numeric modes) fail before writing output. `-fps_mode vfr` (or `-vsync 2`) drops frames at duplicate presentation timestamps while preserving gaps and the first frame at each timestamp. Legacy `-vsync 1` remains valid. `hstack` and `vstack` continue to the longer input by repeating the shorter input’s last frame; set `shortest=1` to stop at the shorter input. `crop` positions can refer to one another using `x` and `y` (for example, `crop=4:2:y:1` or `crop=4:2:1:x`) and accept arithmetic with `iw`, `ih`, `ow`, `oh` (and their `in_w`, `in_h`, `out_w`, `out_h` aliases), input aspect ratio `a`, sample aspect ratio `sar` (square pixels when unspecified), display aspect ratio `dar`, chroma subsampling factors `hsub` and `vsub`, zero-based frame number `n`, and presentation timestamp `t` in seconds; unsupported expressions fail without replacing output. `overlay` defaults to even x/y positions on the YUV420 chroma grid; `format=yuv422` aligns only x, while `format=auto`, `format=rgb`, and `format=yuv444` preserve integer positions. `overlay` positions accept arithmetic with `main_w`, `main_h`, `overlay_w`, and `overlay_h` (or `W`, `H`, `w`, and `h`); invalid or unsupported expressions fail without replacing output. `rotate` evaluates radian angles per frame (including `PI`, arithmetic, zero-based frame number `n`, and timestamp `t` in seconds), defaults to the input canvas size, and uses bilinear sampling with opaque black fill by default. Use `enable` with frame index `n` or timestamp `t` (seconds), such as `rotate=PI:enable=gte(n\,1)`, to rotate selected frames and pass disabled frames through unchanged. Set `bilinear=0` to select nearest sampling; `bilinear=1` retains the default. Output dimensions accept `ow`/`out_w` and `oh`/`out_h` (or the second and third positional values), arithmetic with input/output dimensions, and `rotw(angle)`/`roth(angle)`. The rotated frame stays centered on the output canvas. `fillcolor` (or `c`) accepts colors such as `red`, `red@0.5`, and `0xff000080`, preserving alpha on RGBA output. Unsupported options and invalid dimensions fail without replacing output. With opaque black fill, decoded 8-bit planar YUV frames rotate before RGB conversion; custom fill colors use RGBA sampling. `format=rgba,rotate=...` explicitly selects RGB sampling. `drawbox=box_source=side_data_detection_bboxes` leaves frames without detection side data unchanged, ignoring explicit box geometry. `drawbox` geometry expressions can reference `x`, `y`, `w`, `h`, and `t` as well as input dimensions `iw`, `ih`, `in_w`, and `in_h` (for example, `drawbox=1:1:h:3:red:fill` draws a 3×3 box); omitted or nonpositive dimensions use the frame size, and invalid expressions fail without replacing output. It blends alpha colors such as `red@0.5` and `0xff000080` over existing pixels. On RGBA input, `color=invert` inverts each covered pixel’s RGB channels and preserves its alpha. GIF `-c:v copy` preserves original frame rectangles, palettes, and compressed image data. GIF `-global_palette 0` writes a local color table for each frame; `-global_palette 1` (the default) writes a global color table. GIF encoding enables rectangle offsetting and transparent differencing by default. Use `-gifflags -offsetting`, `-gifflags -transdiff`, or `-gifflags -offsetting-transdiff` to disable them independently or together; `0` disables both and `3` enables both. GIF input accepts `-min_delay`, `-default_delay` (0–6000), and `-max_gif_delay` (0–65535) before `-i`, in centiseconds; decoded frames retain their embedded delays. Animated GIF output preserves all frames and their timing; probing reports the full animation. `-final_delay N` sets only the last GIF frame delay in centiseconds (`0`–`65535`); `-1` preserves its delay, including stream copy. Output `-loop N` sets GIF repeats (`0` loops forever by default, `-1` omits the loop extension, `1`–`65535` sets a finite repeat count), including stream copy. Before `-i`, `-loop 0|1` controls image input repetition independently. GIF input `-ignore_loop 0` honors embedded loops, preserving frame order and delays; the default `-ignore_loop 1` reads one pass. Infinite GIFs require a finite `-frames:v`, `-t`, or `-to` bound. Input repetition is independent of output `-loop`. The `smptebars` source produces static SMPTE bars.
- **Consumer-Defined Limits**: Imposes no default limits while offering `cloudflareWorkerLimits()` and opt-in/opt-out feature controls (`features: { videoTranscode, filterGraph, lavfiSources }`).

`silenceremove` supports start/stop periods, durations, linear or dB thresholds,
`any`/`all` channel modes, and `avg`, `rms` (default), or `peak` detection with
a configurable window. Negative stop periods remove repeated silent sections.
Extra retained silence and copied timestamps are unsupported; invalid or unsupported
options fail without replacing output.

WAV segment output (`-c copy -f segment part%02d.wav`) writes numbered files at audio packet boundaries, with a default target duration of two seconds. Matroska audio stream copy (`-c copy -f segment part%02d.mkv`) uses the same boundaries and preserves packet payloads and timestamps; `-reset_timestamps 1` rebases each segment to zero. Filtering and sample-rate conversion retain output frame boundaries: `-af volume=0.5`, `-af areverse`, and `-ar 12000` can produce cuts just after the requested time while preserving every processed sample. Set `-min_seg_duration 0.1` to require at least that duration before a scheduled cut advances to a packet boundary (the final segment may be shorter). The minimum defaults to zero, cannot exceed `-segment_time`, and is ignored with explicit `-segment_times` or `-segment_frames`. Set `-write_empty_segments 1` to emit empty segments when multiple scheduled cuts fall before the next packet; their CSV start and end times match. The default (`0`) skips empty segments. Use `-segment_time 0` to cut at every PCM audio packet. Use `-segment_time 1` to change the target. For WAV segments, `-segment_header_filename head.wav` writes one separate streaming WAV header and headerless audio in the numbered files. Concatenate the header and segments in order to reconstruct the WAV stream; the segment list contains only media files. Existing header files also require `-y`. `-segment_format` overrides the filename suffix for MP4, Matroska audio stream copy, WAV, or raw audio output; for example, `-segment_format s16le part%02d.wav` writes headerless PCM16LE segments despite the `.wav` suffix. Without this option, the filename selects the format. For PCM WAV segments, `-write_header_trailer 0` writes only the encoded audio bytes, with no RIFF header or trailer; `1` (the default) writes normal WAV files. Segment boundaries and list timestamps are unchanged. Headerless output supports WAV and raw-audio segments; other segment formats are rejected before output is replaced. `-segment_time_delta 0.06` permits a cut at the first eligible packet up to 60 ms before each target time, including explicit `-segment_times`; the default is zero. Frame-based cuts are unchanged. `-segment_list_entry_prefix audio/` prepends text to list entries without changing segment filenames or creating a prefix directory. `-segment_list list.txt` writes one filename per line; `.csv` and `.ext` lists include actual start/end times. `.ffconcat` lists include the `ffconcat version 1.0` header and escaped `file` directives for reuse as concat inputs. Use `-segment_list_type flat` or `csv` to override the filename-based format; `ext` and numeric types `1` and `3` also select CSV with escaped filenames and start/end times. Use `-segment_list list.m3u8` for an M3U8 playlist with actual segment durations. `-segment_start_number 7` starts filenames and list entries at 7 (default: 0; accepts integers from 0 to 2147483647), without changing segment boundaries. MP4 segment output (`-c copy -f segment part%02d.mp4`) cuts at video keyframes and retains packet timestamps. Use `-segment_frames 4,12` to cut at zero-based reference frame numbers instead of time intervals; each cut waits for the next keyframe. Frame numbers must be nonnegative integers in ascending order. Set `-segment_list_size N` to list only the last N segments without deleting any segment files or changing their timestamps; `0` (the default) lists every segment. WAV output supports one audio track. Set `-individual_header_trailer 0` to write a WAV header only in the first segment and bare audio payloads in subsequent segments; the default (`1`) writes a header in every segment. Use `-segment_wrap N` to reuse N numbered filenames, replacing earlier segments while keeping every CSV entry in chronological order; `0` (the default) disables wrapping. Existing segments and lists require `-y` to overwrite. CSV lists are opened before writing segments, so an unavailable list destination leaves existing segments intact. Set `-reset_timestamps 1` to rebase each segment independently to its start; `0` (the default) keeps the original timeline. Use `-initial_offset 2.5` to add 2.5 seconds to segment packet timestamps, after any reset, without changing cuts, list times, or media samples. Signed seconds, duration strings, and `ms`/`us` units are accepted; WAV and raw PCM have no stored packet timestamps.

`-master_pl_name master.m3u8` writes a single-variant master playlist relative to the media playlist directory, advertising bandwidth, video resolution, and codec identifiers. Audio-only masters omit resolution.

`-hls_segment_type` accepts `mpegts` or `0` for MPEG-TS and `fmp4` or `1` for fragmented MP4. Invalid types fail before writing output. `-hls_fmp4_init_filename` sets the separate fMP4 initialization filename and its `EXT-X-MAP` URI (default `init.mp4`, relative to the playlist directory). Single-file HLS keeps initialization in the combined media file. `-hls_init_time` sets the initial playlist interval before switching to `-hls_time` as the window slides; zero disables it. Append mode ignores it, and `-hls_list_size 0` uses the normal interval. Both duration options accept seconds, `s`/`ms`/`us` units, and `HH:MM:SS` or `MM:SS` durations. Invalid durations fail before writing output. HLS stream-copy segments cut at keyframes, so a long GOP can exceed `-hls_time`; the playlist reports actual segment durations. Intervals below 200 ms are honored when keyframes permit; `-hls_time 0` cuts at each keyframe after the first. After a late keyframe, later cuts remain scheduled at multiples of the requested interval (for example, a 3-second interval with keyframes every 2 seconds yields 4/2/3-second segments for a 9-second video). `-hls_flags split_by_time` allows cuts between keyframes and disables the independent-segments declaration. `-hls_list_size` keeps the final N entries (default 5; 0 keeps all) and advances the media sequence for separate-file output. It accepts numeric expressions such as `1+1` and rounds decimals to the nearest integer, with exact halves rounded to even (`1.5` and `2.5` both select 2). Values must be between 0 and 2147483647 before rounding. Single-file HLS keeps the media sequence at zero, including with a sliding window or `-start_number`. Segment files are preserved unless `-hls_flags delete_segments` is set; deletion retains one expired segment by default. `-hls_delete_threshold N` changes that count, capped by FFmpeg’s playlist-duration retention rule. Unlimited playlists do not delete segments. `-hls_playlist_type vod` (or `2`) and `event` (or `1`) emit the corresponding playlist type and keep every entry and segment regardless of `-hls_list_size` or `delete_segments`. `-hls_playlist_type 0` selects the default sliding playlist without a type tag. Language selectors `-map 0:m:language:fra` and `-map 0:a:m:language:fra` select French tracks; omit the language value to match any language tag. Stream-ID selectors `-map 0:i:77`, `-map 0:i:0x4d`, and `-map 0:#0x4d` select the same container track ID, independently of stream order. Negative `-map` selections remove previously selected streams by input, type, or stream index, and later positive maps can select them again.

`-hls_start_number_source` selects the initial media sequence and segment filename number: `generic` (default) uses `-start_number` or zero, `epoch` uses Unix seconds, `epoch_us` uses Unix microseconds at millisecond clock precision, and `datetime` uses local `YYYYMMDDhhmmss`. Clock sources override `-start_number`; subsequent segments increment the number.

With `-strftime 1`, HLS segment filenames expand wall-clock date directives using `TZ` (UTC by default), such as `day-%Y%m%d.ts`. Add `-hls_flags second_level_segment_index` to expand an escaped segment number after the date, for example `s-%Y-%%03d.ts`; this flag requires `-strftime 1` and a numbered placeholder after date expansion. Without `-strftime 1`, multi-file HLS filename templates must contain a numbered placeholder such as `%d` or `%03d`; literal percent pairs are preserved, so `x%%p%02d.ts` starts at `x%%p00.ts`. Invalid templates are rejected before writing output. `-hls_flags temp_file` writes completed segments and playlists to sibling `.tmp` files and renames them to their final names. Single-file media and separate fMP4 initialization files are written directly. `-hls_flags` accepts `append_list`, `delete_segments`, `omit_endlist`, `split_by_time`, `independent_segments`, `iframes_only`, `discont_start`, `program_date_time`, and `round_durations`, including `+`/`-` combinations. `iframes_only` declares `EXT-X-I-FRAMES-ONLY` and raises the playlist version to at least 4 without filtering non-keyframe packets. `program_date_time` adds a wall-clock timestamp to each new segment, advancing by its media duration. `round_durations` rounds playlist durations to integers instead of six decimal places. `discont_start` inserts `#EXT-X-DISCONTINUITY` immediately before the initial segment’s `#EXTINF`; the marker disappears when that segment leaves the playlist window. Numeric masks for supported HLS flags also work: `0` clears all flags, `16` enables `omit_endlist`, and `21` combines `single_file+round_durations+omit_endlist`. Numeric and named flags can be combined with `+`/`-`; an unsigned value replaces prior flags. Unrecognized flags and unsupported mask bits fail before writing output. Repeated `-hls_time`, `-hls_init_time`, `-hls_list_size`, `-hls_delete_threshold`, `-hls_segment_type`, and `-hls_playlist_type` assignments validate only the last value for each output. A bare `-hls_flags` assignment replaces earlier flags, including invalid ones; a leading `+` or `-` modifies earlier flags and retains their validation errors. `append_list` resumes a separate-file playlist: existing fragments are preserved, numbering continues after its last entry, and a discontinuity marks each new recording. Playlist windows and deletion apply across recordings. Appending single-file, byte-range, or encrypted playlists is unsupported. `-hls_flags single_file` writes one media file with playlist byte ranges computed from the muxed bytes (MPEG-TS or fMP4, including an initialization range). Its default filename is the playlist basename with `.ts` or `.m4s`; an explicit segment filename is used literally without numbered expansion. Playlist windows retain the complete media file even with `delete_segments`. `-hls_segment_size N` groups segments into numbered media files with byte ranges, starting a new file after the current file reaches N bytes; offsets restart at zero in each file. Zero disables size-based grouping, and `single_file` takes precedence. Size-based grouping preserves media files even with `delete_segments`.

`-hls_base_url` prepends its value verbatim to media segment URIs in the playlist without changing local output paths or initialization map URIs. `-hls_allow_cache 0` writes `#EXT-X-ALLOW-CACHE:NO`; `1` writes `YES`. The tag is omitted by default.

Explicit `-hls_segment_filename` paths resolve from the working directory; default segments are written beside the playlist. Missing HLS parent directories are created. Existing outputs are preserved with exit status 1 unless `-y` is specified; `-n` explicitly requests preservation.


Both commands resolve local HLS and static DASH segment files from the virtual
filesystem, including fMP4 initialization files, and report the actual media
streams. HLS skips local media segments with disallowed file extensions before reading them; disallowed initialization files fail. Put `-allowed_extensions mp4,m4s,txt` before `-i` to replace the default media extension list for that input, or use `ALL` to allow any extension. Missing DASH media fragments are skipped when initialization is available,
preserving surviving packet timestamps; missing initialization files and other read errors fail the command. DASH output (`-f dash` or
`.mpd`) selects WebM for VP9 (`video/webm`, `init-stream*.webm`, and `chunk-stream*.webm`); H.264 retains MP4 with `init-stream*.m4s` and `chunk-stream*.m4s` files
beside it. It publishes a dynamic manifest after completed segments become available, then finalizes a static manifest at EOF. Use `-init_seg_name 'i-$RepresentationID$.mp4'` and
`-media_seg_name 'm-$RepresentationID$-$Number$.m4s'` to customize the names; `$ext$` expands to the selected container extension.
Use `-target_latency 1.5 -ldash 1 -utc_timing_url URL` to advertise a 1500 ms target in the intermediate live MPD. The final static MPD omits latency; streaming producer reference time and a UTC timing URL are required.
Use `-mpd_profile dvb_dash` to declare the DVB DASH profile, or `-mpd_profile dash+dvb_dash` for both DVB and the default ISO live profile.
MP4 media chunks include a local `sidx` index covering their fragments. Use `-streaming 1` to omit indexes and write one fragment per frame (`0` is the default).
Use `-ldash 1` to enable per-frame streaming and low-latency GOP-based buffering without changing segment boundaries; `-ldash 0` is the default. `-streaming 1` alone retains standard buffer timing.
Use `-dash_segment_type auto|mp4|webm` (also `0|1|2`) to select the segment container, filenames and manifest MIME type together. Explicit MP4 supports VP9 stream copy; WebM rejects incompatible codecs.
Use `-frag_type every_frame` for one fragment per frame inside each media segment, keeping `-seg_duration` unchanged; `none` (default) writes one fragment per segment. Use `-frag_type duration -frag_duration 0.5` for half-second fragments inside each segment; DASH uses seconds, while MP4 uses integer microseconds. Zero disables duration cuts, and fragment duration cannot exceed segment duration.
Use `-utc_timing_url https://example.invalid/time` to advertise an HTTP xsdate UTC timing source in the MPD without fetching it; empty or omitted values add no timing source.
Use `-use_template 0` for explicit `SegmentList` output; the default (`1`) retains `SegmentTemplate`.
Use `-min_playback_rate 0.9` and/or `-max_playback_rate 1.1` to advertise playback bounds in DASH `ServiceDescription`. Each defaults to 1 and accepts 0.5–1.5; reversed bounds and the default 1/1 pair omit `PlaybackRate`.
Use `-use_timeline 0` for fixed-duration templates without a timeline (`-seg_duration` defaults to 5 seconds); `1` retains the default timeline.
Use `-remove_at_exit 1` to delete the generated manifest and media files when output finishes; the default (`0`) preserves them.
Use `-window_size N` to retain the last N segments per representation in timelines and lists, with their original segment numbers; `0` (default) retains all. Fixed-duration templates keep their full presentation.
Use `-single_file 1` to write `<manifest>-stream<N>.webm` for VP9 or `<manifest>-stream<N>.mp4` for MP4 per representation and a `SegmentList` with initialization, media, and index byte ranges.
`-adaptation_sets "id=0,streams=a id=1,streams=v"` groups output streams into explicit
adaptation sets. Select streams by `a`, `v`, or comma-separated output stream indices;
each stream must belong to exactly one set of the same media type.
Use `-write_prft 1 -streaming 1 -utc_timing_url URL` to write producer reference times before every frame fragment. `-ldash 1` enables streaming and producer times by default; `-write_prft 0` disables the boxes. Both streaming and a UTC timing URL are required. The completed output is a static MPD with `UTCTiming`.
Use `-hls_playlist 1` with DASH output to write `master.m3u8` and per-stream `media_N.m3u8` playlists alongside the MPD, sharing its media resources.
DASH input supports a single Period with segment templates, timelines, or segment lists without byte ranges.
Stream copy preserves relative audio/video timing, including AAC priming, and follows native DASH packet scheduling through EOF;
HLS input supports clear and AES-128 encrypted media playlists (local 16-byte keys admitted by `-allowed_extensions`, explicit or media-sequence IVs, and clear initialization segments) with complete segment files or media and initialization byte ranges, including implicit offsets for consecutive ranges in the same media file.
Native H.264 inputs decode with CAVLC/CABAC and reference-frame support. FLAC output writes the muxer encoder tag; `-bitexact` or `-fflags +bitexact` omits it, including during stream copy. FLAC output accepts `-write_header 0` to emit only raw audio frames; `-write_header 1` retains the default stream header and metadata. FLAC output accepts `-metadata_header_padding` to reserve padding bytes (`0` removes padding, `-1` selects 8192 bytes); stream copy preserves compressed audio. FLAC encoding accepts `-exact_rice_parameters 0|1`: `0` (default) estimates Rice parameters and `1` searches exact residual bit costs, preserving PCM in FLAC and Ogg FLAC. FLAC encoding accepts `-min_partition_order` and `-max_partition_order` (0–8; `-1` selects defaults) for Rice residual partitioning in FLAC and Ogg FLAC. An explicit minimum requires an explicit maximum; short blocks reduce the bounds to valid partitions. FLAC encoding accepts `-multi_dim_quant 0|1` to control first-order LPC coefficient refinement for FLAC and Ogg FLAC, preserving exact PCM. FLAC encoding accepts `-min_prediction_order` and `-max_prediction_order` (1–32 for LPC, `-1` selects the default) and `-prediction_order_method estimation|2level|4level|8level|search|log`. FLAC encoding accepts `-lpc_coeff_precision` (1–15 bits; `0` selects the default 15) to quantize LPC coefficients; fixed and verbatim predictors ignore it. FLAC encoding accepts `-lpc_type none|fixed|levinson|cholesky`; LPC modes use autocorrelation or covariance fits, with verbatim fallback when smaller. FLAC encoding accepts `-ch_mode indep`, `left_side`, `right_side`, or `mid_side` for lossless stereo decorrelation in raw and Ogg FLAC. FLAC Cholesky prediction accepts `-lpc_passes` (positive integer, default `2`); extra passes refine the bounded fit using residual weights. Other predictor modes ignore this setting. FLAC encoding accepts `-frame_size` from 16 through 65535 samples per frame for raw and Ogg FLAC (`0` keeps the default 2048). FLAC encoding accepts `-sample_fmt s16` for explicit 16-bit conversion and `-sample_fmt s32` for 24-bit output. FLAC encoding accepts `-compression_level 0` through `12` (`-1` selects level 5), increasing fixed-predictor search effort while preserving exact 16-bit or 24-bit PCM; compressed bytes may differ from native FFmpeg. WAV stream copy accepts `-fs` output-size limits in bytes or with SI/binary suffixes (for example, `16k` or `4Ki`). It stops before the next packet once the header and complete packets reach the limit; the resulting file may exceed that limit. Consumer resource budgets still apply. Other output formats and transcoding do not support `-fs`. FLAC trimming re-encodes exact samples while preserving 16-bit or 24-bit precision; `-c copy -t` and `-c copy -frames:a` retain whole compressed packets. Ogg output accepts `-serial_offset` (0 through 2147483647) to number logical streams consecutively; `-fflags +bitexact` starts numbering at zero unless an offset is supplied. Ogg-to-Ogg `-c copy` preserves Opus or Vorbis packets and metadata without decoding; Opus `-t` copy retains whole packets. `-page_duration` sets the target page duration in integer microseconds for Opus copy and Opus/Vorbis encoding (default `1000000`); `20000` writes one page per 20 ms Opus packet, and `0` disables duration-based flushing. Pages also flush at the Ogg lacing limit. `.ogg` output defaults to Vorbis; use `-c:a libopus` or a `.opus` filename for Opus, or `-c:a flac` for lossless Ogg FLAC. Opus encoding honors `-b:a` in bits per second, including `k` and `M` suffixes (for example, `-b:a 128k`).

`dialoguenhance` extracts dialogue from stereo into a third (front center) channel,
retaining the input frame count and sample rate. Left and right are delayed by
three quarters of the analysis window (1536 samples at 44100 Hz). It accepts
`original` (0–1), `enhance` (0–3), and `voice` (2–32), with defaults `1:1:2`.

`dcshift=0.125` adds a DC offset to every audio channel, preserving the sample rate and frame count and clipping samples to the full-scale range. `shift=0.125` is also accepted; shifts must be between -1 and 1. Limiter options are unsupported and fail explicitly.

`speechnorm=p=0.5` adjusts PCM half-wave gains, limiting loud sections and gradually restoring gain in quiet sections. Supports peak (`p`/`peak`), expansion (`e`/`expansion`), compression (`c`/`compression`), threshold (`t`/`threshold`), and gain adjustment (`r`/`raise`, `f`/`fall`). Channels are processed independently; other options fail explicitly.

`aphaser=in_gain=0.5:out_gain=0.8:delay=3:decay=0.4:speed=1` adds a phasing effect while preserving sample rate and frame count. Supports named or positional input/output gain, delay, decay, modulation speed, and triangular (`type=t`, default) or sinusoidal (`type=s`) modulation.

`asoftclip=type=tanh:threshold=0.5` soft-clips signed PCM peaks. Supports `threshold`, `output`, and `param`, with named or positional options. The default type is `tanh`; other types and oversampling beyond `oversample=1` fail explicitly.

`apsyclip=clip=0.2` applies psychoacoustic clipping to PCM audio using overlapping windows and iterative spectral masking. Supports `level_in`, `level_out`, `clip`, `diff`, `adaptive`, `iterations`, and automatic output leveling (`level`). Like FFmpeg, it preserves the sample count with a window delay and does not drain the delayed tail.

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

Frame limits accept `-frames N` for all output streams, `-frames:0 N` for an output stream index, and `-frames:a:0 N`, `-frames:v:0 N`, or `-frames:s:0 N` for a stream index within its type. PCM transcoding counts output audio frames, including a separate resampler flush frame when changing sample rate. Selectors follow output mapping order; unmatched streams have no individual frame cap. The last matching option wins. During stream copy, reaching a frame limit also stops companion copied streams at that packet end time, without requiring `-shortest`. With `-shortest`, only whole packets ending within the shortest stream's presentation are copied; AAC priming is preserved.

Use `-frames:s N` to retain at most N subtitle cues per output stream without shortening their intervals; `0` emits no cues.

Use `-fix_sub_duration` before an input to shorten overlapping subtitle events during transcoding. Each event ends no later than the next event starts; the final buffered event is omitted, matching FFmpeg 7.0.2. Stream copy retains the original events.

`asetnsamples=n=300:p=1` groups audio into 300-sample frames and pads the final frame with silence. Use `p=0` to keep a short final frame. Defaults are `n=1024:p=1`; `nb_out_samples` and `pad` are aliases. Frame boundaries are honored by `ashowinfo`, `asetpts`, `volume`, `aselect`, and `-frames:a`. For example, `asetnsamples=n=1:p=0,aselect='mod(n,2)'` keeps odd-numbered samples.

ICO output (`out.ico` or `-f ico`) with `-c:v png` writes one PNG-backed entry per mapped video stream, in mapping order. Each entry uses the first frame and must be between 1 and 256 pixels in each dimension. For example: `ffmpeg -i small.png -i large.png -map 0:v -map 1:v -c:v png out.ico`.

QOI input preserves exact RGB and RGBA pixels when decoded to PNG or RGBA raw video. QOI output (`out.qoi`, optionally `-c:v qoi`) preserves RGB and RGBA pixels, including the RGB samples of fully transparent pixels. Numbered image sequences such as `out%d.qoi` are supported. PNG `-f image2pipe -c:v png` input reads every concatenated PNG from a file or stdin, in order, at 25 fps by default (override with input `-framerate`). `-f image2pipe` writes concatenated image packets to a single file or stdout; `-c:v copy` preserves the original bytes and frame order without a container header. Numbered `-f image2 -c:v rawvideo -pix_fmt yuv420p frame%02d.Y` output writes separate `.Y`, `.U`, and `.V` plane files for each frame. Image2 input reads matching `.Y`, `.U`, and `.V` files with `-pixel_format yuv420p -video_size WIDTHxHEIGHT -i frame%02d.Y`, preserving per-frame plane order during stream copy. Image2 output honors `-c:v` independently of the filename suffix: `-c:v png -f image2 frame%02d.jpg` writes PNG frames, and neutral suffixes such as `.bin` work with an explicit encoder.

APNG output (`out.apng` or `-f apng`) writes all video frames into one animation. Use `-plays N` to set the play count (default `1`, `0` loops forever). Frame delays follow presentation timestamps; the final frame repeats the preceding interval.

`apulsator=hz=2:amount=0.8:offset_l=0:offset_r=0.5` modulates stereo audio with independent channel phase offsets. Supports sine modulation with named `hz`, `amount`, `offset_l`, and `offset_r` options while preserving sample rate and frame count. Other pulsator options are rejected.

`vibrato=f=5:d=0.5` modulates PCM pitch using an interpolated delay while preserving sample rate, channels, and frame count. Frequency (`f`, 0.1–20000 Hz) defaults to 5 Hz; depth (`d`, 0–1) defaults to 0.5. Positional `vibrato=5:0.5` is also supported. Like native FFmpeg, the filter introduces a short startup delay even at zero depth.

`pixscope` magnifies the default central 7×7 RGB sample and overlays channel statistics on frames at least 640×480, preserving dimensions and timing. Custom pixscope options are unsupported.

`ciescope=size=256` renders a square CIE 1931 xyY chromaticity plot using Rec.709/D65, with the spectral background and per-frame pixel density. `s` is an alias for `size`; the default is 512, with integer sizes from 256 to 8192 subject to media limits. Timing is preserved. Other ciescope options are unsupported.

`aexciter` enhances high-frequency harmonics in decoded PCM. It supports `level_in`,
`level_out`, `amount`, `drive`, `blend`, `freq`, `ceil`, and `listen`, including
positional options and use in audio filter chains.

`tmix=frames=3:weights=1 2 1` mixes a rolling window of frames with normalized weights, ordered oldest to newest. Startup repeats the first frame to fill the window, preserving every input timestamp. `frames` defaults to 3 (1–1024); weights default to 1 and the final weight repeats for remaining slots. Other options are unsupported.

Use `-isync INDEX` before `-i` to synchronize that MP4/MOV input with another input’s source start time. `-isync -1` disables synchronization; the option resets for each input. With `-copyts`, also pass `-start_at_zero`. Inputs without a known source start time remain unchanged.

With AAC stream copy, output-side `-ss TIME` starts at the first packet whose timestamp is at or after the requested time. Input-side seeking preserves the packet crossing the seek boundary.

For input-side stream-copy seeking (`-ss TIME -i INPUT`), `-copypriorss 0` discards video preroll before the requested start and begins at the next keyframe. `-copypriorss 1` preserves preroll, matching the default. Packet timestamps remain relative to the requested start.

MP4/MOV output `-brand mp42` sets the container major brand without changing packet bytes or timing. Brands of fewer than four characters keep the default; longer values use the first four characters.

MP4/MOV output `-movie_timescale N` sets the movie header timescale independently of video and audio time bases. Movie durations and edit-list durations are rescaled; packet timestamps and bytes are preserved. `N` must be an integer from 1 to 2147483647.

MP4/MOV output accepts `-timecode 01:02:03:04`, `-metadata timecode=01:02:03:04`, and `-metadata:s:v:0 timecode=01:02:03:04`. These create a linked timecode track using the video frame rate; stream timecode overrides the global value.

Audio `aac_adtstoasc` removes ADTS headers from AAC checksum packets and rejects incompatible codecs such as PCM before writing output. Raw AAC access units remain unchanged.

Output `-avoid_negative_ts make_non_negative` shifts leading negative decode timestamps to zero; `make_zero` shifts the first decode timestamp to zero even when positive. All streams receive the same shift and stream-copy packet bytes are preserved, including AAC priming. `disabled` and the default `auto` retain existing MP4/MOV timestamp behavior. Numeric values `1`, `2`, `0`, and `-1` are also accepted, respectively. The option resets for each output.

VPlayer input uses the next timestamp to close each subtitle cue, including empty closing lines, and converts `|` to line breaks. FFmpeg accepts `-f vplayer` or detects the content in generic `.txt` files.

AQTitle input (`-f aqtitle` or automatic detection) converts frame markers at 25 fps by default; `-subfps 50` before the input overrides the rate. Multiline captions are preserved and empty closing markers end the preceding cue. The media parser accepts the same override as `subtitleFrameRate`.

Spruce text STL input requires `-f stl`; colon-separated clocks use hundredths of a second and `|` becomes a line break. Binary EBU STL is not supported.
