# safe-bash-command-ffmpeg Headerless `-f rawvideo` output preserves YUV420, YUV422, and YUV444 planes (`yuv420p`/`yuv422p`/`yuv444p`) and writes 10- or 16-bit little-endian YUV444 (`yuv444p10le`/`yuv444p16le`) by expanding 8-bit planes; it also supports planar `gbrap` (G, B, R, A planes with native alpha rounding), packed `rgb24`, `bgr24`, `rgba`, `bgra`, `gray` (`gray8`), and `ya8` (grayscale with alpha), plus big-endian `gray16be`, `rgb48be`, and `rgba64be` via `-pix_fmt`; `-c:v copy` retains original packet bytes, including AVI row padding.

MPEG-TS `-muxrate 500000` selects a transport bitrate in bits/s, inserting null packets and pacing PCR from packet positions while preserving copied audio. `0`, `1`, or omission keeps variable-rate output; `k` and `M` suffixes are accepted. `-pcr_period` sets the PCR interval in milliseconds: `-1` or omission selects automatic timing (20 ms at constant rate), and `0` disables PCR. For example, `-muxrate 500000 -pcr_period 100` inserts PCR every 100 ms on the PMT clock PID without changing copied audio. Explicitly mapped SubRip stream copies to MPEG-TS preserve cue payloads and timestamps as private data; player subtitle recognition is not guaranteed.

H.264 encoding honors `-crf 0` through `-crf 51` (including fractional values). CRF 0 preserves YUV420 samples through `hflip` and `vflip`; higher values trade quality for smaller output. Stream copy preserves the original packets.

WavPack (`.wv`) input supports mono/stereo integer lossless audio, raw PCM output, and frame checksums. `-c:a copy -f framemd5` hashes compressed audio blocks without trailing tags. MPEG-TS output repeats PAT/PMT every 0.1 seconds; use `-pat_period 0.05` for 50 ms or `-pat_period 0.5` for 500 ms. Duration suffixes and clock notation are accepted; zero repeats the tables before each media packet. MPEG-TS groups complete AAC frames into PES payloads; `-pes_payload_size N` sets the byte target (default 2930), rounded up to TS capacity, with a maximum duration of half `-muxdelay`. `-mpegts_flags +pat_pmt_at_frames` repeats PAT/PMT before every video frame, including non-keyframes, regardless of `-pat_period`.

Output `-pix_fmt gray` (or `gray8`) removes color before encoding, after video filters.

Headerless RGB, RGBA, BGRA, YUV420, YUV422, YUV444, and grayscale input supports `-f rawvideo -pixel_format rgb24 -video_size WIDTHxHEIGHT -framerate FPS` (use `-pixel_format gbrap` for full-resolution 8-bit G/B/R/alpha planes decoded to RGBA, `-pixel_format bgra` for BGRA, `-pixel_format yuv420p` for YUV420, `yuv422p` for horizontally subsampled chroma, `yuv444p` for full-resolution Y/U/V planes, or `gray`/`gray8` for one-byte full-range grayscale, `ya8` for grayscale with alpha, or `gray16be` for big-endian 16-bit grayscale and `rgb48be`/`rgba64be` for packed big-endian 16-bit color; also `-pix_fmt`, `-s`, and `-r` before `-i`). Stream copy preserves original packets, including a partial final packet, without decoding; decoding emits complete frames only. `select=eq(pict_type\,I)` keeps every decoded rawvideo or Y4M frame; P and B selections succeed with empty raw output. Picture-type selection uses decoder metadata, independently of `key`; unavailable types evaluate to 0.

Pure in-memory `ffmpeg` and `ffprobe` commands for `safe-bash` (including local `subfile,,start,13,end,313,,:bundle.bin` byte ranges with an exclusive end for probing, decoding and seeking), backed by `@poe-code/mp4-ast` and pluggable media container ASTs (`mp4Ast`, `movAst`, `mkvAst`, `webmAst`, `mpegtsAst`, `aviAst`, `flvAst`, `y4mAst`, `aacAst`, `ac3Ast`, `wavAst`, `auAst`, `ircamAst`, `cafAst`, `aiffAst`, `mp3Ast`, `flacAst`, `oggAst`, `gifAst`, `image2Ast`). Targa output (`.tga` or `-c:v targa`) preserves RGBA pixels with top-left origin; RLE is enabled by default (`-rle 1`), and `-rle 0` writes uncompressed pixels. Matroska output writes CRC-32 checksums by default; `-write_crc32 0` disables them and `-write_crc32 1` enables them. WebM always omits CRC-32. Matroska ACM signed PCM64 audio copies to WAV with `-c:a copy`, preserving every sample bit. MP3 output retains Xing and gapless playback metadata by default; `-write_xing 0` omits them and `-write_xing 1` explicitly enables them. ICO and CUR inputs expose each PNG- or DIB-backed entry as a separate video stream, preserving transparency. FFmpeg selects the largest image automatically; use `-map 0:v:1` to select the second entry. AVI VP9 stream copy preserves the `VP90` codec tag and all compressed packets. XVID/FMP4 AVI video copies to MP4 or Matroska as MPEG-4 Part 2 with every compressed packet preserved. AVI output supports `-reserve_index_space` in bytes per stream; zero uses the default reservation. Copy IMA ADPCM WAV audio into AVI with `-c:a copy`, preserving compressed blocks and format parameters alongside optional video. H.264 stream copies from Matroska to AVI require `-bsf:v h264_mp4toannexb`; MP4 inputs convert automatically. H.264 `-c:v libx264 -qp 0` preserves decoded YUV420 samples; `-qp 1` through `-qp 51` select constant lossy quantization, and `-qp -1` uses the encoder default. AMR-WB audio in 3GP inputs decodes to mono 16 kHz PCM. Both commands accept inline `data:TYPE;base64,DATA` inputs and detect their format from the decoded bytes; input seeking and byte limits still apply.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { ffmpegCommands, cloudflareWorkerLimits } from "@poe-platform/safe-bash/commands/ffmpeg";

const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(ffmpegCommands({ limits: cloudflareWorkerLimits() }));
await shell.exec("ffmpeg -f lavfi -i color=c=red:s=16x16:r=2:d=1 -an /clip.mp4");
const probe = await shell.exec("ffprobe -show_streams -of json /clip.mp4");
await shell.dispose();
```

MPEG-TS output defaults to a 0.7-second mux delay: initial PTS is 1.4 seconds and PCR is 0.7 seconds. Use `-muxdelay 0` for zero delay or `-muxdelay 0.2` for PTS 0.4 seconds and PCR 0.2 seconds. MPEG-TS output writes a service description table; `-metadata service_name=Workshop -metadata service_provider=Studio` sets its name and provider, with independent defaults of `Service01` and `FFmpeg`. MPEG-TS AAC stream copy (`-map 0:a -c:a copy out.ts`) retains every selected audio track in map order with a separate payload PID and ISO 639 language descriptor. Use `-metadata:s:a:0 language=deu` to override the first output audio track’s language. `-mpegts_flags +initial_discontinuity` marks only the first packet of each emitted MPEG-TS PID as discontinuous, preserving media payloads and later continuity counters. Use `-mpegts_flags -initial_discontinuity` to disable it. MPEG-TS program maps (`-map 0:p:202`) select streams by program ID; `-map 0:p:202:a:0` selects the first audio stream in that program. Missing programs fail unless the map ends in `?`. `-map 0:v -c:v copy out.ts` preserves every H.264 camera angle; explicit video maps control their output order. MPEG-TS output assigns elementary PIDs in mapped order starting at 256, including audio-only output. Use `-mpegts_start_pid 384` to change the first PID (32–8186); elementary PIDs must not collide with PMT PID 4096.

MP4/MOV H.264 encoding accepts `-bf 2` for at most two consecutive B-frames, or `-bf 0` to disable them. Counts above 16 are capped at 16; `-1` keeps the default of zero. B-slices use lossless PCM macroblocks and preserve presentation order.

MP4/MOV output `-streamid 0:21 -streamid 1:43 -use_stream_ids_as_track_ids 1` assigns track IDs to output stream ordinals after mapping. Without the muxer switch, IDs remain sequential starting at 1; with it, unassigned streams use ID 0. Options apply only to the next output.

`-c:a libopencore_amrnb -b:a 12.2k` encodes mono 8000 Hz PCM into `.3gp` or `.amr` output. `-c:a libvo_amrwbenc -b:a 23.85k` encodes mono 16 kHz PCM to AMR-WB in `.3gp` or `.amr` output.

Audio stream copy from 3GP to `.amr` (or `-f amr`) writes the AMR-NB/WB header and preserves compressed frames without re-encoding.

MPEG-TS video PES lengths default to zero; `-omit_video_pes_length 0` writes each packet’s actual length when it fits in 16 bits, and `1` retains zero lengths. Audio PES lengths are unaffected. For MPEG-TS output, H.264 random access indicators mark keyframes only; `-mpegts_flags +omit_rai` suppresses the indicators without changing video payloads or PCR timestamps, and `-mpegts_flags -omit_rai` restores them. Flags can be combined with `latm`. For MPEG-TS output, `-tables_version 7` sets the PAT, PMT and SDT version (0–31, default 0). `-mpegts_service_type digital_radio` (or `2`) writes a digital radio service descriptor; the default is `digital_tv` (1). For MPEG-TS AAC output, `-mpegts_flags +latm` writes LOAS/LATM with stream type `0x11`; `-mpegts_flags -latm` and the default use ADTS with type `0x0f`. Copy M4A AAC-LC to LOAS/LATM with `-map 0:a:0 -c:a copy out.latm` or `-f latm out.bin`, preserving every compressed packet. ADTS AAC-to-M4A stream copy preserves leading ID3v2 and trailing APE text metadata. Raw AAC-LC LOAS/LATM input supports WAV decoding (`-i input.latm -map 0:a:0 -c:a pcm_s16le out.wav`) and byte-preserving stream copy (`-c:a copy out.latm`). Input detection uses the LOAS signature; `-f loas` also selects it explicitly. AAC decoding retains the complete final frame, including samples beyond the container duration; explicit `-t`/`-to` limits still trim PCM at the requested sample. ADTS output accepts `-write_mpeg2 1` for MPEG-2 headers on every frame; `0` or omission selects MPEG-4, preserving compressed AAC payloads. Audio stream copy keeps the full last packet selected by input or output `-t`/`-to`, so its end can exceed the requested cutoff. Output `-ss` with PCM WAV stream copy drops packets that start before the seek time, including in segmented output; segment lists retain the actual packet timestamps. Use `-map 0:a -c copy -f tee 'one.wav|two.wav'` to duplicate mapped audio into multiple destinations. For raw PCM output, `-c:a pcm_s16be -f s16be 'tee:first.pcm|second.pcm'` writes identical bytes to both local files and reports destination open failures. This URL protocol is separate from the tee muxer. Tee requires explicit maps; `[select=1:f=wav]one.wav` selects the second mapped output stream. Destination options support `f`, `select` (stream index or type selector), and `onfail=ignore|abort`; ignored failures are logged, and at least one destination must succeed. ADTS AAC output supports `-write_apetag 1` to append APEv2 metadata; `0` and the default leave audio frames without an APE trailer.

MP4/MOV output `-video_track_timescale N` sets the video time base to `1/N`, rescaling packet timestamps, durations, and edit offsets while preserving stream-copy packet bytes. `0` keeps the default. `-map 0:1 -c copy -f data output.bin` writes the selected stream’s packet payloads without a container header; the data muxer requires exactly one stream and also supports stdout. Data stream maps (`-map 0:d` or `-map 0:d:0`) select timecode tracks; output container support still applies. Video-only stream maps such as `-map 0:v -c copy` retain the source video's timecode track and link. `-map 0 -dn -c copy` suppresses copying input data streams while retaining the video’s linked timecode for MP4/MOV output. `-write_tmcd 0` disables timecode output; `-write_tmcd 1` (or the automatic default, `-1`) preserves it when present.

Subtitle `-bsf:s mov2textsub` removes the two-byte text length and trailing style data from each packet; `text2movsub` prepends the two-byte length without changing text or markup. Both preserve packet timestamps, durations, and gap packets and can be chained with `null`.

Matroska/WebM `-default_mode passthrough` preserves default-track flags (the default). `infer` marks the first track of each audio, video, and subtitle type as default when that type has no default; `infer_no_subs` infers only audio and video defaults. Explicit defaults are preserved.

Matroska/WebM video output includes a keyframe seek index. VP9 stream copy automatically joins invisible frames with the next displayed frame into a superframe, preserving decoded frames and already-packed packets. Bitstream filters (`-bsf[:stream_specifier]`) support `null` and chains of `null`. HEVC `hevc_metadata=crop_right=12:crop_top=6:crop_bottom=4` changes the visible conformance window without re-encoding pictures. All four `crop_left`, `crop_right`, `crop_top`, and `crop_bottom` offsets are in pixels and must match the input chroma alignment (even offsets for 4:2:0, any pixel for 4:4:4); omitted or `-1` offsets stay unchanged, and zero clears an offset. VP9 `-bsf:v vp9_metadata=color_space=bt709:color_range=pc` edits coded color headers during stream copy, including packed superframes. Color spaces are `unknown`, `bt601`, `bt709`, `smpte170`, `smpte240`, and `bt2020`; ranges are `tv` and `pc`. Numeric values and `-1` (keep unchanged) are accepted. RGB syntax transitions are unsupported. `-bsf:v` also supports H.264 `filter_units=remove_types=6` (pipe-separated types and inclusive ranges) and `h264_metadata=aud=insert` and `h264_metadata=level=4.1:colour_primaries=1` (rewriting configuration and in-band sequence parameters), applied in chain order. H.264 `h264_metadata=display_orientation=insert:rotate=90` adds anticlockwise rotation; `flip=horizontal`, `vertical`, or `horizontal+vertical` sets mirroring. Orientation is inserted at the first packet, keyframes, and in-band sequence parameters. `display_orientation=remove` removes only orientation SEI, preserving unrelated messages and encoded video. AV1 `av1_metadata=color_primaries=9:transfer_characteristics=16:matrix_coefficients=9:color_range=pc` rewrites sequence headers in copied packets and decoder configuration. Color range accepts `tv`/`pc`; `chroma_sample_position=vertical` or `colocated` sets left or top-left chroma signaling for 4:2:0 streams. `h264_metadata=sei_user_data=12345678-1234-5678-9abc-def012345678+take-42` inserts UUID-tagged, NUL-terminated UTF-8 user data into coded SEI packets at the first packet, keyframes, and in-band sequence headers, preserving encoded pictures. AV1 `av1_metadata=tick_rate=30000/1001:num_ticks_per_picture=1` edits sequence-header timing in configuration and packets without retiming frames. `-bsf:v` and `-bsf:a` support `chomp` to strip trailing zero bytes from each packet while preserving timestamps and duration. They also support `noise=drop=EXPR` with packet index `n` (starting at zero), for example `noise=drop=gte(n\,2)` to keep the first two packets. Positive results drop packets; zero keeps the original bytes and timestamps without adding noise. Negative probabilistic drop values are unsupported. Audio `-bsf:a opus_metadata=gain=1536` replaces Opus playback gain without changing compressed packets (1536 is +6 dB). Gain accepts signed integers from -32768 to 32767 in 1/256 dB units; zero or bare `opus_metadata` clears the gain. Audio `pcm_rechunk=n=8:p=0` repackets interleaved PCM into eight-sample packets, keeping a short final packet; `p=1` (the default) pads the last packet with zero bytes. The default packet size is 1024; `nb_out_samples` and `pad` are aliases for `n` and `p`. Use `pcm_rechunk=r=30000/1001:p=0` (or `frame_rate=30000/1001:pad=0`) to align packets to a fractional video rate without sample drift. A nonzero rate overrides `n`; `r=0` restores fixed-size packets. `setts=ts=TS+200:duration=10` changes packet timestamps and duration in stream time-base units while preserving payloads. `pts` and `dts` expressions override the shared `ts` expression; expressions support `N`, `TS`, `PTS`, `DTS`, `DURATION`, `STARTPTS`, `STARTDTS`, `TB`, and `SR`. Filters run in chain order, including after PCM rechunking. Unsupported filters, options, and empty chain entries fail before replacing output.

H.264 encoding accepts `-b:v 200k` for a target average bitrate (also plain bits per second or `M` suffix); zero keeps the encoder default. Short clips can differ from the requested average. Stream copy preserves the original packets. H.264 MP4/MOV encoding accepts `-force_key_frames 0.75` or comma-separated timestamps such as `0.5,1.25`, preserving frame timestamps. Expression and chapter forms are unsupported.

Output `-aspect[:stream_specifier] RATIO` sets the display aspect ratio (for example, `16:9` or `1.7777778`). With MP4 stream copy, it updates pixel-aspect metadata without changing encoded dimensions or packet bytes. Use `-aspect:v:1 1:1` to target only the second output video stream.

MP4 stream copy preserves the combined movie and track display transform, including rotations that cancel. Input `-display_rotation[:stream_specifier] ANGLE` overrides matching video streams before mapping; for example, `-display_rotation:v:0 90 -i clip.mp4` rotates the first input video. Unmatched selectors leave orientation unchanged. Input `-display_hflip[:stream_specifier]` and `-display_vflip[:stream_specifier]` set horizontal and vertical display reflections without changing stream-copy sample bytes. They combine with `-display_rotation` before mapping and apply only to the next input. Like FFmpeg 7, `-metadata:s:v:0 rotate=90` does not change the display matrix; use `-display_rotation` before the input to override orientation.

Register the plugin explicitly; importing it does not enable commands. PCM16 NIST SPHERE (`.sph`) input supports both byte orders and signature detection without a filename extension. Media I/O
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
`pad` preserves source YUV planes, including subsampled and 10/16-bit samples, and fills borders in the source colorspace. Color options (including `pad` fills) accept FFmpeg’s 140 case-insensitive named colors, including `tomato`, `LightSteelBlue`, and `LightGrey`, with optional `@alpha`. Unsupported names such as `grey` and `LightGray` fail before replacing output.

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
`-xerror` stops subtitle decoding at the first invalid UTF-8 cue and returns status
183, preserving only earlier cues in the output. Stream copy does not decode.
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
Frame reports default to `framelog=info`; `framelog=verbose` requires `-v verbose`
or higher. The final summary uses the info log level.
Use `ebur128=dualmono=true` to compensate mono loudness for stereo playback;
`panlaw` sets the pan law from -10 to 0 dB (default -3.0103 dB).
Stereo and multichannel measurements are unaffected.
Numeric `peak=2` and `peak=3` also enable sample peaks; `peak=0`, `peak=1`,
`peak=none`, and plain `ebur128` omit them. Use `peak=true` (4 or 5) for intersample true peaks or `peak=sample+true` (6 or 7)
for both peak measurements, including the final partial interval. True peaks are
measured at 192 kHz per channel; interval reports include FTPK and cumulative TPK.
Video output is unsupported.
`ebur128=metadata=1` attaches `lavfi.r128.M`, `S`, `I`, `LRA`, `LRA.low`, and
`LRA.high` tags to 100 ms audio frames, plus per-channel and overall peak tags
when enabled. A final shorter frame retains its samples without a new measurement.
Use `ametadata=mode=print` downstream to read tags. The final summary remains
enabled; periodic measurement logs move to verbose level.
`ebur128=target=-16:scale=relative` reports M/S/I relative to the target in LU;
`target` ranges from -23 to 0 LUFS (default -23), and `scale=absolute` (default)
keeps measurements in LUFS. Scale aliases are `LUFS`/`0` and `LU`/`1`.
The final summary always stays absolute; loudness range and sample peaks are unchanged.
`loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json` normalizes mono or stereo
samples and reports measured input/output loudness, peaks, range, and thresholds.
Use `-ar 48000` to resample its 192 kHz output. Supports `I`, `TP`, `LRA`
(and lowercase aliases), plus `print_format=none|json|summary`; two-pass measured
options and multichannel layouts are unsupported. Short clips use peak-constrained
linear gain; longer clips use smoothed loudness gain and a linked lookahead limiter.
`atrim=start_sample=2025:end_sample=3123` keeps sample frames 2025 through 3122 unchanged. Sample and PTS bounds accept expressions with `PI`, `E`, and `PHI`; results round to the nearest integer, with exact halves rounded to even (`atrim=end_sample=PI` keeps three samples). Retained samples keep their source timestamps for downstream filters such as `afade`; add `asetpts=PTS-STARTPTS` after trimming to start the timeline at zero.
`atrim=start_sample=2:duration=0.0005` retains four samples at 8 kHz, starting at sample 2.
`duration` (alias `durationi`) is relative to the first retained timestamp; zero leaves duration unset.
When combined with `end` or `end_sample`, the latest end wins.
Sample and PTS bounds accept native 64-bit values and expressions and round to the nearest integer, with ties to even; `start_sample=-1` leaves the sample start unset, and PTS bounds of `-9223372036854775808` leave that timestamp bound unset.
PTS bounds accept hexadecimal literals such as `0x2`; binary (`0b10`) and octal (`0o2`) literals are rejected without replacing existing output.
Use `atrim=start=0.253:end=0.390` for time bounds in seconds; `starti` and `endi` are aliases for `start` and `end`. End bounds are exclusive. Clock durations work with escaped colons, for example `atrim=end='00\:00\:00.00025'` keeps two samples at 8 kHz.
Integer sample and PTS bounds accept `min`, `max`, `default`, and `none` (`0`) in expressions. Constants follow each option’s range and default: `end_sample=min` keeps no samples, `end_sample=default` keeps the whole clip, and PTS `min`/`default` disable that bound.
Repeated `atrim` options use their last value; distinct time and sample bounds keep the earliest start and latest end.
Use `atrim=start_pts=2:end_pts=8` for timestamp bounds in sample units, even after `asettb` changes the input time base. Time and PTS bounds apply to each frame independently, including overlapping timestamps from `asetpts`; `start_sample` and `end_sample` count input sample frames regardless of timestamps. When `asetpts=NAN` or an expression such as `asetpts=0/0` removes timestamps, `atrim` evaluates time and PTS bounds by counting samples from the preceding timestamp (or zero initially).
Positional options follow `start:end:start_pts:end_pts:duration:start_sample:end_sample`. Invalid `atrim` bounds return exit status 234; out-of-range values return 222. Both preserve existing output and create no new output file.
`asettb=expr=1/1000` changes the audio time base to milliseconds without changing PCM samples; `asettb=intb` preserves the incoming time base. Expressions accept `intb`, `sr` (sample rate), and `AVTB` (microseconds); `tb` aliases `expr`. Timestamp expressions and `ashowinfo` use the selected ticks: `asettb=1/1000,asetpts=PTS+100,atrim=start=0.15` shifts audio by 0.1 seconds before trimming.
`asetpts` exposes `FR`/`FRAME_RATE` as `NaN` for audio; use `isnan(FR)` to test the unknown video frame rate. `asetpts=PTS-STARTPTS` resets audio timestamps; `asetpts=PTS-STARTT/TB` does the same using the first timestamp in seconds; `asetpts=PTS+0.5/TB` shifts them by half a second. Expressions also accept `POS` (the input packet byte position, preserved through `areverse`, or `NaN` when unavailable), `T` (current timestamp in seconds), `N`/`NB_CONSUMED_SAMPLES` (samples consumed before the current frame), and `S`/`NB_SAMPLES` (current frame size). `PREV_OUTPTS` and `PREV_OUTT` carry the previous output frame timestamp in ticks and seconds; both start as `NaN`. For example, `asetpts=if(isnan(PREV_OUTPTS)\,0\,PREV_OUTPTS+4)` places frames four ticks apart. `PREV_INPTS` and `PREV_INT` give the previous input frame timestamp in ticks and seconds; both are `NaN` on the first frame. For example, `asetpts=if(isnan(PREV_INPTS)\,0\,PREV_INPTS+2)` uses a first-frame fallback before referencing input history. `INTERLACED` is `0` for audio frames, so `asetpts=PTS+INTERLACED` preserves timestamps. Output time limits honor shifted audio frame timestamps while preserving the retained PCM samples. Overlapping timestamps such as `asetpts=PTS/2` and `asetpts=NB_SAMPLES` apply the duration to each frame, including partial frames.
Both forms apply to every channel and may omit either bound.
`compensationdelay=cm=34:mm=3:dry=0:wet=1` delays every channel by the sound travel time for the supplied distance, preserving sample rate and frame count. Supports `mm`, `cm`, `m`, `dry`, `wet`, and `temp` (Celsius), including positional options. Numeric options accept expressions such as `m=1/2+1` and `dry=1/2`; distance and temperature round to the nearest integer, with exact halves rounded to even. Invalid or out-of-range values fail before replacing existing output. Delayed samples start with silence and the tail is trimmed to the original length. The `enable` expression selects whole input frames using `t` (seconds) or `n` (frame index); bypassed frames pass through unchanged while delay history continues.

`flanger=delay=2:depth=4:regen=20:width=60:speed=2` applies a modulated delay with feedback to each PCM channel, preserving duration. Bare `flanger` uses native defaults. Supports positional and named `delay`, `depth`, `regen`, `width`, `speed`, `shape` (`sinusoidal`/`s` or `triangular`/`t`), `phase`, and `interp` (`linear` or `quadratic`) options. Invalid options preserve existing output.

`aecho=0.5:1:1|2:0.5|0.25` mixes delayed copies independently into each audio channel and drains the full longest-delay tail. Supports positional or named `in_gain`, `out_gain`, `delays` (milliseconds), and `decays`; delay and decay lists accept decimal or hexadecimal numeric prefixes and must have matching lengths. Unknown options return exit status 8, out-of-range gains return 222, and unequal delay/decay list lengths return 234. These errors preserve existing output. With `-y`, positive delays that all round down to zero samples fail during filter configuration and leave the output file empty; a one-sample delay succeeds.

`chorus=0.5:0.9:10|20:0.5|0.3:1|2:1|2` mixes modulated voices independently into each PCM channel and emits the complete delayed tail. Supports positional or named `in_gain`, `out_gain`, `delays`, `decays`, `speeds`, and `depths`. The four voice lists are required and must have matching lengths; delays and depths are in milliseconds, speeds in Hz. Voice lists accept hexadecimal floats: delay `0x10` is 16 ms, as is `0x1p4`. Like native FFmpeg, depth controls the sinusoidal voice offsets, while the largest delay plus depth determines tail duration. Invalid options or resource limits preserve existing output.

`adelay=0S|1S` delays each audio channel independently and pads with silence.
`asendcmd=c='0.003 adelay@d delays 0S|5S',adelay@d=0S|3S` updates the named delay
at the first incoming audio frame at or after 0.003 seconds. Delay changes resize the
channel buffers while retaining their history; the EOF tail keeps the largest delay
used. Target `adelay` selects the first subsequent delay instance. Runtime lists update
only the supplied channels, even with `all=1`; invalid entries stop the update while
retaining earlier channel changes.
Use uppercase `S` after an integer for sample frames, lowercase `s` after an integer
for seconds, or a numeric prefix (optionally followed by `ms`) for milliseconds.
Hexadecimal milliseconds accept fractions and binary exponents: `0x1p-2` delays by 0.25 ms.
Leading `+` and trailing text are accepted, as in `+2S`, `0.5ms`, or `2Sabc`. `adelay=1S:all=1` repeats the last delay for remaining channels.
Positional values after named options follow native FFmpeg ordering: `adelay=1S:all=1:2S` replaces the delay with two samples for every channel; `adelay=1S:enable=1:2S` delays only the first channel by two samples.
Negative delays are accepted only when they truncate to zero samples: at 8 kHz,
`-0.1249` milliseconds is accepted, while `-0.125` is rejected.
`all` accepts signed or zero-padded decimal `1`/`0` (such as `+1`, `0001`, or `-0`)
and case-insensitive `true`/`false`, `yes`/`no`, `y`/`n`, `on`/`off`,
`enable`/`disable`, and `enabled`/`disabled`, in named or positional form.
When false or omitted, unspecified channels are unchanged. Empty entries are skipped,
so `adelay=|1S` delays the first channel. Omitted delays pass audio through unchanged,
including `adelay`, `adelay=`, and `adelay=all=1`.
Output timestamps use the sample-rate time base, even after `asettb` and with empty or zero delays.
`enable` expressions accept the mathematical constants `PI`, `E`, and `PHI` and are evaluated at input frame timestamps, as in
`adelay=0S|23S:enable='gte(t,0.3)'`. Expressions expose the frame index `n`, time `t`,
input packet byte offset `pos` (NaN when unknown), and audio dimensions `w` and `h` (both zero).
Disabled frames pass through and freeze
the delay buffers. Common leading silence and the full delayed tail are retained;
the final input frame’s enable state controls whether the tail drains buffered audio or emits silence.
`NaN` and computed NaN conditions bypass the delay; `INF` and computed infinity enable it.
`isnan` and `isinf` can test these values in enable expressions.
`asetrate=16000` changes the sample rate without resampling PCM, changing playback speed and duration. Later filters use the new rate; `r` and `sample_rate` are accepted option names.
`format` accepts `monob`, `pal8`, `rgba`, `bgra`, `rgb24`, `bgr24`, `gray`, `gray8`, `ya8` (grayscale with alpha), `rgba64be`, `rgb48be`, `gray16be`, `yuv420p`, `yuv422p`, and `yuv444p`, directly or with `pix_fmts=`, including `|`-separated lists. `monob` uses ordered monochrome dithering, discards alpha, and writes packed 1-bit grayscale PNGs. `pal8` uses FFmpeg’s fixed 256-color palette with error diffusion, discards alpha, and writes 8-bit indexed PNGs. `gray` and `gray8` use full-range BT.601 luminance, discard alpha, and write single-channel grayscale PNGs. For planar YUV input, grayscale uses the Y plane directly and expands limited-range luma, so chroma cannot change brightness. `pad` converts border colors to grayscale on grayscale inputs and preserves alpha on `ya8` inputs. The 16-bit formats write 16-bit PNG samples with RGBA, RGB, or grayscale layout respectively, expanding the decoded 8-bit channels. The YUV formats convert to limited-range BT.601 with the selected chroma subsampling and discard alpha before subsequent filters run. Every list entry is validated before output is replaced. Other pixel formats and options (including `color_spaces` and `color_ranges`) are unsupported and fail explicitly.
`transpose` preserves native YUV420/YUV444 plane samples in every direction; inverse transposes recover the original bytes. This includes 10- and 16-bit YUV444, whose original plane samples are also preserved by `hflip` and `vflip`. Rotating swaps the sample aspect ratio numerator and denominator, including for downstream filter expressions; passthrough keeps the original ratio. `transpose`, `hflip`, and `vflip` also preserve full 16-bit RGB and alpha precision in `rgb48be` and `rgba64be` frames. Its `dir` and `passthrough` options accept arithmetic, named values, and `PI`/`E`/`PHI`, rounding half-integers to the nearest even integer. Invalid expressions fail before replacing output.
Default `scale` on decoded H.264 uses native YUV pixels before RGB conversion.
`scale` accepts width/height expressions, including `ow`/`out_w` and `oh`/`out_h` references to the opposite output dimension, and `flags=neighbor`, `bilinear`, `bicubic`, `area`, or `lanczos`. Area averages pixel coverage when reducing and uses bilinear sampling when enlarging.
`force_original_aspect_ratio=decrease|increase` fits the requested bounds; `force_divisible_by=1..256` rounds constrained sizes down or up to multiples (default 1). Divisibility has no effect when aspect fitting is disabled.
Invalid expressions, unsupported flags, and unsupported options fail before replacing output.
`datascope=size=320x240` renders monochrome hexadecimal RGB pixel values for each frame, preserving timing. `s` and positional size are also accepted; the default is `1280x720` (`hd720`). Other datascope options are unsupported.

`untile=3x1` splits contact sheets into frames in row order, including blank cells. It accepts `layout=3x1`, defaults to `6x5`, and requires sheet dimensions divisible by the grid.

`tile=3x1:init_padding=1` leaves the first cell blank before placing input frames. Initial blank cells use the background color and participate in overlap; values at or above the frame capacity are ignored. Rejected tile margins/padding return Linux FFmpeg status 222 when out of range or 234 when invalid; unknown options return 8 and unsupported `enable` returns 176, preserving existing output files.

`tile=3x1:overlap=1` carries the last frame of each contact sheet into the next sheet. Overlap is capped at one less than `nb_frames` (or the grid capacity); a partial final sheet is padded with the tile background color. Tiling preserves decoded planar YUV samples, including chroma subsampling and 10/16-bit YUV444, without an RGB round trip. Numeric tile options (`nb_frames`, `margin`, `padding`, `overlap`, and `init_padding`) accept expressions and round to the nearest integer, with ties to even: `padding=1+1` uses two pixels and `margin=0.5` uses zero. Option bounds are checked before rounding; the rounded frame count must fit the grid.

Numbered image output applies `-r` after video filters using CFR frame selection. `setpts` exposes `FR`/`FRAME_RATE` (the incoming frame rate) and `INTERLACED` (1 for interlaced frames, 0 for progressive frames). `setpts` expressions accept `PTS` and `STARTPTS` in time-base ticks, `N` (zero-based input frame number), `T` and `STARTT` (current and first input timestamps in seconds), and `TB` (seconds per tick). For example, `setpts=N/TB/5` spaces frames at 5 fps, and `setpts=PTS-STARTT/TB` resets the timeline to zero. `setpts` expressions support `PREV_INPTS`/`PREV_OUTPTS` in time-base ticks and `PREV_INT`/`PREV_OUTT` in seconds, initially `NaN`; use `isnan` to seed the first frame and `TB` to convert seconds to ticks. `setpts` retains frame durations, matching FFmpeg 9; FFmpeg 7 cleared durations and can emit fewer frames. After `setpts`, `fps=source_fps` fails with status 234 and truncates rawvideo output because the source rate is unknown. Use an explicit rate such as `fps=5`; it also restores the rate for later `fps=source_fps` filters. Output `-r` requires automatic or constant-frame-rate sync (`-fps_mode auto` or `cfr`). Combining it with `passthrough`, `vfr`, or `drop` (including legacy `-vsync` equivalents) fails before replacing output files.

`select=gt(scene\,0.15)` keeps frames whose scene-change score exceeds 0.15; `select=eq(scene\,0)` keeps zero-score frames, including the first frame. Scores use consecutive input frames, including rejected ones, and the change in their mean absolute pixel difference. Planar YUV compares luma only and preserves native sample precision. Use `-fps_mode passthrough` to retain selected timestamps.

`mpdecimate` removes near-duplicate decoded RGB frames using default 8×8 block thresholds against the last retained frame. Use `-fps_mode passthrough` to preserve their original timestamps. Custom mpdecimate options are unsupported.
`decimate=cycle=4` (or `decimate=4`) drops one frame per complete cycle, preferring duplicates and otherwise using scene changes and overlapping block differences (32×32 by default). Rejected decimate cycles return Linux FFmpeg statuses 222 (out of range) or 234 (invalid expression); unknown options return 8 and unsupported timeline options return 176, preserving existing output files. Set `blockx` and `blocky` independently to powers of two from 4 to 512, for example `decimate=cycle=4:blockx=8:blocky=8`; the duplicate threshold scales with the selected block area. The default cycle is 5; supported cycles are 2–25. Cycle values accept expressions such as `2*2` and `default`, and round to the nearest integer with ties to even (`3.5` and `4.5` both select cycle 4). A trailing colon is accepted, and repeated `cycle` assignments use the last value (for example, `decimate=cycle=4:cycle=3:`). Incomplete final cycles are retained, and output timestamps use the reduced frame rate. Use `-fps_mode passthrough` to write each retained frame once. Add `mixed=1` to retain all frames in cycles without duplicates; mixed mode uses the original frame duration for retained cycles and the reduced frame rate for decimated cycles. Set `dupthresh` from 0 to 100 to adjust the duplicate threshold percentage (default 1.1), for example `decimate=cycle=4:dupthresh=0`. Zero prevents even identical frames from taking priority over scene changes. Set `scthresh` from 0 to 100 to adjust the scene-change threshold percentage (default 15), for example `decimate=cycle=4:scthresh=100`. Chroma participates by default (`chroma=1`); `decimate=cycle=4:chroma=0` compares luma alone when choosing which frame to drop. Use `[preprocessed][clean]decimate=cycle=4:ppsrc=1[out]` to choose frames using the first input and emit untouched pixels from the second input; `ppsrc=0` retains the one-input behavior. Two-input EOF discards a pending final singleton.

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

Hash final encoded output bytes with `-f s16be -c:a pcm_s16be md5:digest.txt`,
or use `md5:` to print the digest to stdout. The protocol writes 32 lowercase hex
characters followed by a newline and hashes container headers when present.

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

Input `-ch_layout` and its `-channel_layout` alias accept `mono`, `stereo`, `FC+LFE`, `2.1`, `3.0`, `quad`, and `5.1` before `-i`. WAV headers retain their channel count and speaker assignments when the supplied layout disagrees; for example, `-ch_layout FC+LFE -i stereo.wav -af 'pan=mono|c0=FR'` still extracts the WAV’s right channel. Raw PCM input uses the supplied layout’s channel count and speaker assignments, including the distinct LFE and center channels in `2.1` and `3.0`. Input `-guess_layout_max N` limits channel-layout guessing for unmasked WAV audio to at most N channels. With stereo input, 0 or 1 retains an unknown two-channel layout; 2 guesses stereo. Explicit layouts remain unchanged, and the option resets for each input.
WAV input `-max_size 2049` limits PCM16 mono packets to 2048 bytes after sample alignment. Place it before the affected `-i`; zero (the default) selects automatic packet sizing. This is independent of the output file limit `-fs`.

WAV ID3 `CHAP` frames supply chapter times and nested titles to ffprobe and FFmetadata output; `-map_chapters -1` suppresses them.

Piped WAV input requires `fmt ` before the first `data` chunk; invalid order fails before opening output. Seekable filename input still accepts data before the format. WAV input `-ignore_length 1` reads audio through EOF when a recording outgrows its data header. Piped WAV input preserves every PCM data chunk for decoding, stream copy, and ffprobe packet reports; filename input selects the last data chunk. Place it before the affected `-i`; `-ignore_length 0` (the default) honors the declared length.

Quad WAV supports `-ac 1` and `-ac 2`, mixing back speakers into their matching front sides with normalized FFmpeg weights. Stream copy retains all four speakers and the quad channel mask.

Output `-ac 6` upmixes 3.0, 2.1, and quad WAV to 5.1, preserving each named speaker (including LFE) and leaving absent speakers silent.

Output `-ac 1`, `-ac 2`, and `-ac 6` downmix 7.1 WAV to mono, stereo, and 5.1 with normalized FFmpeg speaker weights. Mono and stereo omit LFE; 5.1 retains LFE and folds side speakers into the corresponding back speakers.

Output `-ac 8` expands 5.1(back) and 5.1(side) WAV to 7.1, preserving each named speaker and leaving the missing side or rear pair silent.

Output `-ac 2` downmixes 5.1(back) and 5.1(side) WAV to stereo, mixing center into both sides and each surround into its corresponding side, excluding LFE. Three-channel WAV downmixing with `-ac 1` or `-ac 2` respects the channel mask: 3.0 mixes front center into the output, while 2.1 excludes LFE.
With `-c:v copy`, output `-ss` starts at the next video keyframe, preserving its timestamp gap; input `-ss` retains the preceding keyframe for preroll. Decoded-video input/output `-ss` and input `-sseof` round to the nearest video timebase tick, with half ticks rounding upward: at 4 fps, `-ss 1.01` retains the 1.0-second frame, while `-ss 1.125` starts at 1.25 seconds.
With `-c:a copy`, input `-ss` seeks to the exact sample frame; output `-ss` starts at the next raw packet. Transcoding seeks to the exact sample in either position.

Copy AAC from M4A into WAV with `ffmpeg -i input.m4a -map 0:a:0 -c:a copy out.wav`, preserving compressed packets and decoder configuration.

WAV output to stdout uses unknown (`0xffffffff`) RIFF and data lengths; regular files contain finalized lengths. WAV output writes the encoder identification in LIST/INFO even with `-map_metadata -1`. Use `-bitexact` or `-fflags +bitexact` to omit it while preserving user tags and PCM audio.

WAV output accepts `-write_channel_mask 0` and `-write_channel_mask 1`; both preserve the channel mask and speaker order, including 5.1(side), during encoding and stream copy.

WAV output accepts `-write_bext 1` to write Broadcast Wave metadata (`description`, `originator`, `originator_reference`, `origination_date`, `origination_time`, `time_reference`, and `coding_history`) supplied with `-metadata`. The default and `-write_bext 0` omit the extension.

WAV output accepts `-write_peak on` to append a peak envelope, `-write_peak only` for the envelope without audio, and `-write_peak off` (the default) to omit it. Numeric values `1`, `2`, and `0` are also accepted. Peak envelopes require 16-bit PCM output and default to 256-frame blocks with positive and negative peaks per channel. Set `-peak_block_size 0..65536` (0 omits the envelope), `-peak_format 1|2` for byte width, and `-peak_ppv 1|2` for one magnitude or separate positive/negative peaks.

For headerless PCM, place `-skip_initial_bytes N` before `-i` to skip N input bytes before decoding. For example, `-f s16le -ar 8000 -ac 2 -skip_initial_bytes 4 -i input.raw output.wav` skips one stereo frame. The offset applies only to the next input.

WAV output accepts `-rf64 always` for RF64 with 64-bit sizes, `-rf64 auto` to reserve a size chunk and use RF64 when RIFF overflows, and `-rf64 never` (the default) for ordinary RIFF.

Read and write Sony Wave64 with `ffmpeg -i input.wav output.w64` or `ffmpeg -i input.w64 -c:a pcm_s16le output.wav`; `-f w64` selects the format explicitly.

Read QuickTime IMA ADPCM AIFF-C audio (`ima4`) and convert it to PCM; write mono or stereo audio with `-c:a adpcm_ima_qt output.aiff`. Read and write AIFF-C G.711 audio with `-c:a pcm_alaw` or `-c:a pcm_mulaw`. Read and write AIFF-C floating-point audio with `fl32` and `fl64` compression tags (`-c:a pcm_f32be` or `-c:a pcm_f64be`). Read G.711 AIFF-C audio with `alaw` and `ulaw` compression tags. Read and write uncompressed AIFF (`.aiff`, `.aif`, or `-f aiff`) with signed 8/16/24/32-bit PCM. Input widths from 1 to 32 bits use the next whole-byte signed PCM storage size; output defaults to `pcm_s16be`. Select `-c:a pcm_s16le` to write little-endian PCM in AIFF-C (`sowt`). When an input has multiple sound chunks, files decode the last chunk; stdin decodes the first chunk after the audio header. Piped AIFF input requires `COMM` before `SSND`; filename input accepts either order.

Read and write CAF audio (`.caf` or `-f caf`) with signed 8/16/24/32-bit PCM or 32/64-bit floating-point samples in either byte order. CAF LPCM input reads variable packet sizes and frame counts from the packet table when the description leaves either field zero. PCM downmixing honors CAF speaker bitmaps: front-center/LFE audio keeps the center channel when converted to mono. Layout chunks after the audio data apply to file input; stdin uses only preceding layout chunks. CAF input and output also support G.711 μ-law (`pcm_mulaw`) and A-law (`pcm_alaw`). QuickTime IMA ADPCM (`adpcm_ima_qt`) CAF input supports decoding and stream copy to CAF or MOV, preserving packet padding. Encode mono or stereo IMA4 with `-c:a adpcm_ima_qt output.caf`; the final packet is padded to 64 frames. Output defaults to `pcm_s16be`; `-c:a copy` preserves encoded PCM samples. Known CAF mono/stereo layouts are retained; quad stream copies use the native FFmpeg 7.0.2 `quad(side)` output layout.

Copy PCM audio into native-readable NUT with `ffmpeg -i input.wav -c copy output.nut`.

Read Creative Voice PCM8 (including legacy stereo extensions), PCM16 and G.711 audio, including continuation blocks, with
`ffmpeg -i input.voc -c:a pcm_s16le output.wav`; use `-f voc` before `-i` for explicit input selection.
Write VOC with `ffmpeg -i input.wav -c:a pcm_s16le output.voc` or `-f voc`. PCM16 is the default; G.711 encoding and `-c:a copy` are also supported.

Read and write Sun AU audio with `ffmpeg -i input.wav output.au` or
`ffmpeg -i input.au -c:a pcm_s16le output.wav`. AU defaults to big-endian PCM16. Encode mono 16000 Hz audio as G.722 with `-c:a g722 -b:a 64000 -f au output.au`; G.722 AU input also decodes to PCM. Encode mono 8000 Hz audio as little-endian G.726 with `-c:a g726le -b:a 32000 -f au output.au` (32 kbit/s only).
Read native IRCAM PCM16 and float32 files in either byte order, plus mu-law and A-law, by automatic detection or `-f ircam -i input`; stereo channels and sample values are preserved.

Encode mono or stereo Yamaha ADPCM WAV with `-c:a adpcm_yamaha output.wav`. Encode mono 8000 Hz PCM to G.726 WAV with `-c:a g726 output.wav` (32 kbit/s by default); `-b:a 16k`, `24k`, `32k`, or `40k` selects the bitrate. Encode mono or stereo Microsoft ADPCM WAV with `-c:a adpcm_ms output.wav`, or decode it to PCM including padded final blocks. Microsoft ADPCM encoding also accepts `-block_size` (32–8192, power of two; default 1024). Encode mono or stereo IMA ADPCM WAV with `-c:a adpcm_ima_wav output.wav`; `-block_size` selects a power-of-two block size from 32 through 8192 bytes (default: 1024). Select `-trellis 1..16` for trellis encoding; `-trellis 0` (the default) uses greedy encoding. Three-channel input defaults to stereo; an explicit output `-ac 3` is rejected.

AIFF stream copy preserves title, author, copyright and comment in standard text chunks; `-metadata author=Speaker -metadata comment=Interview -metadata copyright=Studio` sets or overrides them without enabling ID3. AIFF output supports `-write_id3v2 0|1` (default `0`) and `-id3v2_version 3|4` (default `4`) to write an embedded ID3 metadata chunk while preserving copied audio.

ADTS AAC output supports `-write_id3v2 0|1` (default `0`). Enabling it writes ID3v2.4 metadata before the first ADTS frame, preserving copied AAC packets: `ffmpeg -i input.m4a -c:a copy -write_id3v2 1 output.aac`.

MP3 output supports `-id3v2_version 0|3|4` (default `4`; `0` omits ID3v2) and `-write_id3v1 0|1` (default `0`). Stream copy preserves audio packets while rewriting tags.

Ogg Opus input supports audio filters such as `-af volume=0`, with encoder delay and final padding removed. Stream copy from Ogg or Matroska into MP4 preserves the Opus decoder configuration and timing, including `-copyts` behavior.
WAV extraction decodes Ogg Opus/Vorbis, AAC and CBR/VBR MP3 in memory, honoring MP4 edit timing
and MP3 encoder delay and padding:
`ffmpeg -y -i input.mp4 -vn -c:a pcm_s16le audio.wav`. Corrupt or unsupported
audio fails without replacing an existing output. Audio filters, `-ar`, and `-ac` accept AAC input as well as decoded PCM
input, such as WAV or a `lavfi` source. `[0:a][1:a]amix=inputs=2:duration=shortest:normalize=0[mix]` mixes two decoded PCM inputs with matching channel layouts, resampling the second input to the first input’s sample rate before mixing. `normalize` accepts native case-insensitive Boolean spellings, including `true`/`false`, `yes`/`no`, and `on`/`off`, as well as `1`/`0`; false adds input levels without normalization. `duration` accepts `longest` (default), `shortest`, or `first`; `weights` sets input gains using native numeric tokens (including `dB` and SI suffixes), repeats the final weight when needed, and ignores weights beyond the two inputs; `dropout_transition` controls normalization after an input ends (default 2 seconds, 0 for an immediate change). `inputs`, `duration`, and `dropout_transition` accept numeric expressions such as `inputs=1+1:duration=shortest+0:dropout_transition=1/2`. Integer options round to nearest with ties to even; invalid numeric options fail without replacing output. WAV PCM dropout transitions follow native frame boundaries. With normalization enabled, all-zero weights produce NaN floating-point samples, preserved by `-c:a pcm_f32le`; `normalize=0` produces silence. Each input branch applies its single-input filters before mixing, for example `[0:a]volume=0.5[x];[x][1:a]amix[out]`. Filters after `amix` receive the mixed output with its frame lengths and timestamps, including partial final frames. `[0:a][1:a]acrossfade=ns=2000[mix]` crossfades decoded PCM inputs with triangular fades, converting the second input to the first input’s sample rate and channel layout before the fade. Mono, stereo, and six-channel 5.1 inputs can be combined; mono occupies the center speaker when expanded to 5.1, stereo occupies front left/right, and downmixing excludes LFE. Downstream audio filters retain transition frames and the remaining second-input frame boundaries. Both `c1`/`curve1` and `c2`/`curve2` accept all native curves: `nofade`, `tri`, `qsin`, `esin`, `hsin`, `log`, `ipar`, `qua`, `cub`, `squ`, `cbr`, `par`, `exp`, `iqsin`, `ihsin`, `dese`, `desi`, `losi`, `sinc`, `isinc`, `quat`, `quatr`, `qsin2`, and `hsin2`. Numeric IDs and expressions are also accepted, such as `c1=-1:c2=3+3` for `nofade`/`qua`. Both curves apply with overlap enabled or disabled; invalid curves preserve existing output. `ns` (alias `nb_samples`, or the first positional option) accepts numeric expressions and fractional values, rounded to the nearest integer with ties to even. Values must be within 1–214748364 before rounding. Mixed named and positional options follow FFmpeg’s assignment order: `acrossfade=4:overlap=1:1` overrides the sample count to 1; a final 0 is rejected. Use `d` or `duration` with decimal seconds or `s`, `ms`, and `us` suffixes, or `o=0` for sequential fades without overlap. Invalid durations, including scientific notation, fail without replacing an existing output. `o` and `overlap` accept case-insensitive Boolean words such as `yes`/`no` and `on`/`off`, as well as `1`/`0`. Following FFmpeg 7, if either input is shorter than the transition, output ends before the transition: only the first input’s samples preceding it are emitted, or no samples if the first input is too short. Each input branch applies its single-input filters before acrossfade, for example `[0:a]volume=0.5[aa];[1:a]anull[bb];[aa][bb]acrossfade=ns=4[mix]`. Labeled single-input audio chains in `-filter_complex` resolve input stream selectors and linked labels, then apply the filters selected by `-map "[label]"`. With audio-only inputs, omitting input labels binds unused audio streams in input order. `acrossfade` and `amerge` fill either or both unlabeled inputs while preserving explicit selections: `[1:a]acrossfade=ns=4[o]` uses the second file first and the unused first file second. Single-input filters follow the same ordering, for example `-filter_complex "channelsplit=channels=FR[o]" -map "[o]"`. An unlabeled complex audio output is routed to the first destination; later destinations use automatic stream selection. `highpass=f=200:p=2:m=1` removes low frequencies from PCM audio; `frequency`, `poles`, and `mix` are aliases. Defaults are 3000 Hz, two poles, and fully filtered output; one pole and dry/wet mixes from 0 to 1 are supported. Other highpass options are rejected. Unsupported audio filters fail without writing unfiltered output. Audio filters run in chain order; each
`atempo` stage processes the preceding stage’s samples, including `areverse`.
Use `-af atilt=freq=1000:slope=0.3` to boost higher frequencies, or a negative `slope` to reduce them. `atilt` supports `freq` (20–192000 Hz), `slope` (−1–1), `width` (100–10000 Hz), `order` (2–30), and `level` (0–4), in that positional order. Defaults are 10000, 0, 1000, 5, and 1; sample count and channel layout are preserved.
Input-side `-ss`, `-t`, and `-to` cut audio before filtering; output-side cuts apply to the filtered samples.
`compand=attacks=0:decays=0:points=-80/-80|-40/-40|-20/-30|0/-20` applies a dB transfer curve to PCM without changing its length. Per-channel attack/decay times, soft knees, output gain, initial volume, and lookahead delay (0–20 seconds) are supported. Delay is rounded down to whole samples; the final samples use the last detected gain. Invalid attack/decay configuration or transfer points fail with status 234 after opening the output, so an existing output is emptied when overwriting is enabled. Invalid numeric options fail before opening the output.

`mcompand` applies FFmpeg’s default five-band companding curve at 48 kHz. Custom quoted band specifications support attack/decay pairs, soft knees, transfer points, crossover frequencies, and initial volume. Crossovers must be below half the sample rate; nonzero delay and gain are rejected.
`anull` and `acopy` pass audio through unchanged, alone or in a filter chain.
`-noauto_conversion_filters` rejects implicit PCM output-format, sample-rate,
channel-count and `aformat` conversions; `-auto_conversion_filters` restores the
default. For example, PCM16 WAV with `-af anull -f s16le -` succeeds with either
flag, while `-af anull -f f32le -` requires automatic conversion. These are global
flags: the last spelling applies to every output. Stream copy is unaffected.
`afreqshift=shift=250:level=0.5` shifts each channel’s frequencies by a signed Hz offset without changing the sample count. It accepts `shift` (default 0), `level` (0–1, default 1), and `order` (1–16, default 8), including positional `shift:level:order` options. Numeric expressions accept `PI`, `E`, and `PHI`, for example `afreqshift=PI`. Zero shift retains the filter’s phase response. Invalid options preserve existing output and return Linux FFmpeg exit statuses: 222 for out-of-range values, 234 for malformed expressions, and 8 for unknown options.

`-filter_complex "showwavespic=s=600x240:split_channels=1:colors=white|white" -frames:v 1 waveform.png` renders audio as a single waveform image. Split channels occupy separate rows; the default overlay keeps each channel’s magnitude independent. Labeled audio inputs and mapped image outputs are supported, as are following video filters. Rendering supports linear scaling, scaled drawing, and average (default) or peak sample aggregation; other scaling/drawing modes and preceding audio filters are rejected.
`arealtime` preserves audio samples while pacing frame timestamps at the requested
`speed` (default 1). Its `limit` duration (default 2 seconds) resets pacing across
timestamp discontinuities. Waits honor cancellation and command resource limits.
`afwtdn=sigma=0.12:levels=4:samples=1024` denoises PCM with wavelets, independently per channel, in simple or labeled audio filter chains. It supports `sigma`, `levels`, `wavet` (`sym2`, `sym4`, `rbior68`, `deb10`, `sym10`, `coif5`, `bl3`), `percent`, `profile`, `adaptive`, `samples`, and `softness`, including positional options in that order. Window history, startup delay, and final padding follow native FFmpeg.

`deesser=i=0.8:m=0.5:f=0.5` reduces sibilance independently per channel. Intensity (`i`, default 0), maximum deessing (`m`, default 0.5), and frequency (`f`, default 0.5) accept values from 0 to 1. Output mode `s` selects input (`i`/`0`), processed audio (`o`/`1`, default), or removed sibilance (`e`/`2`). Positional options follow `i:m:f:s`.

`adeclick` removes impulsive noise from decoded PCM using autoregressive interpolation.
It accepts `window`/`w`, `overlap`/`o`, `arorder`/`a`, `threshold`/`t`,
`burst`/`b`, and `method`/`m` (`add` or `save`), with native defaults.
`adeclip` reconstructs clipped PCM peaks using the same interpolation. It accepts
`window`/`w`, `overlap`/`o`, `arorder`/`a`, `threshold`/`t`, `hsize`/`n`, and
`method`/`m` (`add` or `save`), with native defaults; channels are restored independently.
`[0:a][1:a]join=inputs=2:channel_layout=stereo:map=1.0-FL|0.0-FR[mix]`
routes the second input's first channel to left and the first input's first channel
to right, resampling inputs to the first input’s sample rate before routing channels
and stopping at the shortest resampled input. Join accepts the declared `inputs`
count (default 2) of decoded PCM inputs. Output layouts include
mono, stereo, `3.0`, quad, `5.1`, explicit speaker lists, and stereo mask `0x3`.
Input maps accept numeric indices or speaker names, such as
`map=0.FR-FL|1.FL-FR`. Names resolve against each input’s layout; missing speakers
are rejected. Maps are optional and may assign only one output channel. Unmapped
outputs first use unused inputs with matching speaker positions, then the first
unused input channels.
For example, `[0:a][1:a]join[mix]` selects both channels of a stereo second input
when the first input is mono. Each input branch applies its single-input filters
before routing channels, for example
`[1:a]volume=0.5[x];[0:a][x]join=map=0.0-FL|1.0-FR[o]`.
Filters after join are supported.
`agate=threshold=0.05:ratio=4:attack=0.1:release=1` attenuates quiet PCM sections
while preserving sample count and timing. It supports native defaults, range, knee,
attack/release, peak/RMS detection, channel linking, input/makeup gain, and downward/upward modes.
Timeline expressions such as `agate=enable='between(t,0.1,0.3)'` select audio frames;
disabled frames pass through unchanged and pause the gate envelope.
`asendcmd=c='0.256 agate@v makeup 2',agate@v` changes makeup gain at the first
audio frame at or after the requested time, preserving the gate envelope.
Target `agate` selects the first subsequent gate; a named target selects that
instance. Invalid runtime gains retain the previous setting.
Downstream filters receive packed double (`dbl`) audio, including when `ratio=1`.
Numeric options accept expressions (`ratio=1+2*3`), units (`threshold=-12dB`,
`release=2k`), mathematical constants (`level_in=PI`), and option constants
(`min`, `max`, `default`, `none`, `all`). Evaluated values must remain within each
option’s bounds; invalid values fail without replacing existing output.
The `mode`, `link`, and `detection` options accept numeric and named expressions,
such as `mode=1.0` and `link=average+1`. Values must be between 0 and 1 before
rounding to the nearest integer; the `0.5` tie selects 0.

`acompressor=threshold=0.1:ratio=4:attack=1:release=20` compresses changing PCM levels
with attack and release in milliseconds. It supports soft knees, peak/RMS detection,
average/maximum channel linking, upward/downward modes, input gain, makeup and wet/dry mix.
Both `acompressor` and `sidechaincompress` accept numeric expressions such as
`threshold=1/4` and `ratio=2*2`, including positional options. Invalid expressions
and out-of-range results fail without replacing existing output.

`axcorrelate` computes per-channel cross-correlation from two PCM inputs with compatible
channel layouts, resampling the second input to the first input’s sample rate and
stopping at the shorter input. For example,
`[0:a][1:a]axcorrelate=size=128:algo=slow[mix]`. Mono/stereo pairs are remixed
to the first input’s layout before correlation. `size` accepts numeric expressions
such as `2*4` in the range 2–131072 (default 256), rounded to the nearest sample
with halfway values rounded to even (`2.5` becomes `2`, `3.5` becomes `4`).
`algo` accepts `slow`, `fast` (assumes zero means), or `best`
(default), or numeric expressions in 0–2 rounded to the nearest integer (ties to even).
If the first input has at most `size` samples, no audio is emitted;
a short second input still produces audio when the first exceeds `size`. Windows
look forward and use silence past the packets received when either input ends. Filters can follow axcorrelate and receive its output frame boundaries and timestamps, including the tail;
preceding single-input filters apply to their respective input branches before correlation.

`sidechaingate` uses the second audio input to gate the first, stopping at the shorter
input. For example, `[0:a][1:a]sidechaingate=threshold=0.1:ratio=8:attack=1:release=20[mix]`
attenuates the program when the control signal becomes quiet. Supports `range`,
`knee`, `detection=peak|rms`, `link=average|maximum`, `mode=downward|upward`,
`level_in`, `level_sc`, and `makeup`; the control input can have a different channel count
or sample rate. The control input is resampled to the program rate, which is preserved
in the output; duration is limited by the shorter input after resampling.
Timeline `enable` expressions, such as `enable='gte(t,0.064)'`, are evaluated at input
audio frame boundaries (`t` is time in seconds; `n` is the frame index). Disabled
frames pass through unchanged while the gate continues tracking the control input.
Numeric options accept expressions such as `level_sc=1/2`, `attack=2+3`, and
`makeup=sqrt(4)`. Invalid or out-of-range values fail without replacing output.
Filters after the gate retain program frame lengths and timestamps, including a partial final frame. Upstream filters run independently on each input:
`[1:a]volume=0.5[key];[0:a][key]sidechaingate[out]` halves the control signal,
while `[0:a]volume=0.5[program];[program][1:a]sidechaingate[out]` halves the program.

`sidechaincompress` uses a second audio input to control compression of the first,
for example `[0:a][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=1:release=20[mix]`.
Output retains the first input’s channels and sample rate, resampling the detector
input when its rate differs, and ends with the shorter input. Filters on either input
are applied before compression; downstream filters apply to the compressed output.

`dynaudnorm=f=100:g=5:p=0.5` normalizes changing PCM levels with smoothed frame gains and coupled channels. Supports frame length (`f`/`framelen`), Gaussian window (`g`/`gausssize`), peak (`p`/`peak`), and maximum gain (`m`/`maxgain`); other options fail explicitly. Fractional frame lengths and window sizes round to the nearest integer with ties to even, then window sizes increase to an odd value. Limits are checked before rounding. Named and positional values accept numeric expressions, such as `dynaudnorm=f=10*2:g=3:p=1/2`; results must satisfy the option ranges.

`acontrast=contrast=50` applies a nonlinear audio contrast transfer while preserving sample rate, channels, and frame count. Contrast ranges from 0 to 100 (default 33); positional `acontrast=50` is also supported. Values accept numeric expressions such as `acontrast=100/2` and `acontrast=PI*10`; invalid expressions leave existing output untouched. Zero contrast still applies the native sine transfer. Invalid expressions exit with status 234, out-of-range contrast with 222, unsupported timeline options with 176, and unknown named options with 8; these failures preserve existing output files.

`tremolo=f=5:d=0.75` modulates PCM volume while preserving sample rate, channels, and frame count. Frequency (`f`, 0.1–20000 Hz) defaults to 5 Hz; depth (`d`, 0–1) defaults to 0.5. Positional `tremolo=5:0.75` is also supported. Mixed options follow native FFmpeg: `tremolo=1:d=1:500` equals `tremolo=f=500:d=1`, and `tremolo=1:enable=1:1000` equals `tremolo=f=1000:enable=1`. Timeline expressions such as `tremolo=enable='gte(t,0.5)'` evaluate at audio frame timestamps (`t` in seconds, `n` as the frame index); bypassed frames preserve the input and pause the oscillator. Infinite timeline results enable the filter, while NaN bypasses it; frequency and depth must remain finite. Scheduled commands such as `asendcmd=c='0.256 tremolo@one enable 0',tremolo@one` replace the enable expression at the first audio frame at or after the requested time. Target `tremolo` selects the first subsequent instance; a named target selects that instance. Invalid runtime expressions retain the previous setting.

`afade=t=in:ss=1000:ns=2000` fades PCM without changing its length. Fade out with `t=out`; use `st`/`d` for timing in seconds, `ms`, `us`, or escaped clock notation (for example, `-af 'afade=ns=4:st=00\\:00\\:00.001'`), or `ss`/`ns` for sample counts. Fractional sample counts round to the nearest integer, with exact halves going to even (`1.5` and `2.5` both select 2); `ns` must be at least 1 before rounding. Fade positions follow incoming audio timestamps, including shifts from `asetpts`. Timeline `enable` expressions use the incoming frame number (`n`), timestamp in seconds (`t`), source byte position (`pos`, NaN when unavailable), and frame width (`w`, zero for audio); disabled frames pass through unchanged. All FFmpeg fade curves are supported by name or numeric ID (`nofade`/`-1` through `hsin2`/`22`), with `tri` as the default and fractional `silence` and `unity` gains. Complete frames strictly outside the fade use those endpoint gains directly, even with `c=nofade` or `c=exp`; frames touching the fade still evaluate the curve. For example, `afade=ns=8000:c=qsin` uses a quarter-sine fade. `asendcmd=c='0.256 afade@intro unity 0.25',afade@intro=ns=4` changes unity gain at the first audio frame at or after 0.256 seconds, preserving earlier samples. Scheduled `enable` expressions can bypass or resume the fade on subsequent frames: `asendcmd=c='0.256 afade@intro enable 0',afade@intro=ns=2800` disables it at 0.256 seconds. Scheduled updates also accept `start_sample`/`ss`, `start_time`/`st`, `silence`, `curve`/`c`, `nb_samples`/`ns`, `duration`/`d`, and `type`/`t`; for example, `asendcmd=c='0.128 afade@intro curve qsin',afade@intro=ss=1600:ns=900` changes the fade curve. Target `afade` selects the first subsequent fade; a named target selects that instance. A scheduled `duration`/`d` accepts seconds, `ms`, or `us`; zero leaves the current duration unchanged. Invalid runtime values leave the current setting active. Long option names are also accepted. Sample counts and gains accept numeric expressions such as `ns=2+2`, `ns=PI`, and `unity=1/2`. Results must satisfy the option ranges; duration options retain their time syntax.

`aselect='not(mod(n,2))'` keeps even-numbered decoded audio frames; `aselect='eq(n,1)'` keeps only the second frame. Frame numbers start at zero. Expression registers `st(index,value)` and `ld(index)` start at zero and persist across frames within each `aselect` instance. Semicolon-separated expressions evaluate in order: `aselect='st(0,n);eq(ld(0),1)'` keeps the second frame; `aselect='gt(st(0,ld(0)+1),2)'` drops the first two frames. `samples_n` is the current frame’s sample count per channel, and `sample_rate` is the incoming audio rate. For example, `asetnsamples=n=3:p=0,aselect='eq(samples_n,1)'` keeps a one-sample final frame. `consumed_samples_n` is `NaN`, as in native FFmpeg; `isnan(consumed_samples_n)` selects every frame. Expressions accept the mathematical constants `PI`, `E`, and `PHI`; `aselect='eq(PI,PI)'` keeps every frame. `pos` is the input packet byte offset (`NaN` when unavailable); `aselect=eq(pos\,1024)` keeps frames from the packet at byte 1024. Expressions also accept `pts` (current timestamp in the selected time-base ticks), `t` (current timestamp in seconds), `TB` (seconds per tick), and `start_pts`/`start_t` (the first known incoming timestamp in ticks/seconds). These values follow incoming timestamp shifts: `asetpts=PTS+7,aselect='eq(pts,10)'` selects the frame at tick 10. Missing timestamps are `NaN`; use `isnan(pts)` to detect them. `prev_pts`/`prev_t` hold the preceding input frame timestamp, even when that frame was dropped. `selected_n` counts previously selected frames; `prev_selected_n`, `prev_selected_pts`, and `prev_selected_t` hold the last selected frame index and timestamp in ticks/seconds. All previous-frame values start as `NaN`. For example, `aselect='gt(t-prev_selected_t,0.0005)+isnan(prev_selected_t)'` keeps the first frame and then frames more than half a millisecond after the last selection. A zero expression result drops the frame; nonzero results, including `NaN` and positive or negative infinity, select it for the single output. Expressions such as `isnan(0/0)` and `isinf(1/0)` can test computed nonfinite values. On decoded PCM, `key` is `1`, while `pict_type`, `interlace_type`, and `concatdec_select` are `NaN`: `eq(key,1)` and `isnan(concatdec_select)` keep every frame; `eq(pict_type,I)` and `eq(interlace_type,PROGRESSIVE)` keep none. Selected frames retain both channels, partial final frames, and timestamps; WAV output concatenates their samples.

`setsar=2` and `setsar=3/2` set the sample aspect ratio without changing pixels, dimensions or frame timing. The `sar` (`ratio`, `r`) option accepts expressions using `w`, `h`, `a`, `sar`, `dar`, `hsub` and `vsub`; `max` bounds the ratio numerator and denominator (default 100). Both `-vf` and `-filter_complex` support this filter.
`setdar=4/3` sets a positive display aspect ratio without changing pixels or dimensions; a 4×2 frame receives sample aspect ratio 2:3. Expressions can use `w`, `h`, `a`, `sar`, and `dar`; `dar`, `ratio`, and `r` name the ratio option. `max` bounds the display-ratio numerator and denominator (default 100).

`aloop=loop=2:size=8:start=0` repeats the first eight samples per channel twice, then keeps the remaining samples in order. Positional options (`aloop=2:8:0`) are also accepted. Integer options accept FFmpeg expressions such as `loop=1+1` and `loop=PI`; fractional results round to the nearest integer, with exact halves rounding to even. `loop=0` or `size=0` leaves the audio unchanged. `loop` and `size` are capped at 2147483647; `start` accepts int64 values, including values above JavaScript’s safe integer range. These bounds apply even when no samples are repeated. Use `start=-1:time=375us` (or `aloop=2:8:-1:375us`) to select the loop start by duration. Collection starts at the first consumed chunk whose timestamp reaches that time; chunks contain up to `min(size, 1024)` samples, even after `asetnsamples`. With `start=-1`, omitted times or times beyond the input leave audio unchanged. `time` is ignored when `start=0`. Loops also accept a nonnegative sample offset in `start`, matching FFmpeg’s chunk buffering when collecting the region. Output duration limits follow the loop’s frame timestamps, including gaps or overlaps introduced by a nonzero start. A start at or past EOF leaves audio unchanged; a loop reaching EOF repeats the samples collected so far. `loop=-1` accepts the same sample or time starts and repeats until an output duration (`-t`/`-to`), audio frame limit, or downstream `atrim` bounds the output. The trim may follow `anull`, `acopy`, or `volume` filters, which preserve sample counts and timestamps. Audio frame limits count frames after downstream `asetnsamples`, `aselect`, and `atrim` filters, including combinations of those filters. Output duration bounds follow downstream `asetpts` and `asetrate` changes, including through `anull`, `acopy`, and `volume`. Unbounded repetition is rejected; output duration and memory limits apply before allocation.

`aresample=16000` (or `aresample=osr=16000`) resamples PCM at that point in the filter chain. Later filters use the new rate: `aresample=16000,adelay=1S` adds one 16 kHz sample, while reversing the filters resamples the delay too. Bare `aresample` negotiates the output rate; an unchanged rate preserves the samples. Use `osf` or `out_sample_fmt` to choose the output sample format, with or without a rate: `aresample=16000:osf=fltp` or `aresample=out_sample_fmt=dbl`. Both names accept the same integer and floating-point formats as `aformat=sample_fmts`, including planar formats. Output `-ar` still sets the final sample rate.

`aresample=first_pts=-1600` pads leading silence; positive `first_pts` discards leading samples. Timestamps use the input sample rate, with FFmpeg’s default 1 ms compensation threshold. It also accepts `aresample=clev=0` (or `aresample=center_mix_level=0`) to set the center-channel gain when downmixing. Output `-center_mix_level 0` sets the same gain; values from -32 to 32 are accepted, and all contributing speakers are renormalized. Use `-surround_mix_level 0` (or `aresample=slev=0` / `aresample=surround_mix_level=0`) to remove surround contributions when downmixing 5.1 or 7.1 to mono or stereo; it accepts the same gain range and renormalizes the remaining speakers. Use `-lfe_mix_level 1` (or `aresample=lfe_mix_level=1`) to include the subwoofer when downmixing 5.1 or 7.1 to mono or stereo; the default is zero, and the same gain range and normalization apply. Use `-rematrix_maxval 2` (or `aresample=rematrix_maxval=2`) to raise the maximum coefficient sum for speaker downmixing; values from 0 to 1000 are accepted, with zero selecting the default normalization limit of 1 for PCM16. Use `-rematrix_volume 0.5` (or `aresample=rematrix_volume=0.5`) to scale channel-mix coefficients after normalization and before PCM rounding. Values from -1000 to 1000 are accepted; zero retains the default gain, and negative values normalize the largest coefficient to the reciprocal of their magnitude. Use `-resampler swr` (or `0`) for the default resampler, or `-resampler soxr` (or `1`) for SoXR-compatible 20-bit HQ linear-phase FIR resampling. SoXR uses zero-padded boundaries and rounds the output duration, including very short clips; it ignores SWR-specific filter/window/phase options. Its direct FIR evaluation can differ from native SoXR’s multistage processing and PCM dithering. Use `-ar` to change the output sample rate and `-filter_type blackman_nuttall` to select the Blackman-Nuttall resampling window; `-filter_type kaiser` selects the default Kaiser window. Use `-kaiser_beta 2` to change its sidelobes; values from 2 to 16 are accepted, with a default of 9. Use `-resample_cutoff 0.5` to set the resampling cutoff ratio from 0 to 1; zero selects the default 0.97 for SWR. SoXR uses a default passband of approximately 0.9137 and clamps nonzero values to 0.8–0.995. The codec option `-cutoff` does not change PCM resampling. Use `-phase_shift 0` to interpolate between integer resampling phases; values from 0 to 24 set the phase resolution, with a default of 10. Use `-exact_rational 0` to retain the power-of-two phase count; the default `-exact_rational 1` uses the reduced input/output rate denominator when it fits within that count. Use `-linear_interp 0` to select the lower phase without blending; `-linear_interp 1` keeps the default interpolation between adjacent phases. Set `-filter_size 4` to shorten the resampling filter and change its impulse response; the default is 32, and nonnegative integer sizes are accepted. Very short clips follow FFmpeg’s resampler startup and flush limits, so rate conversion can produce fewer samples or empty output; an unchanged rate preserves all samples. `-swr_flags res` is accepted and preserves equal-rate PCM samples.

`apad` accepts timeline `enable` expressions such as `apad=pad_len=2:enable=1` or `apad=pad_len=2:enable='gte(t,0)'`. Input frames pass through unchanged; the final input frame’s enable state controls padding. Expressions use input time `t`, frame index `n`, and mathematical constants `PI`, `E`, and `PHI`; undefined variables are rejected before replacing existing output.

`apad` sample-count options (`pad_len` and `whole_len`) accept numeric expressions with `PI`, `E`, and `PHI` constants and round to the nearest integer, with exact halves rounded to even (`pad_len=2+2` appends four samples; `pad_len=2.5` appends two). `apad=pad_len=19` appends 19 silent samples per channel. Output `-frames:a` (or `-aframes`) also bounds padding without an explicit length or duration: existing input frames count toward the limit, and zero produces no audio. When followed by `asetnsamples`, padding supplies the requested number of regrouped output frames; for example, `apad=packet_size=2,asetnsamples=n=8:p=0 -frames:a 5` produces 40 samples per channel. `packet_size` (default 4096) accepts numeric expressions with `PI`, `E`, and `PHI` constants and the same rounding (`3/2` and `2.5` both produce two samples per padding frame), including with `-frames:a`; invalid literals such as `0b10` and `0o2` fail before output is opened; `apad=2:4` is equivalent to `apad=packet_size=2:pad_len=4`. Mixed named and positional options follow FFmpeg’s shorthand order: `apad=whole_len=5:packet_size=2:3` sets `packet_size` to 3 and keeps `whole_len=5`. `packet_size=0` is accepted when no padding is needed (zero explicit padding or an already-satisfied minimum); it is rejected when padding is required. `pad_len=-1` and `whole_len=-1` leave that sample-count option unset, and values below -1 are rejected; `whole_len=16100` pads only until the minimum sample count is reached. `pad_dur` and `whole_dur` accept durations in seconds and override their respective `pad_len` and `whole_len` options regardless of option order, including zero durations. A duration of `-1us` (or `-0.000001` seconds) leaves that duration unset, preserving its sample count or using the finite output bound; durations below `-1us` are rejected. Explicit padding takes precedence over a minimum length, so `whole_len=12:pad_dur=0.00025` appends two samples at 8 kHz. Bare `apad` pads to a finite bound supplied by a following `atrim` (for example, `apad,atrim=end_sample=8` or `apad,atrim=start_sample=2:duration=0.001`), or by output `-t` or `-to`, subject to resource limits. Output time bounds measure padding from the final input frame’s timestamp boundary, so compressed `asetpts` timestamps still receive enough silence to reach the output end time. The bound can cross `anull`, `acopy`, and `volume`; sample end bounds also cross `asetnsamples`, as do time and duration bounds when incoming timestamps are continuous with one tick per sample (for example, `apad,asetnsamples=n=3:p=0,atrim=duration=0.014`). Sample, timestamp, and duration trim bounds work in both `-af` and mapped audio filter graphs. Unbounded padding and combining `pad_len` with `whole_len` are rejected.
`showinfo` reports video frame timestamps, durations, dimensions, pixel format, Adler-32 plane checksums, means, and standard deviations on stderr at info log level or above, without changing pixels. Use `showinfo=checksum=0` to omit checksum statistics. It measures the frames at its position in the filter chain; RGB/RGBA images and retained native planar YUV pixels are supported.

`signalstats` measures per-frame Y/U/V levels, saturation, hue, temporal differences, and effective bit depths. Add `stat=brng` to count broadcast-range violations and `out=brng` to highlight them (yellow by default; `color`/`c` selects another color). Read measurements with `signalstats=stat=brng,metadata=print`. RGB inputs convert to limited-range BT.601 YUV444; retained 8-bit planar YUV inputs preserve their sampling. Temporal-outlier (`tout`) and vertical-repetition (`vrep`) modes are unsupported.

`aphasemeter=video=0` measures stereo phase correlation without changing PCM. Read each frame's value with `aphasemeter=video=0,ametadata=mode=print:key=lavfi.aphasemeter.phase:file=phase.txt`. Omit `file` to print at info log level on stderr, or use `file=-` for stdout. File output accepts `direct=0` and `direct=1`; both produce the same completed tag file in memory. Add per-frame tags with `ametadata=mode=add:key=audit:value=left,ametadata=mode=print:key=audit:file=tag.txt`; add and print look up keys case-insensitively; adding an existing key preserves its spelling and value. The add operation also accepts `ametadata=add:audit:left`, `ametadata=1:audit:left`, or `ametadata=mode=1:key=audit:value=left`; positional arguments precede named options. Use `ametadata=mode=modify:key=audit:value=right` to replace an existing tag without adding an absent key. Omit `key` in print mode to print all tags. Select frames with `ametadata=mode=select:key=audit:value=left`; omit `value` to keep every frame containing the key. Selected frames retain their timestamps, and no matches produces empty audio successfully. To filter a tag value, use `key=label:value=sam:function=starts_with` for a prefix or `key=label:value=ple:function=ends_with` for a suffix. Comparisons are case-sensitive; omitting `function` (or using `function=same_str`) requires an exact match. Remove a tag with `ametadata=mode=delete:key=audit`, or omit `key` to clear all frame tags without changing PCM. An optional `value` limits keyed deletion to matching values. Video generation and metadata modes other than `add`, `modify`, `delete`, `select` and `print` are unsupported.

`ashowinfo` reports audio frame timestamps, sample counts, the intermediate sample format, and Adler-32 checksums for the frame and each sample plane on stderr at info log level or above, without changing the samples.

`silencedetect=noise=-40dB:d=0.1` reports silence starts, ends, and durations on stderr without changing PCM. Noise thresholds accept numeric expressions such as `silencedetect=n=1/25:d=0.125`. Signed 16-bit PCM thresholds use native integer scaling, truncation, and signed 16-bit wrapping above full scale; floating-point filter output retains floating-point thresholds. Duration accepts seconds or `s`, `ms`, and `us` suffixes (for example, `d=125ms`). Add `:mono=1` to measure each channel separately; `mono` (or `m`) accepts case-insensitive `y`/`n`, `yes`/`no`, `true`/`false`, `on`/`off`, and `1`/`0`. Trailing silence closes at end of input.

`replaygain` measures track gain and sample peak at its position in the filter
chain and reports them at info log level, without changing PCM. It uses 50 ms
ReplayGain weighting windows and the loudest 5% of windows. Stereo audio at
ReplayGain's standard sample rates (8–192 kHz) is supported; other rates,
channel layouts, and filter options are rejected.

`volumedetect` reports interleaved sample count, mean and maximum volume in dB,
and the native peak-level histogram on stderr, measuring audio after preceding
filters. It converts audio to signed 16-bit PCM with nearest-even rounding and
clipping; subsequent filters and output receive those converted samples.
The histogram includes empty bins between
the peak and the bin reaching the loudest 0.1% of samples; inputs shorter than
1000 samples have no histogram.
`astats` (also `astats=metadata=0:reset=0`) reports per-channel and overall PCM
statistics on stderr without changing samples: DC offset, signed extrema, sample
differences, peak/RMS levels, flat factor, peak counts, noise floor, entropy and
bit depth. Channel reports also include crest factor, dynamic range and zero
crossings; the overall report includes the sample count.
`astats=length=0.02` sets the RMS peak/trough and noise-floor window to 20 ms
(default 0.05 seconds, range 0–10); full-input RMS and PCM samples are unchanged.
`measure_perchannel` and `measure_overall` independently select `none` or a `+`-joined
list of `DC_offset`, `Min_level`, `Max_level`, `Peak_level`, `RMS_level`, and
`Number_of_samples`. For example, `astats=measure_perchannel=RMS_level:measure_overall=none`
reports only channel RMS levels. `astats=reset=N` resets measurements every N audio
frames and reports the final interval; `reset=0` measures the whole input.
`metadata=1` attaches cumulative channel and overall measurements to each audio
frame; read them with `astats=metadata=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level`.
Metadata respects `reset` and measurement masks, preserves existing frame tags,
and is disabled by default.
`crystalizer=i=2` sharpens changes between successive samples independently per channel.
Intensity defaults to 2 (range -10 to 10); negative values smooth the audio.
Clipping is enabled by default; `c=0` preserves peaks for subsequent filters.
`extrastereo=m=0` averages left and right while retaining stereo; `m=-1` swaps them.
The width multiplier defaults to 2.5 (range -10 to 10); `c=0` disables clipping.
`asendcmd=c='0.064 extrastereo@mix m -1',extrastereo@mix=m=1` swaps channels starting at the first audio frame at or after 0.064 seconds. Commands target the named instance, or the first subsequent `extrastereo` instance when unnamed; invalid width changes retain the current setting.
Width expressions accept `E`, `PI`, and `PHI`, for example `extrastereo=m=PI/2`.
`surround` upmixes stereo to 5.1 (FL, FR, FC, LFE, BL, BR) using a
windowed frequency transform, retaining the sample rate and frame count.
`surround=chl_out=5.1:win_size=1024:lfe=0` silences only LFE. The default
window is 4096 samples; powers of two from 1024 to 65536 are supported.
Other layouts and surround options are rejected.

`stereotools` supports stereo channel mute (`mutel`, `muter`), phase inversion
(`phasel`, `phaser`), stereo pair rotation (`phase=0`–`360` degrees), and all `mode`
channel conversions, including `lr>ms` and
`ms>lr`. For example, `-af stereotools=mutel=1` silences only the left channel.
Positional arguments follow FFmpeg option order: `stereotools=1:1:0:0:0:0:1`
is equivalent to `stereotools=muter=1`. Named arguments may follow positional ones.
`stereotools=phase=90` maps `(L, R)` to `(-R, L)`. Rotation follows mute,
polarity, delay, and width, and precedes output balance and gain.
Input and output gains (`level_in`, `level_out`) default to 1, range from 0.015625
to 64, and apply before and after channel processing. For example,
`stereotools=level_in=2:level_out=0.5` preserves the original levels without
clipping the intermediate signal. `softclip=1` enables arctangent soft clipping
after input gain/balance and before channel conversion. `sclevel` controls its
shape (default 1, range 1–100) and has no effect when soft clipping is disabled.
For example, `stereotools=softclip=1:sclevel=2` soft-clips both channels.
Signed `delay` accepts -20 to 20 (default 0):
positive values delay the right channel, negative values delay the left, with
silence at the start and no change in output length. Native FFmpeg's rounding
applies: `delay=1` shifts four stereo frames at 8 kHz.
Use `mlev` and `slev` to adjust the mid and side levels (0.015625–64, default 1),
`mpan` to pan the mid signal, and `sbal` to balance the side signal
(-1–1, default 0). For example, `stereotools=slev=0.5` narrows the stereo image.
Channel balance (`balance_in`, `balance_out`) ranges from -1 to 1 (default 0)
and applies before or after channel conversion respectively. Positive values
favor the right channel. `bmode_in` and `bmode_out` accept `balance` (default),
`amplitude`, or `power`, also numbered 0–2. For example,
`stereotools=balance_in=1:mode=lr>rl` silences the input left channel before swapping.
Stereo width `base` ranges from -1 to 1 (default 0): `base=-1` averages both
channels, negative values narrow the image, and positive values widen it.
Width applies after mute, phase inversion and delay, before output balance/gain.
Both filters support timeline expressions such as `enable=n` (bypass the first
audio frame) and `enable=0` (bypass all frames). `n` counts audio frames and `t`
is the frame timestamp in seconds. Other stereotools options are rejected.
Both filters accept case-insensitive Boolean
words (`true`/`false`, `yes`/`no`, `on`/`off`, `y`/`n`, `enable`/`disable`,
`enabled`/`disabled`) and decimal 0/1 values, such as `phasel=True` or `c=OFF`.
Both `extrastereo` and `stereotools` convert mono input to stereo before processing,
with each channel receiving the mono samples at √½ gain. They also downmix explicitly
labeled 5.1 and 5.1(side) input: front channels retain their gain, center and
surround channels contribute at √½ gain, and LFE is omitted.
`crossfeed=strength=0.5` applies frequency-dependent headphone crossfeed to stereo audio.
Downstream `ashowinfo` reports packed double (`dbl`) frames before output encoding.
Mono input is converted to stereo at √½ gain per channel before crossfeed is applied.
Strength and range default to 0.2 and 0.5 (0–1); slope defaults to 0.5 (0.01–1).
`level_in` and `level_out` default to 0.9 and 1 (0–1).
`asendcmd=c='0.064 crossfeed@x level_out 0',crossfeed@x` changes output gain
at the next audio frame without resetting filter history. Commands target the
first matching instance; unmatched targets and invalid gains leave it unchanged.
`crossfeed=strength=0:level_in=1:level_out=1` preserves every stereo input sample.
Timeline expressions such as `crossfeed=enable='gte(t,0.064)'` evaluate at audio
frame boundaries using frame time `t` or frame number `n`. Bypassed frames retain
the input samples while the filter history continues updating.
`block_size=256` enables forward/reverse block processing (0–32768 samples,
default 0 for the causal filter). It also accepts a sixth positional value.
Partial final blocks are zero-padded for filtering and drained without adding output samples.
`stereowiden=delay=5:feedback=0.3:crossfeed=0.3:drymix=0.8` widens stereo
with delayed cross-channel subtraction. Mono input is automatically converted to stereo
at √½ gain per channel; labeled 5.1 input uses the same downmix as `stereotools`.
For raw PCM with only `-ac 3`, `-ac 4`, or `-ac 6`, these stereo filters use
FFmpeg's default 2.1, 4.0, or 5.1 layout before downmixing.
Delay is in milliseconds (1–100, default 20),
rounded to the nearest sample with exact halves rounding to even;
feedback (0–0.9), crossfeed (0–0.8), and drymix (0–1) default to 0.3, 0.3, and 0.8.
Numeric options accept `min`, `max`, and `default` for their own limits and defaults,
plus `PI`, `E`, and `PHI`, including in runtime gain commands. Numeric `min(...)`
and `max(...)` calls are invalid; setup returns status 234 without replacing output.
Setting `feedback=0:crossfeed=0:drymix=1` preserves the input samples.
`asendcmd=c='0.064 stereowiden@x feedback 0',stereowiden@x=feedback=0.5`
changes feedback at the next audio frame without resetting delay history.
Runtime `crossfeed` and `drymix` commands update their gains in the same way. Commands
select the named instance or the first subsequent `stereowiden` instance; invalid
gain values retain the current setting. Unsupported runtime commands, including
`delay` changes, are ignored and rendering continues with the current settings.
Schedule bypass changes with
`asendcmd=c='0.003 stereowiden@w enable 0',stereowiden@w=delay=1`;
`enable` commands replace the timeline expression at the next audio frame, and
invalid expressions leave the previous expression unchanged.
`enable` selects frames by time (`t`) or frame number (`n`); bypassed frames still
feed the delay history, so re-enabling retains their delayed contributions.
Downstream `ashowinfo` reports packed float (`flt`) frames before output encoding.
`haas` applies the default stereo enhancer: the channel average plus a 2.05 ms
delayed tap on the right and minus a 2.12 ms delayed tap on the left. It preserves
the sample rate and frame count. Mono input is first mixed to stereo with
1/√2 gain per channel. Named and positional options follow FFmpeg order:
`level_in`, `level_out`, `side_gain`, `middle_source`, `middle_phase`,
`left_delay`, `left_balance`, `left_gain`, `left_phase`,
`right_delay`, `right_balance`, `right_gain`, `right_phase`.
A final colon is accepted, so `haas=right_delay=10:` matches `haas=right_delay=10`.
Numeric options accept expressions with `min`, `max`, and `default` for the current
option, such as `haas=level_in=max:left_balance=max:side_gain=default`.
Mathematical constants `PI`, `E`, and `PHI` are also supported, such as `haas=level_in=PI/2`.
For example, `haas=left_delay=1:right_delay=2` sets the tap delays in milliseconds
(range 0–40, truncated to whole samples). `middle_source=left|right|mid|side`
selects the source for both the direct signal and taps; `middle_phase=1` inverts
only the direct signal. Gains range from 0.015625 to 64; tap balances range from
-1 to 1, and each tap has its own phase switch. All three phase switches accept
`1`/`0` and case-insensitive `true`/`false`, `yes`/`no`, `on`/`off`, `y`/`n`,
`enable`/`disable`, and `enabled`/`disabled`, in named or positional form.
`[0:a][1:a][2:a]headphone=map=FL|FR:type=time[h]` renders a stereo source
through separate stereo impulse responses for its left and right channels.
Both `type=time` and `type=freq` use bounded direct convolution, preserve the source
frame count and sample rate, and apply native gain (−6 dB for stereo plus `gain`).
Use `map=FR|FL` to reverse the response assignments. All three inputs must be stereo
PCM at the same sample rate; multichannel HRIR files and preceding filters are unsupported.
`earwax` applies the headphone stereo filter to mono or stereo input, resampling
other input rates to 44100 Hz and converting mono to stereo with native gain.
An empty option list (`earwax=` or `earwax@stage=`) applies the same filter.
It preserves the resampled frame count, including the drained tail, with native
signed 16-bit filtering and clipping. Other channel counts are rejected. Downstream
`ashowinfo` reports planar PCM16 (`s16p`) frames with separate channel checksums.
Invalid `earwax` options preserve the destination and return Linux FFmpeg exit
statuses: `176` for unsupported timeline options (`enable`), `8` for unknown named
options, and `234` for unexpected positional arguments.

Swap stereo PCM channels with `-af 'channelmap=FR|FL'` or
`-af 'channelmap=map=1|0:channel_layout=stereo'`.
Channel maps accept input speaker names or numeric indices and allow repeated sources.
A single trailing `|` is accepted without adding a channel; leading, interior, or
repeated empty entries are rejected.
With only `channel_layout=stereo`, `channelmap` preserves the input channels;
with only `channel_layout=mono`, it selects the first input channel without downmixing.
Output layouts accept `mono`, `stereo`, `quad`, `5.1`, the count aliases `1c`,
`2c`, `6c`, speaker lists such as `FL+FR`, and decimal or hexadecimal speaker masks
such as `0x3` or `0X3`; binary prefixes are rejected. Explicit layouts must match the map length and preserve the output
speaker metadata, including `1:FR` and `0|1|1|0:quad`. Speaker lists preserve
their explicit order when resolving named destinations and subsequent channel maps;
`channelmap=0|1:FR+FL,channelmap=FL` selects the second input channel.
Count-only layouts such as `2C` and `2 channels` keep channels unnamed:
`channelmap=FR|FL:2C` swaps stereo samples, but a subsequent `channelmap=FL`
fails because the output has no speaker assignments. Lowercase `2c` assigns stereo speakers.
Numbered user channels retain their identities and order across filters;
for example, `0|1:USR17+USR18,channelmap=USR18` selects the second input channel.
Omitted layouts use native defaults for one through eight channels, including
2.1 for three channels and 4.0 (not quad) for four channels. Nine- and ten-channel maps
without a layout preserve the mapped sample order with unnamed output channels. Explicit input-output pairs such
as `0-1|1-0` or `FL-FR|FR-FL` route channels by destination, regardless of pair
order. Named destinations retain their speaker layout, including `1-FR` and
`0-FC|1-LFE`. Unavailable inputs, duplicate destinations, and mixed numeric/named
endpoint syntax are rejected before writing output.
`aeval=val(1)|val(0)` evaluates separate expressions against the input samples to swap
stereo channels. `val(channel)` truncates fractional indices toward zero, returns
silence for negative indices, and caps high indices at the last input channel. Explicit output layouts include `c=quad`, `c=5.1`, speaker lists
such as `c=FL+FR`, masks such as `c=0x3`, and channel aliases such as `c=2c`.
With no layout option, each expression produces one output channel (up to 64),
so `aeval=val(0)|val(1)|0` adds a silent third channel.
Expressions support arithmetic, `exp(x)` (for example, `aeval=exp(n/4)/4`), `val(channel)`, `ch`,
`n`, `t`, `s`, `nb_in_channels`, and `nb_out_channels`; `c=same` retains the input
layout and repeats the last expression when needed. `aeval=abs(val(1))` rectifies negative
right-channel samples; `abs(x)` also accepts constants and arithmetic expressions. `sin(x)` takes radians, and
`PI` is available for waveforms such as `aeval=sin(PI*n/2)/2`.
`atan2(y,x)` returns the angle in radians, including zero for `atan2(0,0)`;
for example, `aeval=atan2(n\,1)/2`.
`log(x)` evaluates the natural logarithm; for example, `aeval=log(n+1)/4`.
`hypot(x,y)` computes the hypotenuse; `aeval=hypot(n\,1)/8` generates it from the sample index.
`isinf(x)` returns 1 for positive or negative infinity and 0 for finite values or NaN;
for example, `aeval=isinf(1/0)` produces full-scale samples.
`squish(x)` returns `1/(1+exp(4*x))`; `aeval=squish(n/4)` generates a decreasing sigmoid from 0.5.
`gauss(x)` evaluates the standard Gaussian curve, `exp(-x*x/2)/sqrt(2*PI)`;
`aeval=gauss(n/4)` generates it from the sample index.
`taylor(expr,x[,idx])` evaluates a Taylor series with `ld(idx)` supplying the coefficient order (default register 0), restoring that register afterward. For example, `aeval=taylor(ld(0)\,1)/4` produces a constant value of approximately 0.68.
`bitand(x,y)` and `bitor(x,y)` truncate fractional operands toward zero and retain
bits above 32 bits, for example `aeval=bitand(n\,1)/2` alternates silence and half amplitude.
`aeval=val(0)*random(0)` applies a deterministic random gain to each sample, matching
FFmpeg 7. `randomi(index,min,max)` uses the same generator to produce floating-point
values between the supplied bounds; `aeval=randomi(0\,1\,2)/4` produces values between 0.25 and 0.5.
Random state persists across samples, stays independent for each output
channel and register index (0–9), and starts fresh for each filter execution.
Use `st(index,seed)` to seed or reset a generator; `ld(index)` reads its last unsigned 64-bit value as a floating-point number.
`aeval=sqrt(val(ch)):c=same` takes each channel sample’s square root. Negative
roots remain NaN during evaluation and encode as zero in PCM16 output.
`sgn(x)` returns -1, 0, or 1 for negative, zero, or positive values;
`aeval=sgn(val(ch))/10:c=same` extracts each channel’s sign at one-tenth amplitude.
`gcd(a,b)` returns the greatest common divisor of two nonnegative integers;
`aeval=gcd(n\,6)/8` produces a repeating sequence based on the sample index.
`enable=0` bypasses the filter; `enable=1` applies it. Timeline expressions use
frame index `n` and timestamp `t`. Empty fields between `|` separators
are skipped, including leading and trailing fields; at least one expression is required.
Malformed `aeval` expressions exit with status 234, matching FFmpeg 7, without creating
or replacing output files.
Conditionals `if(condition,then[,else])` and `ifnot(condition,then[,else])` evaluate
only the selected branch and default an omitted else to zero. For example,
`aeval=if(n\,1/n\,0)` avoids division by zero at the first sample. Both branches
must still contain valid expressions. `st(index,value)` and `ld(index)`
store and read ten initially zero registers per output channel expression. Registers
persist across samples and remain separate even when the last expression is repeated.
Duplicate an audio input into independently filtered outputs with
`-filter_complex '[1:a]asplit=2[x][t];[t]volume=0.5[y]' -map '[x]' one.wav -map '[y]' two.wav`.
`asplit` defaults to two outputs; `asplit=outputs=3` selects three.
Consume an unused audio branch with `anullsink`, which has no output:
`-filter_complex '[0:a]channelsplit[L][R];[L]anullsink;[R]anull[out]' -map '[out]' right.wav`.
The retained channel keeps its speaker layout; dropping the sink leaves an invalid
unconnected output.
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
input layout. Unmasked PCM WAV uses FFmpeg’s default speaker order: mono, stereo,
2.1, 4.0, 5.0, 5.1, 6.1 or 7.1 for one through eight channels. Four channels use
`FL+FR+FC+BC`; six use `FL+FR+FC+LFE+BL+BR`. Explicit channel masks take precedence.
`-af 'pan=mono|c0=c1'` extracts the right channel and
`-af 'pan=stereo|FL=FR|FR=FL'` swaps stereo channels. PCM16 mixing uses native Q15
gains and rounds half steps toward positive infinity, including native 32-bit overflow
for large gains. PCM32 mixing saturates at the integer limits before downstream filters
reduce the gain; floating-point filter paths retain floating-point mixing. Float64 input retains double precision through weighted sums and gain normalization. Weighted sums use `=`,
and `<` divides gains by the sum of their magnitudes, preserving polarity, for example `pan=mono|c0<2*c0+-1*c1`.
Terms accept hexadecimal gains (`0x1`, `0x1p-1`), subtraction (`c0-c1`), compact gains (`.5c1`), and signed exponents
(`1e+0*c1` or `5e-1c1`). Nonfinite gains such as `nan`, `inf`, and `1e999` are accepted;
`pan=mono|c0=nan*c0` produces silence on PCM16 input/output. Floating-point paths retain nonfinite samples. Zero-gain inputs do not affect other channels, so selecting or swapping channels preserves finite samples even when an unused input contains NaN.
Count-only outputs also accept `2C` and `2 channels`, for example
`pan=2C|c0=c1|c1=c0`; use numbered output channels because these layouts have no speaker assignments.
Stereo layouts also accept `0x3` and `FL+FR`. `pan=5.1|FC=c1|LFE=c0` routes
stereo into center and LFE; unassigned speakers stay silent. Empty equation fields
between or after assignments are ignored, so `pan=stereo|c0=c0||c1=c1` preserves
both channels and `pan=stereo|c0=c0|` leaves the right channel silent. Output preserves
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
`aformat=channel_layouts=mono` also converts a single FL or FR speaker to mono
without changing its samples, including after `channelsplit`.
`aformat=channel_layouts=mono` (or `aformat=cl=mono`) downmixes stereo by
averaging left and right samples, or preserves mono input. `stereo` preserves
stereo input or converts mono with equal-power gains. It also downmixes 2.1,
4.0 and 5.1 input to stereo, including raw PCM with `-ac 3`, `-ac 4` or `-ac 6`.
Center and surround speakers contribute to the mix; LFE is omitted.
Lists such as `mono|stereo` and `stereo|mono` preserve either input layout
regardless of list order.
Every entry must be `mono` or `stereo`; invalid lists fail without replacing output.
`aformat=sample_fmts` (alias `f`) accepts `u8`, `u8p`, `s16`, `s16p`, `s32`,
`s32p`, `s64`, `s64p`, `flt`, `fltp`, `dbl`, and `dblp`. Samples pass through the selected intermediate
precision, even when the output codec has higher precision. Planar formats preserve
the same samples as their packed equivalents.
Pipe-separated lists preserve an allowed input format regardless of list order:
`f=u8|s16` and `f=flt|s16` preserve PCM16 input. Every entry must be supported;
invalid lists fail without replacing output.
`aformat=sample_rates=16000` (alias `r`) resamples at that point in the chain,
so later filters use the selected rate. Pipe-separated lists preserve an allowed
input rate or select the nearest allowed rate; `r=16000|8000` preserves 8 kHz,
while `r=16000|11025` converts it to 11025 Hz.
Positional arguments follow `sample_fmts:sample_rates:channel_layouts` order:
`aformat=s16:8000:mono` is equivalent to `aformat=f=s16:r=8000:cl=mono`.
Omitted trailing arguments leave those constraints unset; empty fields between
colons are invalid. Bare `aformat` preserves the input.
Other `aformat` sample formats, options and layouts are not supported.
These filters also work in labeled single-input audio graphs with `-map`.
`volume` and `atempo` default to 1 and accept named primary arguments, such as
`volume=volume=0.5` and `atempo=tempo=2`, as well as positional values.
`volume=` also uses gain 1; a final colon, as in `volume=0.5:` or `volume=0.5:eval=frame:`, leaves the options unchanged.
Volume expressions support `sin(x)`, `cos(x)` (angles in radians), and `tanh(x)`, such as `volume=sin(t):eval=frame`. These functions also work in `aeval`, such as `aeval=tanh(val(ch)):c=same`.

Volume expressions support `lerp(start,end,weight)` for linear interpolation without clamping the weight, such as `volume='lerp(0.25,0.75,t)':eval=frame`.
Volume expressions support the `PI` constant in arithmetic, such as `volume=PI/4`.
Volume expressions support `^` and `pow(base,exponent)`, including negative exponents. Powers group left to right before a leading sign: `2^3^2` is 64 and `-2^2` is -4.
Filter expressions support `floor`, `ceil`, `trunc`, and `round` (halfway values round away from zero), including stepped volume ramps such as `volume='floor(t*10)/10':eval=frame` and per-sample `aeval='floor(val(ch)*10)/10':c=same`.
Volume expressions accept SI prefixes (`volume=1k`, `volume=500m`), binary prefixes (`volume=1Ki`), and the byte multiplier `B` (`volume=1KiB`).
`atempo` accepts arithmetic such as `atempo=1/2`; the result must be between 0.5 and 100. An empty `atempo=` defaults to 1. Repeated `tempo` assignments use the last value, such as `atempo=1:tempo=2`; spaces around names and values are accepted. Each assignment must be valid, so `atempo=tempo=` fails. Invalid values return native FFmpeg exit statuses: 222 for out-of-range tempo, 234 for invalid expressions, and 176 for unsupported timeline `enable`. These failures preserve existing output files.
`areverse` accepts generic `threads`, `thread_type`, and `extra_hw_frames` options (for example, `areverse=threads=2:thread_type=slice`) without changing reversed PCM, in simple and named complex filter graphs. Rejected options preserve the destination and return Linux FFmpeg exit statuses: `8` for unknown options, `234` for unexpected positional arguments, `176` for unsupported timeline options, and `222` for out-of-range thread counts.

Audio filters accept instance labels, such as `areverse@flip`, `volume@quiet=0.5`,
and `atempo@fast=2`, with the same behavior as their unlabeled forms.
`volume=if(lt(t\,0.5)\,0\,1):eval=frame` changes gain at audio frame timestamps;
`eval=once` (the default) evaluates a constant gain. Numeric modes are `precision=0/1/2` for fixed/float/double and `eval=0/1` for once/frame. Expressions accept escaped commas or single quotes.
`st(index,value)` stores a value in one of ten expression-local registers; `ld(index)` reads it (initially zero). Registers persist from setup through frame evaluations and reset when a command replaces the expression. For example, `volume='st(0,ld(0)+0.1)':eval=frame` starts at gain 0.2 and increases by 0.1 each frame.
`volume` in an expression holds the previous gain, starting as NaN during setup; `eval=frame` evaluates again for each audio frame.
Volume timeline `enable` expressions expose audio width `w` and height `h` as zero: `volume=0.5:enable=eq(w\,0)` applies half gain, while `enable=isnan(w)` bypasses it.
`asendcmd=c='0.128 atempo@x tempo 1.5',atempo@x=1` changes tempo when the input reaches the scheduled frame, preserving audio already emitted and the overlap buffer. Target `atempo` selects the first subsequent tempo filter; a named target selects that instance. Missing targets and invalid runtime tempo values leave the audio settings unchanged.

`asendcmd=c='0.25 volume@v volume 0.25',volume@v=1` changes the named gain on the first audio frame at or after 0.25 seconds. Inline `c`/`commands` schedules support semicolon-separated time/target/volume/gain commands (optionally `[enter]`) targeting subsequent volume filters; target `volume` addresses all subsequent volume instances. `asendcmd=c='0.064 compensationdelay@x dry 0.5',compensationdelay@x=m=1` updates the named delay filter's dry gain at the next audio frame while preserving wet history; target `compensationdelay` addresses all subsequent instances. `asendcmd=c='0.064 alimiter@cap limit 0.25',alimiter@cap=limit=1:level=0` changes the limiter threshold at the next audio frame while preserving its lookahead buffer and release envelope. Target `alimiter` selects the first subsequent limiter; invalid runtime limits leave the previous limit active. Other command actions, interval flags, and command files are unsupported.
The volume counters `nb_samples` and `nb_consumed_samples` are unavailable (NaN), as in native FFmpeg.
`volume` supports ReplayGain `drop` (default), `ignore`, `track`, and `album` modes,
with `replaygain_preamp` (-60–60 dB) and `replaygain_noclip` (enabled by default; accepts `0`/`1` and case-insensitive `false`/`true`, `no`/`yes`, `off`/`on`).
Tagged gain replaces the volume multiplier; untagged audio keeps the requested volume.
`precision`, `eval`, `replaygain`, and `replaygain_preamp` accept arithmetic expressions, such as `volume=0.5:precision=1+1:eval=1+0:replaygain=track+0:replaygain_preamp=1/2`. Numeric modes round to the nearest integer with ties to even; out-of-range or invalid expressions fail before replacing output.
With `eval=frame`, `startt` and `startpts` retain the first audio frame's timestamp in seconds and sample time-base units; both are NaN with `eval=once`.
With `eval=frame`, a NaN gain becomes silence; `isnan()` can supply a fallback gain.
`atempo` aligns and blends audio windows, including at tempo 1. The aligned terminal fragment determines clip length, which can differ from input length divided by tempo. Output timestamps start at the first input timestamp and advance by emitted samples, closing gaps introduced by earlier filters.
`atempo` resizes output frames for downstream filters: a 512-sample input frame becomes 256 samples at `atempo=2` or 1024 at `atempo=0.5`.
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
Stream maps such as `-map_metadata:s:a:0 0:s:a:1` copy the second input audio stream’s tags to the first output audio stream without moving audio. Omit the destination index (`-map_metadata:s:a`) to target all audio streams; use `-map_metadata:s:a -1` to clear inherited stream tags. Any explicit stream metadata map disables automatic tag inheritance for all output streams. Global tags remain unchanged, and `-metadata:s` assignments override mapped tags.
Repeated global maps fill missing tags in argument order, keeping the first mapped value for duplicate keys.
Explicit `-metadata key=value` tags override copied metadata. M4A/MP4 stream copies preserve composer tags; `-metadata composer=Writer` replaces the composer and `-metadata composer=` removes it. M4A/MP4 copies preserve the compilation flag; `-metadata compilation=0` writes an explicit false flag, `compilation=1` sets it, and `compilation=` removes it.
Each output filename closes its option group: `-t 0.025 a.wav -t 0.075 b.wav`
writes both files with independent durations. Output options reset after each filename;
trailing options without a filename do not change earlier outputs.
With finite input loops, input `-t` limits the total looped timeline, including partial final passes.
Finite `-stream_loop N` repeats the full input N times after its first pass.
An input `-ss` seek applies only to the first pass; repeats restart at the beginning.
`-stream_loop -1` repeats an input up to a finite output `-t` or `-to`, subject to
media resource limits. Without either output bound, infinite looping fails explicitly.
`-metadata:s:m:language:fra language=deu` changes only output tracks whose language is French;
add a type (`-metadata:s:a:m:language:fra`) to restrict matching to audio.
`-metadata:s:a:0 language=fra` sets the first output audio track’s language;
`-metadata:s:a:1 handler_name=Bob` sets the second output audio track’s MP4 handler name.
Stream selectors also accept an absolute index (`s:1`), a type (`s:a`), or all streams (`s`).
`-disposition:a:0 0 -disposition:a:1 default` selects the second output audio track as the MP4 or Matroska default.
Matroska copy marks the first mapped audio track default when multiple audio tracks are unmarked.
A single unmarked audio track stays unmarked; any disposition option matching an output stream
disables automatic defaults, so `-disposition:a 0 -disposition:s 0` keeps all those tracks unmarked.
Disposition selectors accept a type, an absolute index, all streams, or an output language
(`-disposition:m:language:fra default` or `-disposition:a:m:language:fra default`); supported values are
`0`, `1`, `default`, `comment`, and `attached_pic`, with `+`/`-` flag updates and combinations such as
`default+comment`. Matroska also writes `forced`, `hearing_impaired`, and `visual_impaired`;
for example, `-disposition:a:1 visual_impaired` replaces the second audio track’s flags, while
`-disposition:a:1 +forced-hearing_impaired` adds `forced` and removes `hearing_impaired`, preserving other flags and encoded packets.
MP4 output writes `comment` as a commentary track role. Other disposition values fail explicitly. Matroska output honors explicit flag clearing (`0`) and replacement (`default`), while leaving unmatched tracks and copied packet payloads unchanged.
For FLAC cover art, map the audio and PNG/JPEG inputs with `-map 0:a -map 1:v -c copy -disposition:v:0 attached_pic`; unmarked video streams are omitted. When copying embedded covers with `-map 0 -c copy`, use `-metadata:s:v:1 title="Updated back"` to edit the second picture description, or `-metadata:s:v:0 comment="Leaflet page"` to change the first picture type. An empty title clears its description; image payloads and audio stay unchanged.
Chapters default to the first input with chapters, independently of stream selection. `-map_chapters -1` removes output chapters; `-map_chapters N` copies chapters from input N. MP4/M4A `-movflags +disable_chpl` omits the Nero chapter box while retaining the referenced QuickTime chapter track; `-movflags -disable_chpl` restores the Nero box. FFmetadata export preserves imported chapter time bases, including sample-accurate boundaries. Concat manifests accept `chapter id start end` directives and export them with a microsecond time base; chapters do not trim the concatenated media.
`[0:v][1:v]freezeframes=first=2:last=4:replace=1[v] -map '[v]'` replaces source frames 2 through 4 (inclusive) with donor frame 1, keeping source timestamps and duration. Frame numbers start at zero; positional options are `first:last:replace`, and all three default to zero. The videos must have matching dimensions.
`xfade` supports the default `fade` and `transition=wipeleft`; other transitions fail
without creating or replacing output.
`trim` supports `start` (`starti`), `end` (`endi`), `duration` (`durationi`), `start_frame`, `end_frame`, `start_pts`, and `end_pts`; frame
numbers are zero-based. `start_frame=-1` leaves the frame start unset, preserving any time or PTS start bound; lower values are invalid. Positional options follow `start:end:start_pts:end_pts:duration:start_frame:end_frame`;
for example, `trim=0.5:1` keeps frames from 0.5 seconds up to 1 second. Positional integer bounds round to the nearest integer, with ties to even.
PTS bounds use the input time base, and end bounds are exclusive. Unsupported trim options fail
without replacing output.
`reverse`, `reverse=`, and named instances such as `reverse@r` reverse pictures while retaining ordered timestamps. Generic `threads`, `thread_type`, and `extra_hw_frames` options are accepted. Positional arguments, unknown options, and timeline `enable` options fail before replacing output, with Linux FFmpeg statuses 234, 8, and 176 respectively.
`framestep=3` (or `framestep=step=3`) keeps frames 0, 3, 6, and so on, preserving their timestamps. The default step is 1; use `-fps_mode passthrough` to write each selected frame once. The `enable` expression is evaluated for each input frame: disabled frames pass through, while enabled frames use the original input frame number for the step. For example, `framestep=2:enable='gte(n,3)'` keeps frames 0, 1, 2, 4, 6, and so on.
`loop=loop=2:size=2:start=3` (or `loop=2:2:3`) repeats the buffered two-frame sequence twice, then resumes the remaining input with shifted timestamps. As in FFmpeg, `start=3` buffers input frames 2 and 3 (zero-based); starts 0 and 1 both begin at the first frame. A buffer ending at EOF repeats the available frames. Timestamp shifts use the sum of buffered frame durations, independent of gaps between their timestamps. After `setpts`, loops retain replay and trailing timestamps as in FFmpeg 7; an intervening `fps` restores durations for shifting. Defaults disable looping. The `loop`, `size`, and `start` options accept arithmetic expressions; fractional results round to the nearest integer, with exact halves rounding to even (`loop=0.5+0.5:2.5:3` matches `loop=1:2:3`). Bounds are checked before rounding. Use `start=-1:time=500ms` (or `loop=1:2:-1:500ms`) to start buffering at the first frame whose timestamp reaches the duration. With `start=-1`, omitted times or times beyond the input leave video unchanged. Nonnegative frame starts take precedence over `time`. Sizes up to 32767 and nonnegative int64 frame starts are supported, including starts above JavaScript’s safe integer range. Starts past EOF leave the input unchanged without allocating repeated frames. `loop=-1` passes input through when `size=0` or the start is past EOF, without requiring an output limit. Use `loop=-1` with a finite `-frames:v`, `-t`, `-to`, or downstream `trim` to stop replay. Downstream `select` counts only retained frames toward the output limit. Put a finite `trim` before other buffered filters. Unbounded replay is rejected. Output `-ss`, `-t`, and `-to` select frames from the filtered timeline, including repeated frames. Expansion respects media resource limits. Output `-t` and `-to` cut the expanded video timeline after filtering; input time limits still apply before looping.
`tpad=start=1:stop=2:start_mode=clone:stop_mode=clone` adds copies of the first and last video frames, preserving their original pixels and shifting input timestamps by the start padding. The default `add` mode inserts solid-color frames (`color=black` by default); use `color=red` to change the fill. `start_duration` and `stop_duration` accept durations such as `500ms` and override the corresponding frame count when positive. Positional options follow `start:stop:start_mode:stop_mode:start_duration:stop_duration:color`. Use `stop=-1` with a finite output frame/time limit or downstream `trim`; downstream `select` counts only retained frames. Padding requires a known frame rate and respects media resource limits.
`shuffleframes="2 0 1"` (or `shuffleframes=mapping=2|0|1`) reorders each group of three frames. Indices start at zero, repeated indices duplicate pictures, and `-1` drops an output slot. Each mapping entry reads a decimal integer prefix: `1.5` and `1abc` select index `1`, while `0x1` selects index `0`. Output slots keep their original timestamps; incomplete final groups are dropped. The default mapping is `0`. Timeline `enable` expressions pass disabled frames through unchanged; only enabled frames enter shuffle groups, and a pending group survives disabled frames. Use `-fps_mode passthrough` to preserve gaps without duplicating frames.
`field=top` (the default) extracts rows 0, 2, and so on; `field=bottom` extracts rows 1, 3, and so on. `field=type=top` and numeric types `0`/`1` are also accepted. Output has half the input height, is progressive, and retains frame count, timestamps, frame rate, and sample aspect ratio. Native YUV planes are extracted independently, preserving subsampled chroma and 10/16-bit YUV444 samples.

`tinterlace=pad` (or `mode=pad` / `3`) doubles height and sample aspect ratio, inserting black scan lines below each source row on even-numbered frames and above it on odd-numbered frames. It preserves native YUV samples, timestamps and frame rate, and drops the final buffered frame. `fieldorder=bff` or `fieldorder=tff` (the default) changes interlaced field dominance by shifting rows, preserving native YUV422/YUV444 samples and frame timing. Progressive frames and frames already in the requested order keep their pixels. Named `order=bff`/`order=tff` and numeric `0`/`1` forms are accepted.

`tinterlace` defaults to `merge` (mode `0`): it alternates every row of two successive frames, doubling height and sample aspect ratio and halving frame rate. `mergex2` (mode `7`) slides forward one frame at a time, keeps the input frame rate, and alternates which frame supplies the top rows. Both preserve planar YUV samples, including subsampled chroma and 10/16-bit YUV444. `weave` combines disjoint pairs of input fields into frames with twice the height and half the frame rate, preserving the sample aspect ratio and native YUV samples. It defaults to top-field-first; `weave=first_field=bottom` puts the first input in the bottom rows and marks bottom-field-first output. The `top`/`t`/`0` and `bottom`/`b`/`1` values also work positionally. An unmatched final field is dropped. Use `-fps_mode passthrough` to write each resulting frame once.

`setfield=tff` and `setfield=bff` mark frames as top-field-first or bottom-field-first without changing any pixels or timestamps. `setfield=prog` marks frames progressive; `auto` (the default) keeps the input flags. Named `mode=` and numeric modes `-1` (auto), `0` (bff), `1` (tff), and `2` (prog) are also accepted. Y4M output carries the resulting `It`, `Ib`, or `Ip` header.

`tinterlace=mode=interleave_top` (or `tinterlace=4`, with an optional trailing `:`) combines each pair of frames: even-numbered rows come from the first frame and odd-numbered rows from the second, counting from zero. `tinterlace=interleave_bottom` (or `tinterlace=5`) takes even-numbered rows from the second frame and odd-numbered rows from the first, marking output as bottom-field-first (`Ib` in Y4M). Native planar YUV rows are preserved without an RGB round trip, including subsampled chroma and 10/16-bit YUV444 samples. Output keeps the first frame’s timestamp and spans both frames. `tinterlace=drop_even` (or `1`) keeps the first frame of each pair; `tinterlace=drop_odd` (or `2`) keeps the second. Both drop modes preserve the selected frame’s pixels and timestamp at half the input frame rate. Pair modes drop an unmatched final frame; `mergex2` emits one frame per adjacent pair. `tinterlace=interlacex2` (or `tinterlace=6`) doubles the frame rate, emitting each frame followed by a weave with the next frame; the final input frame is only used for that weave. Six frames at 6 fps produce ten frames at 12 fps. Field order follows the input, with progressive input producing bottom-field-first output. Other options are unsupported. Use `-fps_mode passthrough` to write each resulting frame once.

`doubleweave` combines overlapping pairs of input fields into double-height frames at the input frame rate: six fields produce five frames. It preserves sample aspect ratio, timestamps, and native YUV samples, including subsampled chroma and 10/16-bit YUV444. The first field goes in the top rows by default; `doubleweave=first_field=bottom` reverses the row order and marks output bottom-field-first. The `top`/`t`/`0` and `bottom`/`b`/`1` values also work positionally. Each input retains its row parity across overlapping pairs. Use `-fps_mode passthrough` to write each frame once.

`telecine=pattern=23` applies a repeating field cadence to progressive frames, weaving alternating scan lines when a pair spans two input frames. `separatefields` splits each frame into half-height progressive fields at twice the frame rate, preserving native YUV samples and source field order (bottom first for progressive input). Mixed fields preserve native planar YUV samples, including subsampled chroma and 10/16-bit YUV444. The default pattern is `23`; `first_field=bottom` reverses field order (default: `top`). Pattern digits specify fields per input frame; zero skips a frame, and an unmatched final field is dropped. Output timing follows the cadence, including fractional Y4M frame rates (6 fps with pattern `23` produces `F15:2`). Use `-fps_mode passthrough` to write each resulting frame once.

`tblend` (or `tblend=all_mode=normal`) drops the first frame and passes subsequent frames through unchanged, preserving their pixel data and timestamps. `tblend=all_mode=difference` (also accepting a trailing `:`) emits the absolute sample difference between adjacent frames, starting with the second input frame and retaining its timestamp. Difference mode blends color and alpha channels, with FFmpeg’s packed-to-planar alpha rounding. Repeated frames produce black output with zero alpha when the input has alpha; inputs without alpha remain opaque. `c0_mode` through `c3_mode` apply these modes to individual components (Y/U/V for YUV, G/B/R/A for RGB); unspecified components pass through. A positional mode such as `tblend=difference` sets `c0_mode`. An explicit `all_mode` overrides every component mode. Mode options accept numeric expressions: `all_mode=6` and `all_mode=3+3` select `difference`. Native YUV planes are subtracted directly, including subsampled chroma and 10/16-bit YUV444; repeated YUV frames produce zero in every plane. `tblend=all_mode=average` averages corresponding samples of adjacent frames, rounding down, and retains the second frame’s timestamp. Native YUV precision and RGBA alpha are preserved. `sendcmd=c='0.50 tblend all_mode normal',tblend=all_mode=difference` switches mode at the first frame at or after 0.50 seconds, preserving earlier output. Use `tblend@name` to target a named instance; an unqualified target selects the first matching instance. Invalid runtime modes preserve the active mode. `tblend=all_mode=addition` (or `all_mode=1`) adds adjacent samples with saturation at the channel maximum, including native 8/10/16-bit YUV samples. Timeline expressions such as `enable='gte(n,2)'` use input frame indices and timestamps; disabled frames pass through unchanged while still updating the previous frame, and the first input frame is always dropped. Other blend modes and options are unsupported. `all_expr` evaluates an expression for each pixel; `c0_expr` through `c3_expr` override it for individual components. `A`/`TOP` is the current sample and `B`/`BOTTOM` the preceding sample. Unspecified components keep their blend mode (normally the current frame). Expressions expose plane-local `X`, `Y`, `W`, `H`, relative plane scales `SW`/`SH`, input frame number `N`, and timestamp `T` in seconds. For example, `tblend=all_expr=X+Y` generates a spatial ramp. Expression results truncate and wrap to the stored sample width, matching FFmpeg. Use `-fps_mode passthrough` to preserve the resulting sequence. `all_opacity` and `c0_opacity` through `c3_opacity` accept values from 0 to 1. For difference, addition, average and multiply, zero retains the current sample and fractional opacity mixes it with the calculated result; normal mode mixes the previous and current samples. Global opacity below 1 overrides component values; at 1, component values apply independently. Components follow Y/U/V order for YUV and G/B/R/A for RGB. `tblend=all_mode=multiply` multiplies adjacent samples, divides by the maximum sample value (255 for 8-bit input), and truncates to an integer. It preserves native YUV planes, including subsampled chroma and 10/16-bit YUV444.
Burned SRT, WebVTT, and ASS captions use bitmap lettering and bottom spacing that scale with video height. ASS input preserves cue timing and text; its font and positioning styles are not rendered.
MicroDVD input (`-f microdvd` or automatic detection) uses the declared frame rate and converts `|` to line breaks. Leading style (`y`), font (`f`), size (`s`), and BGR color (`c`) directives become subtitle markup: lowercase directives apply to one line and uppercase directives persist across line breaks. Directives embedded in ordinary text remain literal. `-c:s copy -f microdvd` preserves caption frame numbers and text.
RealText input (`-f realtext` or automatic detection) preserves `<time begin="…" end="…">` intervals and `<br/>` line breaks while removing window and clear markup.

SAMI input (`-f sami`, `.smi`, or `.sami`) preserves millisecond SYNC timing and `<br>` line breaks; each cue ends at the next SYNC.

LRC lyrics support explicit `-f lrc` and automatic detection, infer cue ends from the next timestamp, and write each subtitle line with its own centisecond timestamp.

TTML output (`-f ttml` or `.ttml`) preserves subtitle cue timing, line breaks, and XML-escaped text.
PJS input (`-f pjs` or automatic detection) reads quoted cues with decisecond timing, converts `|` to line breaks, and preserves commas within dialogue.
JACOsub input (`-f jacosub` or automatic detection) reads tick rates and timing shifts, and exports alignment and inline line breaks to SRT.

MPL2 input (`-f mpl2`) reads decisecond cue timing, converts `|` to line breaks, and decodes a leading `/` on each line as italics when writing SRT.

SubViewer v1 input (`-f subviewer1` or detected script header) reads bracketed timestamps and ends each cue at the next marker, omitting headers and empty trailing cues.

SubViewer input (`-f subviewer` or detected `.sub` timecodes) preserves centisecond timing, skips information headers, and converts `[br]` to line breaks.
ASS input accepts UTF-8 and BOM-marked UTF-16LE/BE. ASS and SRT conversion preserves cue text and timing; ASS output uses a default style and centisecond timestamps. SRT-to-ASS conversion discards closed inline override blocks using native SubRip alignment handling; a leading `{\an8}` remains intact. ASS input applies the event’s named bold style when converting to SRT, decodes line breaks and retains the first explicit `\an` alignment override in each cue when converting to SRT. Matroska output with `-c:s ass` encodes basic SRT styling and line breaks; `-c:s copy` retains ASS packets and the original script header.
Matroska ASS-to-SRT conversion decodes event fields, basic style overrides and escaped line breaks while preserving cue timing.
Add external files to Matroska with `-attach notes.txt -metadata:s:t:0 mimetype=text/plain`. Repeat `-attach` for multiple files; attachment indices follow any copied attachments. Filenames default to the source basename and can be overridden with `-metadata:s:t:0 filename=guide.txt`.
Extract an input attachment with `-dump_attachment:t:1 notes.txt -i input.mkv -map 0:v -c copy output.mkv`; `t:0` selects the first attachment. Use `v:0` or `a:0` to extract codec initialization bytes instead. An empty destination uses the attachment’s stored filename. Extraction is independent of `-map`; existing destinations require `-y`.

WebVTT input `-kind subtitles|captions|descriptions|metadata` applies to the next input and selects its WebM CodecID during stream copy, preserving cue text, timing, identifiers, and settings. Input `-sub_charenc_mode ignore` preserves non-UTF-8 dialogue bytes when converting SubRip to SRT or WebVTT; `do_nothing` still validates UTF-8 and reports decoding errors. The mode applies only to the next input. WebVTT transcoding decodes `&amp;`, `&lt;`, and `&gt;` once, converts `&nbsp;` to `\h`, and removes `&lrm;` and `&rlm;`; other references stay literal. SRT and WebVTT transcoding balances bold, italic, and underline tags, closing unfinished styles at the end of each cue and ignoring unmatched closing tags. WebVTT transcoding converts literal `\n` to line breaks, using CRLF within SRT cues and LF within WebVTT cues; stream copy preserves the literal text. SRT-to-WebVTT conversion preserves literal timestamp-like text such as `a<00:00:01.100>b`, preserves bold, italic, and underline tags regardless of case, removes ASS override blocks and closed `{y:...}`/`{Y:...}` directives and converts `\N` and `\n` to line breaks; `-c:s copy` preserves the original SubRip packet bytes, including non-UTF-8 text. SRT dialogue continues across blank lines until the next timed cue. Signed SRT hours are accepted; a leading `+` requires `-f srt`. SRT output shifts negative timestamps to zero by default while preserving cue durations.

`ffprobe` uses the same audio/video implementation as `@poe-platform/safe-bash/commands/ffprobe`, with default limits of 32 MiB input and 1 MiB output. Pass `limits` to override them.

`-mpegts_service_id 42` sets the MPEG-TS program/service ID in PAT, PMT and SDT. IDs range from 1 through 65535 and default to 1; the PMT PID remains 4096 and stream copy preserves compressed packets.

## Features

- **Dynamic AST-Driven Format Support**: Pass `asts: [...]` to `ffmpegCommands({ asts })` to dynamically determine which container formats, extensions, demuxers, muxers, and codecs are supported by `ffmpeg` and `ffprobe`.
- **Video Merging & Concatenation**: `concatf:parts.txt` joins newline-listed local files into one seekable byte stream, including files split inside headers or samples. Relative entries resolve from the working directory. Supports `-f concat -safe 0 -i list.txt -c copy` and `-filter_complex "concat=n=2:v=1:a=1"` for joining clips. The local `concat:head.part|tail.part` protocol joins file bytes before probing and decoding, so headers and samples may cross part boundaries and input seeking uses the combined stream. Concatenating two complete WAV files respects the first WAV data length. Explicit `stream` declarations and `exact_stream_id` select concat input streams; WAV PCM uses stream ID `0`. A nonmatching declaration fails without replacing output. Manifests beginning with the exact `ffconcat version 1.0` signature are detected without `-f concat`. By default (or with `-safe 1`), concat filenames must be relative paths using ASCII letters, digits, underscores, hyphens, and periods, with no component starting with a period; `-safe 0` permits other filenames. Safe mode also rejects manifest `option` directives. With `-safe 0`, `option ignore_editlist 1` after a `file` ignores that MP4/MOV file’s edit list, using its full media timeline; `0` retains the edits. The option applies only to that file. Concat inserts H.264 SPS/PPS headers at IDR pictures by default (`-auto_convert 1`); set `-auto_convert 0` before the input to preserve the original packets. Manifest `stream_meta key value` attaches metadata to the preceding `stream` declaration, including track titles when copying audio into Matroska. `-segment_time_metadata 1` before the concat input attaches per-file `lavf.concatdec.start_time` and known `lavf.concatdec.duration` packet tags in microseconds; the default is `0`. Manifest `file_packet_meta key value` attaches packet tags only to the preceding file; output containers may omit these tags. Manifest `duration` sets the next segment’s timeline start without trimming samples; use `inpoint`/`outpoint` to trim. Input seeking requires a declared `duration` or both `inpoint` and `outpoint` for every file. Otherwise a nonzero input `-ss` warns that seeking failed; WAV PCM stream copy resumes after the packet consumed during probing instead of jumping to the requested time. `-ss 0` retains the full input. All three timing directives accept an explicit positive sign, such as `outpoint +0.5`. WAV concat seeks to the exact PCM sample frame at `inpoint`, including during stream copy, and retains the entire PCM packet that starts before `outpoint`. With a `duration` for every file, input `-ss` also seeks to the exact WAV PCM sample during stream copy; seeking exactly to EOF emits nothing, while seeking past EOF retains the final packet. A missing or undecodable later concat segment logs an error and preserves media already read; `-xerror` also makes the exit status nonzero. A missing or undecodable first segment fails without replacing existing output.
- **Trimming, Muxing & Faststart**: Matroska/WebM `-cues_to_front 1` places the seek index before media; `-cues_to_front 0` keeps the default trailing index. `-reserve_index_space 512` reserves 512 front index bytes, padding unused space. An undersized reservation fails unless `-cues_to_front 1` permits growth. Matroska/WebM `-live 1` writes an unknown-size Segment without Duration or Cues, including to local files; `-live 0` (the default) keeps normal file output. Packet data and timestamps are unchanged. Matroska/WebM `-cluster_time_limit 800` starts a new cluster when packet time exceeds 800 ms from the cluster start, preserving packet payloads and timestamps. The value is integer milliseconds; `-1` selects the 5000 ms default. Matroska/WebM `-c copy` preserves 360° projection and yaw/pitch/roll without changing encoded packets. Supports `-copyts` to retain MP4/MOV input timestamps and `-copyts -start_at_zero` to shift the input start to zero while preserving stream offsets (`-start_at_zero` alone keeps normal timestamp rebasing), input `-itsoffset` and output `-output_ts_offset` to shift timestamps (seconds, duration strings, or `ms`/`us` units), input/output `-ss`, `-to`, `-t` (including lavfi sources), input `-itsscale[:stream_specifier]` to scale packet timestamps while preserving packet durations, input `-sseof` with a negative offset from the end (for example, `-sseof -0.125 -i in.wav` keeps the last 125 ms), `-map`, `-an`, `-vn`, `-shortest`, `-movflags +faststart` (moves the movie header before media; default output and `-movflags -faststart` keep it after media), `-movflags +write_colr` (writes MP4 color information even when unspecified), output `-color_primaries`, `-color_trc`, `-colorspace` and `-color_range` (including stream specifiers such as `:v:0`) to set MP4 color tags during stream copy without changing encoded samples, and `-movflags frag_keyframe+empty_moov` (starts each fragment at a video keyframe while preserving packet data and timestamps; omit `empty_moov` to keep the first group of samples in the initial movie). `-movflags frag_every_frame` splits at every frame, including non-keyframes; add `empty_moov` to include the first frame in a fragment. `-frag_duration 500000` splits MP4 at half-second packet boundaries, including non-keyframes (microseconds; zero disables time-based cuts); add `-movflags +empty_moov` to fragment the initial samples too. `-fragment_index 7` starts MP4 fragment sequence numbers at 7 (default: 1; accepts integers from 1 to 2147483647). Fragmented MP4 includes a random-access trailer; `-movflags +skip_trailer` omits it. Fragmented MP4 uses explicit absolute base offsets; add `-movflags +default_base_moof` for moof-relative addressing. `-movflags +empty_moov+global_sidx` writes a global segment index per track; `+empty_moov+dash` writes indexes before each fragment using moof-relative addressing. Both default to keyframe fragment boundaries; `global_sidx` takes precedence when combined with `dash`. Unknown or unsupported `-movflags` names fail before writing output.
- **Filtergraphs & Frame Extraction**: A single labeled video chain such as `-filter_complex "[1:v]null[only]" -map "[only]"` selects only that source stream, including rawvideo output with multiple input files. Supports `scale` (`force_original_aspect_ratio=decrease` fits within the requested dimensions; `increase` fills them; `disable` keeps the exact dimensions), `hqx` (HQ pixel-art scaling with `n=2`, default `n=3`, or `n=4`), `xbr` (edge-blended pixel-art scaling with `n=2`, `n=3` (default), or `n=4`), `super2xsai` (2× pixel-art scaling), `epx` (pixel-art scaling with `n=2` or the default `n=3`), `stereo3d=sbsl:ml` and `stereo3d=sbsl:mr` (extract the left or right eye from a left-first side-by-side stream, preserving frame timing; named `in=sbsl:out=ml` options are also accepted), `crop` (`x` and `y` retain the previous pixel position on NaN, or the centered position on the first frame; width and height can reference each other through `ow`/`out_w` and `oh`/`out_h`; rejected options preserve existing output and return native exit codes: 8 for unknown options, 234 for invalid booleans, and 176 for unsupported `enable`; `keep_aspect` and `exact` accept case-insensitive `y`/`n` boolean aliases), `pad` (width and height can reference each other through `ow`/`out_w` and `oh`/`out_h`, for example `pad=oh*2:6:0:0`; `aspect=1/1` expands the canvas to the requested display aspect ratio, accounting for sample aspect ratio; rawvideo input has unknown sample aspect ratio, so nonzero `aspect` fails with status 234 and empty file output, while `aspect=0` disables that adjustment; `eval` accepts expressions such as `eval=0+1` or `eval=frame-init`, with values restricted to 0–1), `fps` (`round` and `eof_action` accept arithmetic and enum names, such as `fps=3:round=2+1` or `fps=2:eof_action=pass-1`; fractional option values round to the nearest integer with ties to even; `round=4` emits no frames; after `select`, the last retained picture is repeated until input EOF, while `trim` can end the timeline early), `hflip` and `vflip` (accept instance identifiers such as `hflip@named` and `vflip@named`; accept per-frame `enable` expressions using `n` and `t`; invalid expressions and unsupported options fail before replacing output), `transpose`, `rotate`, `negate` (precede it with `sendcmd=c='0.5 negate@x components b',negate@x=components=r` to switch a named filter from red to blue on the first frame at or after 0.5 seconds; inline `c`/`commands` schedules accept semicolon-separated component changes with optional `[enter]`; `enable` expressions accept `pos`, the source packet byte offset, or NaN when unknown, testable with `isnan(pos)`; preserves YUV component semantics after `hflip`, `vflip`, and `crop`; RGBA `components=r+g+b+a` selects channels; `negate_alpha` accepts FFmpeg boolean aliases, while the explicit component mask controls packed RGBA alpha; numeric component masks use FFmpeg 7 bits `r=1`, `g=2`, `b=4`, `a=8`, `y=16`, `u=32`, `v=64`, with RGB inverted and alpha preserved by default; `components=r+g+b+y+u+v` (or `119`) selects the default color channels for the input format, while unavailable components fail with status 234 and empty file-muxer output; `components` applies `+` additions and `-` removals in order, with a leading sign modifying the current mask (initially the default; for example, `+r`, `-0`, or `r+g-b`); repeated assignments retain that mask, so `components=r:components=+g` selects red and green; `components=none` selects no channels, like `components=0`), `bitplanenoise` (measures the selected `bitplane=1..16`, default 1; `filter=1` renders its neighbor-agreement mask, and `metadata=print` reports per-plane noise), `thumbnail[=n]` (selects the frame closest to the batch’s average color histogram; default batch size 100, flushes the last partial batch, and preserves selected timestamps), `histogram` (default 256×636 stacked RGB histograms for each frame; custom options are unsupported), `drawbox`, `overlay`, `feedback` (for example, `[0:v][back]feedback=x=8:y=4:w=16:h=8[out][tile];[tile]negate[back]` with `-map "[out]"` filters only the rectangle in every frame; the return branch must preserve its dimensions and frame count), `hstack`, `vstack`, `framepack=sbs` and `framepack=tab` (pack two matching video inputs left/right or top/bottom, with H.264 stereo signaling in MP4/MOV), and `%03d.png` image sequences with independent input/output `-start_number` values and no default frame ceiling. Input `-start_number` accepts signed 32-bit indices, including negative values (`f%03d.png` at -1 reads `f-001.png`). Input searches five candidate indices from `-start_number` (default 0); `-start_number_range` changes that window. After the first image, the sequence stops at the first gap. Output `-atomic_writing 1` writes each image to a `.tmp` file and renames it into place; `-atomic_writing 0` (the default) writes directly. Output `-strftime 1` expands calendar patterns such as `stamp-%Y-%m-%d-%H-%M-%S-%%.png` using the current clock and virtual `TZ` (UTC by default); `%%` produces a literal percent. Frames with the same expanded filename replace earlier frames. `-strftime 0` keeps sequence numbering, and `-update 1` keeps the filename literal. Output `-frame_pts 1` names images by presentation timestamps in the output frame time base instead of sequence numbers; `-enc_time_base 1:1000` (also `1/1000`) selects ticks of one millisecond for encoded image filenames, and `0` uses the default frame time base. The setting applies to one output. `-frame_pts 0` keeps default numbering. Both accept native case-insensitive boolean spellings such as `true`/`false`, `yes`/`no`, `on`/`off`, and `enabled`/`disabled`. Image2 is autodetected for numbered image filenames and paths containing `*` or `?`; bracket-only glob patterns need `-f image2`. Ordinary single images reject `-pattern_type` unless `-f image2` is supplied. `-pattern_type glob` reads matching image paths in sorted order with C-locale UTF-8 byte matching (`?` consumes one byte, so `é` needs two and `😀` needs four), including C-locale POSIX bracket classes such as `f[[:digit:]].png` and `f[[:alpha:]].png`; quote the pattern to keep the shell from expanding it. `-pattern_type none` reads the filename literally, including `%02d`. `-pattern_type glob_sequence` (the default) accepts numbered sequences and percent-prefixed glob tokens: `f%*.png` reads `fa.png`, `fb.png`, and other matching files. Prefix each glob metacharacter with `%`; unprefixed metacharacters stay literal. Explicit `-pattern_type glob` keeps percent signs literal, so `f%*.png` matches `f%a.png`. `-pattern_type sequence` selects only numbered mode. Numbered inputs accept one numeric field (`%d` or `%02d`); repeated numeric fields are supported only in output patterns. Numeric selectors `1`, `2`, and `3` are equivalent to `glob`, `sequence`, and `none`, respectively. `select=eq(interlace_type\,TOPFIRST)` selects top-field-first frames; `PROGRESSIVE` and `BOTTOMFIRST` select progressive and bottom-field-first frames. The classification follows the input field order and upstream `tinterlace` or `telecine` filters. `select` accepts arithmetic with `n`, `pts`, `start_pts`, `TB`, `t`, `start_t`, `prev_pts`, `prev_t`, `selected_n`, `prev_selected_n`, `prev_selected_pts`, `prev_selected_t`, and `key`, and `eq`, `lt`, `lte`, `gt`, `gte`, `between`, `isnan`, `not`, and `mod` functions. `pts` and `start_pts` are the current and first known incoming timestamps in ticks; `TB` is seconds per tick and follows upstream frame-rate changes. For example, at 5 fps, `select=gt(pts\,2)` selects the same frames as `select=gt(t\,0.4)`. `prev_pts`/`prev_t` track every input frame, including dropped frames, in ticks/seconds. `prev_selected_pts` uses ticks. Selection counts and previous selected frame values update only when a frame is kept; previous values start as NaN, testable with `isnan`; invalid or unsupported expressions fail without replacing output. Image sequences duplicate or drop frames to preserve output cadence after `select` and `setpts`; use `-fps_mode passthrough` (or `-vsync 0`) to write each filtered frame once. `-fps_mode` also accepts `:v`, `:v:0`, `:V`, `:V:0`, or `:0` to target the single output video stream. It accepts case-insensitive `passthrough`, `cfr`, `vfr`, `auto`, and `drop`; invalid values (including numeric modes) fail before writing output. `-fps_mode vfr` (or `-vsync 2`) drops frames at duplicate presentation timestamps while preserving gaps and the first frame at each timestamp. Legacy `-vsync 1` remains valid. `hstack` and `vstack` continue to the longer input by repeating the shorter input’s last frame; set `shortest=1` to stop at the shorter input. `crop` positions can refer to one another using `x` and `y` (for example, `crop=4:2:y:1` or `crop=4:2:1:x`) and accept arithmetic with `iw`, `ih`, `ow`, `oh` (and their `in_w`, `in_h`, `out_w`, `out_h` aliases), input aspect ratio `a`, sample aspect ratio `sar` (square pixels when unspecified), display aspect ratio `dar`, chroma subsampling factors `hsub` and `vsub`, zero-based frame number `n`, presentation timestamp `t` in seconds, and input packet byte position `pos` (NaN when unknown, testable with `isnan(pos)`); unsupported expressions fail without replacing output. `overlay` defaults to even x/y positions on the YUV420 chroma grid; `format=yuv422` aligns only x, while `format=auto`, `format=rgb`, and `format=yuv444` preserve integer positions. `overlay` positions accept arithmetic with `main_w`, `main_h`, `overlay_w`, and `overlay_h` (or `W`, `H`, `w`, and `h`); invalid or unsupported expressions fail without replacing output. `rotate` evaluates radian angles per frame (including `PI`, arithmetic, input dimensions `iw`/`in_w` and `ih`/`in_h`, zero-based frame number `n`, and timestamp `t` in seconds), defaults to the input canvas size, and uses bilinear sampling with opaque black fill by default. Use `enable` with frame index `n` or timestamp `t` (seconds), such as `rotate=PI:enable=gte(n\,1)`, to rotate selected frames and pass disabled frames through unchanged. Set `bilinear=0` to select nearest sampling; `bilinear=1` retains the default. Output dimensions accept `ow`/`out_w` and `oh`/`out_h` (or the second and third positional values), arithmetic with input/output dimensions, and `rotw(angle)`/`roth(angle)`. The rotated frame stays centered on the output canvas. `fillcolor` (or `c`) accepts colors such as `red`, `red@0.5`, and `0xff000080`, preserving alpha on RGBA output. Unsupported options and invalid dimensions fail without replacing output. With opaque black fill, decoded 8-bit planar YUV frames rotate before RGB conversion; custom fill colors use RGBA sampling. `format=rgba,rotate=...` explicitly selects RGB sampling. `drawbox=box_source=side_data_detection_bboxes` leaves frames without detection side data unchanged, ignoring explicit box geometry. `drawbox` geometry expressions can reference `x`, `y`, `w`, `h`, and `t` as well as input dimensions `iw`, `ih`, `in_w`, and `in_h` (for example, `drawbox=1:1:h:3:red:fill` draws a 3×3 box); omitted or nonpositive dimensions use the frame size, and invalid expressions fail without replacing output. It blends alpha colors such as `red@0.5` and `0xff000080` over existing pixels. On RGBA input, `color=invert` inverts each covered pixel’s RGB channels and preserves its alpha. GIF `-c:v copy` preserves original frame rectangles, palettes, and compressed image data. GIF `-global_palette 0` writes a local color table for each frame; `-global_palette 1` (the default) writes a global color table. GIF encoding enables rectangle offsetting and transparent differencing by default. Use `-gifflags -offsetting`, `-gifflags -transdiff`, or `-gifflags -offsetting-transdiff` to disable them independently or together; `0` disables both and `3` enables both. GIF input accepts `-min_delay`, `-default_delay` (0–6000), and `-max_gif_delay` (0–65535) before `-i`, in centiseconds; decoded frames retain their embedded delays. Animated GIF output preserves all frames and their timing; probing reports the full animation. `-final_delay N` sets only the last GIF frame delay in centiseconds (`0`–`65535`); `-1` preserves its delay, including stream copy. Output `-loop N` sets GIF repeats (`0` loops forever by default, `-1` omits the loop extension, `1`–`65535` sets a finite repeat count), including stream copy. Before `-i`, `-loop 0|1` controls image input repetition independently. GIF input `-ignore_loop 0` honors embedded loops, preserving frame order and delays; the default `-ignore_loop 1` reads one pass. Infinite GIFs require a finite `-frames:v`, `-t`, or `-to` bound. Input repetition is independent of output `-loop`. The `smptebars` source produces static SMPTE bars.
- **Consumer-Defined Limits**: Imposes no default limits while offering `cloudflareWorkerLimits()` and opt-in/opt-out feature controls (`features: { videoTranscode, filterGraph, lavfiSources }`).

`silenceremove` supports start/stop periods, durations, linear or dB thresholds,
`any`/`all` channel modes, and `avg`, `rms` (default), `peak`, `median`, `ptp`
(peak-to-peak), or `dev` (standard deviation) detection with a configurable window.
Numeric detector aliases are `0`, `1`, `2`, `3`, `4`, and `5`, respectively.
Negative stop periods remove repeated silent sections.
Shortened frames stay separate for downstream filters, frame limits, and checksums;
`timestamp=write` (or `0`, the default) writes a continuous output timeline.
`timestamp=copy` (or `1`) preserves each surviving input frame’s timestamp, including
gaps and frames shortened by leading removal.
Timeline `enable` expressions select whole input frames by timestamp `t` or frame
number `n` (for example, `enable=gte(t\\,0.012)`). Disabled frames keep all their
samples while silence detection continues, in both `-af` and mapped audio graphs.
`stop_silence` retains additional samples after each stop threshold is reached,
including repeated cuts (for example, `stop_silence=2ms`). Invalid or unsupported
options fail without replacing output.

WAV segment output (`-c copy -f segment part%02d.wav`) writes numbered files at audio packet boundaries, with a default target duration of two seconds. AAC stream copy to ADTS (`-c:a copy -f segment part%02d.aac`) or M4A (`part%02d.m4a`) cuts at encoded packet boundaries and preserves every packet, including encoder priming; CSV end times include the final packet duration. Matroska audio stream copy (`-c copy -f segment part%02d.mkv`) uses the same boundaries and preserves packet payloads and timestamps; `-reset_timestamps 1` rebases each segment to zero. Filtering and sample-rate conversion retain output frame boundaries: `-af volume=0.5`, `-af areverse`, and `-ar 12000` can produce cuts just after the requested time while preserving every processed sample. Set `-min_seg_duration 0.1` to require at least that duration before a scheduled cut advances to a packet boundary (the final segment may be shorter). The minimum defaults to zero, cannot exceed `-segment_time`, and is ignored with explicit `-segment_times` or `-segment_frames`. Set `-write_empty_segments 1` to emit empty segments when multiple scheduled cuts fall before the next packet; their CSV start and end times match. The default (`0`) skips empty segments. Use `-segment_time 0` to cut at every PCM audio packet. Use `-segment_time 1` to change the target. For WAV segments, `-segment_header_filename head.wav` writes one separate streaming WAV header and headerless audio in the numbered files. Concatenate the header and segments in order to reconstruct the WAV stream; the segment list contains only media files. Existing header files also require `-y`. `-segment_format` overrides the filename suffix for MP4, Matroska/ADTS audio stream copy, WAV, or raw audio output; for example, `-segment_format s16le part%02d.wav` writes headerless PCM16LE segments despite the `.wav` suffix. Without this option, the filename selects the format. For PCM WAV segments, `-write_header_trailer 0` writes only the encoded audio bytes, with no RIFF header or trailer; `1` (the default) writes normal WAV files. Segment boundaries and list timestamps are unchanged. Headerless output supports WAV and raw-audio segments; other segment formats are rejected before output is replaced. `-segment_time_delta 0.06` permits a cut at the first eligible packet up to 60 ms before each target time, including explicit `-segment_times`; the default is zero. Frame-based cuts are unchanged. `-segment_list_entry_prefix audio/` prepends text to list entries without changing segment filenames or creating a prefix directory. `-segment_list list.txt` writes one filename per line; `.csv` and `.ext` lists include actual start/end times. `.ffconcat` lists include the `ffconcat version 1.0` header and escaped `file` directives for reuse as concat inputs. Use `-segment_list_type flat` or `csv` to override the filename-based format; `ext` and numeric types `1` and `3` also select CSV with escaped filenames and start/end times. Use `-segment_list list.m3u8` for an M3U8 playlist with actual segment durations. `-segment_start_number 7` starts filenames and list entries at 7 (default: 0; accepts integers from 0 to 2147483647), without changing segment boundaries. MP4 segment output (`-c copy -f segment part%02d.mp4`) cuts at video keyframes and retains packet timestamps. Use `-segment_frames 4,12` to cut at zero-based reference frame numbers instead of time intervals; each cut waits for the next keyframe. Frame numbers must be nonnegative integers in ascending order. Set `-segment_list_size N` to list only the last N segments without deleting any segment files or changing their timestamps; `0` (the default) lists every segment. WAV output supports one audio track. Set `-individual_header_trailer 0` to write a WAV header only in the first segment and bare audio payloads in subsequent segments; the default (`1`) writes a header in every segment. Use `-segment_wrap N` to reuse N numbered filenames, replacing earlier segments while keeping every CSV entry in chronological order; `0` (the default) disables wrapping. Existing segments and lists require `-y` to overwrite. CSV lists are opened before writing segments, so an unavailable list destination leaves existing segments intact. Set `-reset_timestamps 1` to rebase each segment independently to its start; `0` (the default) keeps the original timeline. Use `-initial_offset 2.5` to add 2.5 seconds to segment packet timestamps, after any reset, without changing cuts, list times, or media samples. Signed seconds, duration strings, and `ms`/`us` units are accepted; WAV and raw PCM have no stored packet timestamps.

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
Native H.264 inputs decode with CAVLC/CABAC and reference-frame support. H.264 `-preset` (also `-preset:v` and `-preset:v:0`) configures x264 with `ultrafast`, `superfast`, `veryfast`, `faster`, `fast`, `medium`, `slow`, `slower`, `veryslow`, or `placebo`. Unknown names fail before output is written; stream copy ignores encoder presets. `-c:v libx264 -tune zerolatency` encodes without B-frames, removes source edit-list offsets, and preserves frame timing with equal packet PTS/DTS. Invalid tune names fail without overwriting output. FLAC output writes the muxer encoder tag; `-bitexact` or `-fflags +bitexact` omits it, including during stream copy. FLAC output accepts `-write_header 0` to emit only raw audio frames; `-write_header 1` retains the default stream header and metadata. FLAC output accepts `-metadata_header_padding` to reserve padding bytes (`0` removes padding, `-1` selects 8192 bytes); stream copy preserves compressed audio and omits source APPLICATION and SEEKTABLE blocks, including with `-map_metadata -1`. FLAC encoding accepts `-exact_rice_parameters 0|1`: `0` (default) estimates Rice parameters and `1` searches exact residual bit costs, preserving PCM in FLAC and Ogg FLAC. FLAC encoding accepts `-min_partition_order` and `-max_partition_order` (0–8; `-1` selects defaults) for Rice residual partitioning in FLAC and Ogg FLAC. An explicit minimum requires an explicit maximum; short blocks reduce the bounds to valid partitions. FLAC encoding accepts `-multi_dim_quant 0|1` to control first-order LPC coefficient refinement for FLAC and Ogg FLAC, preserving exact PCM. FLAC encoding accepts `-min_prediction_order` and `-max_prediction_order` (1–32 for LPC, `-1` selects the default) and `-prediction_order_method estimation|2level|4level|8level|search|log`. FLAC encoding accepts `-lpc_coeff_precision` (1–15 bits; `0` selects the default 15) to quantize LPC coefficients; fixed and verbatim predictors ignore it. FLAC encoding accepts `-lpc_type none|fixed|levinson|cholesky`; LPC modes use autocorrelation or covariance fits, with verbatim fallback when smaller. FLAC encoding accepts `-ch_mode indep`, `left_side`, `right_side`, or `mid_side` for lossless stereo decorrelation in raw and Ogg FLAC. FLAC Cholesky prediction accepts `-lpc_passes` (positive integer, default `2`); extra passes refine the bounded fit using residual weights. Other predictor modes ignore this setting. FLAC encoding accepts `-frame_size` from 16 through 65535 samples per frame for raw and Ogg FLAC (`0` keeps the default 2048). FLAC encoding accepts `-sample_fmt s16` for explicit 16-bit conversion and `-sample_fmt s32` for 24-bit output. FLAC encoding accepts `-compression_level 0` through `12` (`-1` selects level 5), increasing fixed-predictor search effort while preserving exact 16-bit or 24-bit PCM; compressed bytes may differ from native FFmpeg. WAV stream copy accepts `-fs` output-size limits in bytes or with SI/binary suffixes (for example, `16k` or `4Ki`). It stops before the next packet once the header and complete packets reach the limit; the resulting file may exceed that limit. Consumer resource budgets still apply. Other output formats and transcoding do not support `-fs`. FLAC trimming re-encodes exact samples while preserving 16-bit or 24-bit precision; `-c copy -t` and `-c copy -frames:a` retain whole compressed packets. Ogg output accepts `-serial_offset` (0 through 2147483647) to number logical streams consecutively; `-fflags +bitexact` starts numbering at zero unless an offset is supplied. Ogg-to-Ogg `-c copy` preserves Opus or Vorbis packets and metadata without decoding; Opus `-t` copy retains whole packets. Input-side `-ss` retains packets from the Ogg Opus seek page; output-side `-ss` trims by packet timestamp. `-page_duration` sets the target page duration in integer microseconds for Opus copy and Opus/Vorbis encoding (default `1000000`); `20000` writes one page per 20 ms Opus packet, and `0` disables duration-based flushing. Pages also flush at the Ogg lacing limit. `.ogg` output defaults to Vorbis; use `-c:a libopus` or a `.opus` filename for Opus, or `-c:a flac` for lossless Ogg FLAC. Opus encoding honors `-b:a` in bits per second, including `k` and `M` suffixes (for example, `-b:a 128k`).

`dialoguenhance` extracts dialogue from stereo into a third (front center) channel,
automatically mixing mono input to stereo with a gain of 1/√2 per side,
retaining the input frame count and sample rate. Center extraction follows native
single-precision FFT rounding, including nearly cancelling left/right samples.
Left and right are delayed by
three quarters of the analysis window (1536 samples at 44100 Hz). It accepts
`original` (0–1), `enhance` (0–3), and `voice` (2–32), with defaults `1:1:2`.
Options accept numeric expressions such as `original=1/2`. Empty, malformed,
or out-of-range values fail before an existing output is replaced.
Timeline `enable` expressions select whole analysis blocks: disabled blocks have a
silent center while delayed stereo and dialogue analysis continue.
Downstream filters receive analysis hops of 512 samples up to 50 kHz, 1024 up
to 100 kHz, and 2048 above 100 kHz, with a shorter final frame when needed.
`asendcmd=c='0.256 dialoguenhance@d original 0',dialoguenhance@d=enhance=0`
changes the named filter’s original-center gain at the next audio frame while
preserving overlap from earlier analysis blocks. Target `dialoguenhance` also
addresses an unnamed instance; invalid runtime gains leave the current gain unchanged.

`dcshift=0.125` adds a DC offset to every audio channel, preserving the sample rate and frame count and clipping samples to the full-scale range. It uses native signed 32-bit PCM arithmetic; narrower integer output discards low bits instead of rounding fractional shifts. `shift=0.125` is also accepted; shifts must be between -1 and 1. Out-of-range shifts return status 222; malformed shift expressions return 234. Both leave existing destination files untouched. Numeric expressions such as `dcshift=1/4` and `dcshift=shift=sin(PI/6)` are supported; invalid expressions fail without replacing the output. Repeated `shift` assignments use the last value, including after a positional value (`dcshift=0.125:shift=0.25`). `enable` selects whole incoming frames: `dcshift=0.25:enable=0` leaves samples unchanged, while `asetnsamples=n=4:p=0,dcshift=0.25:enable='between(n,1,1)'` shifts only the second four-sample frame. Expressions can use the frame index `n` or timestamp in seconds `t`, in both `-af` and mapped audio filter graphs. `dcshift=0.25:0.1` or `dcshift=shift=0.25:limitergain=0.1` limits peaks with a gain between 0 and 1. Zero limiter gain retains ordinary clipping. Bare `dcshift` and `dcshift=` use zero shift; a trailing colon such as `dcshift=0.25:` keeps the supplied value. An explicitly empty `shift=` is invalid and leaves an existing output untouched.

`speechnorm=p=0.5` adjusts PCM half-wave gains, limiting loud sections and gradually restoring gain in quiet sections. Long stretches without a zero crossing are split at input frame boundaries after exceeding 100 ms, so a distant peak does not attenuate earlier periods. Supports peak (`p`/`peak`), expansion (`e`/`expansion`), compression (`c`/`compression`), threshold (`t`/`threshold`), and gain adjustment (`r`/`raise`, `f`/`fall`). Timeline `enable` expressions such as `enable=gte(t\,0.1)` bypass whole output frames while period analysis and gain recovery continue. As in native FFmpeg, lookahead selects the latest analyzed frame’s timestamp `t` and frame number `n` for the enable decision. Channels are processed independently; other options fail explicitly.

`adecorrelate=stages=4:seed=23` decorrelates audio channels with seeded all-pass filters, preserving sample rate and frame count. Stages range from 1 to 16 (default 6); seed ranges from 0 to 4294967295, with -1 (default) choosing a random seed. Positional `adecorrelate=4:23` is also supported.

`aphaser=in_gain=0.5:out_gain=0.8:delay=3:decay=0.4:speed=1` adds a phasing effect while preserving sample rate and frame count. Supports named or positional input/output gain, delay, decay, modulation speed, and triangular (`type=t`, default) or sinusoidal (`type=s`) modulation. Numeric options accept FFmpeg expressions such as `in_gain=1/2`, `delay=6/2`, and `speed=2^0`; invalid syntax and out-of-range results fail before replacing the output. Validation returns native exit statuses: `8` for unknown options, `234` for invalid expressions, `222` for out-of-range values, and `176` for unsupported timeline (`enable`) options.

`aphaseshift=shift=0.5` rotates PCM phase without changing tone frequency, sample rate, or frame count. Supports named or positional `shift` (-1–1, in multiples of π), `level` (0–1), and `order` (1–16), with defaults `0:1:8`. Options accept arithmetic expressions such as `aphaseshift=1/2` and decibel values such as `aphaseshift=level=-6dB`. Fractional orders round to the nearest integer, with exact halves rounding to even (`2.5` → `2`, `3.5` → `4`). Channels have independent filter state; the all-pass filter introduces phase delay even at `shift=0`.

`adynamicequalizer=mode=listen:dfrequency=1000` outputs the detector’s band-pass signal for each audio channel. Named `dfrequency` (Hz) and `dqfactor` options control the detection band; `mode=-1` also selects listen mode. Other modes and options are rejected. Works in `-af` chains and mapped audio filter graphs.

`asoftclip=type=tanh:threshold=0.5` soft-clips signed PCM peaks. Supports `threshold`, `output`, and `param`, with named or positional options and arithmetic expressions such as `threshold=1/2`, `output=1/2`, and `param=1+1`. Values must remain within their option ranges. Timeline `enable` expressions use each audio frame’s index `n` and timestamp `t` in seconds; disabled frames pass through unchanged. Supported types are `hard`, `tanh` (default), `atan`, `cubic`, `exp`, `alg`, `quintic`, `sin`, and `erf`, with numeric aliases `-1` through `7`, respectively. `param` controls `tanh`, `atan`, and `alg`; the other curves ignore it, matching FFmpeg. Integer `oversample` factors from 1 (default) through 64 apply low-pass filtering before and after clipping while preserving the sample count and sample rate.

`apsyclip=clip=0.2` applies psychoacoustic clipping to PCM audio using overlapping windows and iterative spectral masking. Supports `level_in`, `level_out`, `clip`, `diff`, `adaptive`, `iterations`, and automatic output leveling (`level`). Like FFmpeg, it preserves the sample count with a window delay and does not drain the delayed tail.

`alimiter=limit=0.25:level=0:latency=1` limits PCM peaks with linked channels, lookahead attack, and gradual release. `latency=1` preserves sample positions and passes the shortened first frame, shifted timestamps, and drained tail frame to downstream filters; the default retains the lookahead delay. Supports `level_in`, `level_out`, `limit`, `attack`, `release`, and automatic output leveling (`level`). Timeline `enable` expressions (for example, `enable=gte(t\,0.1)`) select whole audio frames by timestamp `t` or frame number `n`; disabled frames pass through unchanged and pause the limiter state. Automatic release (`asc=1`) follows native attenuation recovery across sustained peaks and quiet intervals, with `asc_level` from 0 to 1 (default 0.5). Invalid limiter options exit with status 234 without touching the output. A valid attack shorter than one sample also exits 234 with `Attack is too small`, creating or truncating the output file.

`[0:a][1:a]amultiply[out]` (also `amultiply@name`) multiplies corresponding PCM samples from two inputs
resampling the second input to the first input’s sample rate and ending with the
shorter resampled input. Mono/stereo inputs are
remixed to the first input’s layout with equal-power gains before multiplication;
other layouts must match.
Single-input filters on either branch run before multiplication, for example
`[0:a]volume=0.5[x];[x][1:a]amultiply[out]`.

`amerge` input counts accept numeric expressions such as `1+1` and round to the
nearest integer with ties to even (`1.5` and `2.5` both select two inputs).
Repeated assignments use the last value, but every assignment must be valid
and within 1–64 before rounding. Invalid options preserve existing output.

`amerge=inputs=N` merges 1–64 inputs into at most 64 output channels, resampling
to the first input’s sample rate and ending with the shortest input. Omitted
input labels bind unused audio streams until all declared pads are connected.
`[0:a][1:a][2:a]amerge=inputs=3[out]` combines three inputs.
 Disjoint speaker layouts are combined in speaker
order: FR plus FL produces stereo ordered FL, FR; mono center plus stereo
produces 3.0 ordered FL, FR, FC. Overlapping speaker layouts concatenate channels
in input order using the default layout for the total channel count: two mono
inputs produce stereo, three mono inputs produce 2.1 (WAV mask `0x0b`), and
two stereo inputs produce 4.0 (WAV mask `0x107`).
`amerge` defaults to two inputs. Each branch applies its filters before merging,
for example `[0:a]volume=0.5[x];[x][1:a]amerge[out]` halves only the first
input's channels. Filters after the merge apply to the combined output.
Named instances such as `acrossfade@join=ns=4` and `amerge@pair=inputs=2`
use the same input handling and options as their unnamed forms.

`[0:a][1:a]astreamselect=inputs=2:map=1[out]` selects the second decoded PCM
input, converting mono/stereo inputs to the first input’s channel layout.
Stereo-to-mono averages both channels; mono-to-stereo uses equal-power gains.
Other channel layouts must match. Selection preserves frame boundaries for
downstream filters. Selection starts when all inputs have begun and ends at the earliest
final packet timestamp, retaining whole selected packets and honoring relative
input timestamps such as `-itsoffset`.
Mixed-rate inputs are resampled to the first input’s sample rate before selection,
preserving resampler frame boundaries and buffering. `inputs` defaults to two;
`map` must select one input. Missing input labels connect to unused audio streams
in input order: `[1:a]astreamselect=map=1[out]` selects the first recording,
while `astreamselect=map=1[out]` selects the second.
Map indices follow FFmpeg's integer-prefix parsing: decimal, leading-zero
octal, and `0x` hexadecimal, with an optional sign. Suffixes stop parsing, so
`1foo` and `1.5` select input 1, while `0b1` and `0.5` select input 0.
Single-input filters on each branch run before selection, for example
`[0:a]volume=0.5[x];[x][1:a]astreamselect=map=0[out]`. Filters after selection
are also supported; multiple output selections are currently unsupported.

Frame limits accept `-frames N` for all output streams, `-frames:0 N` for an output stream index, and `-frames:a:0 N`, `-frames:v:0 N`, or `-frames:s:0 N` for a stream index within its type. PCM transcoding counts output audio frames, including a separate resampler flush frame when changing sample rate. Selectors follow output mapping order; unmatched streams have no individual frame cap. The last matching option wins. During stream copy, reaching a frame limit also stops companion copied streams at that packet end time, without requiring `-shortest`. With `-shortest`, only whole packets ending within the shortest stream's presentation are copied; AAC priming is preserved.

Use `-frames:s N` to retain at most N subtitle cues per output stream without shortening their intervals; `0` emits no cues.

Use input `-sub_charenc UTF-8` (or another supported charset such as `ASCII` or `ISO-8859-1`) before `-i` to decode SubRip text. Invalid encoded events report decoder errors; `-c:s copy` preserves packet bytes without applying the charset. The option resets after each input.

Use `-fix_sub_duration` before an input to shorten overlapping subtitle events during transcoding. Each event ends no later than the next event starts; the final buffered event is omitted, matching FFmpeg 7.0.2. Stream copy retains the original events.

`asetnsamples=n=300:p=1` groups audio into 300-sample frames and pads the final frame with silence. Use `p=0` to keep a short final frame. Defaults are `n=1024:p=1`; `nb_out_samples` and `pad` are aliases. Padding also accepts case-insensitive `true`/`false`, `yes`/`no`, and `on`/`off` (for example, `p=TRUE` or `pad=On`). Frame sizes accept numeric expressions such as `n=2*128` or `n=2^8` and round to the nearest integer, with exact halves rounded to even (`255.5` and `256.5` both become 256). Padding also accepts case-insensitive `true`/`false`, `yes`/`no`, and `on`/`off` (for example, `p=TRUE` or `pad=On`). Frame boundaries are honored by `ashowinfo`, `asetpts`, `volume`, `aselect`, and `-frames:a`. For example, `asetnsamples=n=1:p=0,aselect='mod(n,2)'` keeps odd-numbered samples. Invalid frame-size expressions or padding values return status 234; frame sizes outside 1–2147483647 return 222. These errors preserve existing output files.

ICO output (`out.ico` or `-f ico`) with `-c:v png` writes one PNG-backed entry per mapped video stream, in mapping order. Each entry uses the first frame and must be between 1 and 256 pixels in each dimension. For example: `ffmpeg -i small.png -i large.png -map 0:v -map 1:v -c:v png out.ico`.

QOI input preserves exact RGB and RGBA pixels when decoded to PNG or RGBA raw video. QOI output (`out.qoi`, optionally `-c:v qoi`) preserves RGB and RGBA pixels, including the RGB samples of fully transparent pixels. Numbered image sequences such as `out%d.qoi` are supported. PNG `-f image2pipe -c:v png` input reads every concatenated PNG from a file or stdin, in order, at 25 fps by default (override with input `-framerate`). `-f image2pipe` writes concatenated image packets to a single file or stdout; `-c:v copy` preserves the original bytes and frame order without a container header. Numbered `-f image2 -c:v rawvideo -pix_fmt yuv420p frame%02d.Y` output writes separate `.Y`, `.U`, and `.V` plane files for each frame. Image2 input reads matching `.Y`, `.U`, and `.V` files with `-pixel_format yuv420p -video_size WIDTHxHEIGHT -i frame%02d.Y`, preserving per-frame plane order during stream copy. Image2 output honors `-c:v` independently of the filename suffix: `-c:v png -f image2 frame%02d.jpg` writes PNG frames, and neutral suffixes such as `.bin` work with an explicit encoder.

APNG output (`out.apng` or `-f apng`) writes all video frames into one animation. Use `-plays N` to set the play count (default `1`, `0` loops forever). Frame delays follow presentation timestamps; the final frame repeats the preceding interval.

`apulsator=hz=2:amount=0.8:offset_l=0:offset_r=0.5` modulates mono or stereo audio into stereo with independent channel phase offsets, mixing mono at a gain of √½ per channel. Select `mode=sine` (default), `triangle`, `square`, `sawup`, or `sawdown`, with named `hz`, `amount`, `offset_l`, and `offset_r` options while preserving sample rate and frame count. Numeric options accept FFmpeg expressions, such as `amount=1/2` or `offset_r=1/4`. The `width` option accepts 0–2 (default 1), with native effective limits of 0.01–1.99; `width=0.5` doubles the pulse phase within each cycle. Input and output gains `level_in` and `level_out` each default to `1` and accept values from `0.015625` through `64`. Positional options follow FFmpeg order: `level_in:level_out:mode:amount:offset_l:offset_r:width:timing:bpm:ms:hz`; `apulsator=1:1:0:0.5` is equivalent to `apulsator=amount=0.5`. Modes also accept numeric values 0–4 in the order listed above. Other pulsator options are rejected. Select `timing=hz` (default), `timing=bpm:bpm=180` (3 Hz), or `timing=ms:ms=250` (4 Hz). BPM accepts 30–300 (default 120); milliseconds accept 10–2000 (default 500), rounded to the nearest integer with ties to even. Only the selected timing value sets the pulse frequency.

`vibrato=f=5:d=0.5` modulates PCM pitch using an interpolated delay while preserving sample rate, channels, and frame count. Frequency (`f`, 0.1–20000 Hz) defaults to 5 Hz; depth (`d`, 0–1) defaults to 0.5. Positional `vibrato=5:0.5` is also supported. Both options accept numeric expressions, such as `vibrato=d=1/2` or `vibrato=10/2:1/2`. Like native FFmpeg, the filter introduces a short startup delay even at zero depth.

`pixscope` magnifies the default central 7×7 RGB sample and overlays channel statistics on frames at least 640×480, preserving dimensions and timing. Custom pixscope options are unsupported.

`ciescope=size=256` renders a square CIE 1931 xyY chromaticity plot using Rec.709/D65, with the spectral background and per-frame pixel density. `s` is an alias for `size`; the default is 512, with integer sizes from 256 to 8192 subject to media limits. Timing is preserved. Other ciescope options are unsupported.

`asubcut=cutoff=100:order=8` removes low-frequency rumble and DC from decoded PCM without changing the sample count. It supports `cutoff` (2–200 Hz, default 20), `order` (3–20, default 10), and `level` (0–1, default 1), as named or positional options, independently per channel.

`asubboost=boost=4:cutoff=100:feedback=0.4` boosts low frequencies in decoded PCM, independently per channel. It supports numeric `dry`, `wet`, `boost`, `decay`, `feedback`, `cutoff`, `slope`, and `delay` options, in that positional order, with native defaults and ranges. Numeric options accept arithmetic expressions, such as `asubboost=wet=1/2:cutoff=100*2`. `channels` (the ninth positional option) selects speaker names such as `FL`, `FR`, or `FL+FR`, and defaults to `all`. Unselected channels pass through unchanged, including when the selected speaker is absent. Invalid options preserve the destination and return native exit codes: 222 for out-of-range values, 8 for unknown keys, and 234 for malformed numbers. The `enable` expression selects whole input audio frames using `n` (frame number) or `t` (timestamp in seconds); disabled frames pass through unchanged and pause filter history.

`asendcmd=c='0.0005 asubboost@fx wet 0',asubboost@fx` changes wet gain at the first audio frame at or after the scheduled time, preserving filter history. Target `asubboost` selects the first subsequent instance; a named target selects that instance. Invalid runtime wet values leave the current gain unchanged.

`asupercut=cutoff=20000:order=8` attenuates ultrasonic PCM frequencies while preserving sample rate, channels, and sample count. Cutoff accepts 20000–192000 Hz (default 20000), order accepts 3–20 (default 10), and input `level` accepts 0–1 (default 1). Positional `cutoff:order:level` options and audio filter graphs are supported. Cutoffs at or above half the sample rate bypass filtering and input gain.

`aexciter` enhances high-frequency harmonics in decoded PCM. It supports `level_in`,
`level_out`, `amount`, `drive`, `blend`, `freq`, `ceil`, and `listen`, including
positional options and use in audio filter chains.

`tmix=frames=3:weights=1 2 1` mixes a rolling window of frames with normalized weights, ordered oldest to newest. `sendcmd=c=0.4 tmix scale 1,tmix=frames=2` changes scale starting with the first frame at or after 0.4 seconds. Use `tmix@name` to target a named instance; an unqualified target selects the first matching instance. Invalid runtime scale values preserve the active scale. `scale` (third positional option, 0–32767) multiplies the weighted sample sum before rounding and clipping; zero (the default) selects automatic normalization. For example, `tmix=frames=2:scale=0.25` quarters the sum. Retained 8-bit YUV planes are mixed directly. Startup repeats the first frame to fill the window. `enable` evaluates at each input frame, for example `tmix=enable=gte(t\,0.4)`. Disabled frames emit the oldest buffered frame with its original timestamp and freeze the equal-weight running sum; enabled frames use the newest timestamp. Rejected frame counts return Linux FFmpeg status 222 when out of range or 234 when invalid; invalid weights return 234 and unknown options return 8, preserving existing output files. `frames` defaults to 3 (1–1024) and accepts numeric expressions, rounding to the nearest integer with ties to even (`1+1` and `2.5` use two frames; `3.5` uses four); weights accept spaces or `|` as separators, default to 1, and repeat the final weight for remaining slots. Extra weight tokens beyond `frames` are ignored. `planes` selects which planes to mix with a bit mask (0–15, default 15): bits 1, 2, and 4 select Y, U, and V. Unselected planes are copied from the oldest frame in the window. Other options are unsupported. Each weight uses its numeric prefix: `1/2` is 1, `2+2` is 2, and `1.0suffix` is 1.

Use `-isync INDEX` before `-i` to synchronize that MP4/MOV input with another input’s source start time. `-isync -1` disables synchronization; the option resets for each input. With `-copyts`, also pass `-start_at_zero`. Inputs without a known source start time remain unchanged.

With AAC stream copy, output-side `-ss TIME` starts at the first packet whose timestamp is at or after the requested time. Input-side seeking preserves the packet crossing the seek boundary.

For input-side stream-copy seeking (`-ss TIME -i INPUT`), `-copypriorss 0` discards video preroll before the requested start and begins at the next keyframe. `-copypriorss 1` preserves preroll, matching the default. Packet timestamps remain relative to the requested start.

MP4/MOV output `-brand mp42` sets the container major brand without changing packet bytes or timing. Brands of fewer than four characters keep the default; longer values use the first four characters.

MP4/MOV output `-movie_timescale N` sets the movie header timescale independently of video and audio time bases. Movie durations and edit-list durations are rescaled; packet timestamps and bytes are preserved. `N` must be an integer from 1 to 2147483647.

MP4/MOV output accepts `-timecode 01:02:03:04`, `-metadata timecode=01:02:03:04`, and `-metadata:s:v:0 timecode=01:02:03:04`. These create a linked timecode track using the video frame rate; stream timecode overrides the global value. MP4, Matroska and WebM VP9 stream copy combines invisible frames into superframes by default; output `-fflags -autobsf` preserves separate packets and `-fflags +autobsf` enables grouping. Matroska and WebM stream copy accepts named `stereo_mode` stream metadata edits (for example, `-metadata:s:v:0 stereo_mode=right_left`) without changing encoded packets; plain copy preserves the source layout.

Audio `aac_adtstoasc` removes ADTS headers from AAC checksum packets and rejects incompatible codecs such as PCM before writing output. Raw AAC access units remain unchanged.

Output `-avoid_negative_ts make_non_negative` shifts leading negative decode timestamps to zero; `make_zero` shifts the first decode timestamp to zero even when positive. All streams receive the same shift and stream-copy packet bytes are preserved, including AAC priming. `disabled` and the default `auto` retain existing MP4/MOV timestamp behavior. Numeric values `1`, `2`, `0`, and `-1` are also accepted, respectively. The option resets for each output.

VPlayer input accepts a colon, space, or equals sign between the timestamp and dialogue, uses the next timestamp to close each subtitle cue, including empty closing lines, and converts `|` to line breaks. FFmpeg accepts `-f vplayer` or detects the content in generic `.txt` files.

AQTitle input (`-f aqtitle` or automatic detection) converts frame markers at 25 fps by default; `-subfps 50` before the input overrides the rate. Multiline captions are preserved and empty closing markers end the preceding cue. The media parser accepts the same override as `subtitleFrameRate`.

Spruce text STL input requires `-f stl`; colon-separated clocks use hundredths of a second and `|` becomes a line break. Binary EBU STL is not supported.
