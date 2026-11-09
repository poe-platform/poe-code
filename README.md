<div align="center">
  <h1>Poe Code ⚡</h1>

<a href="https://poe.com"><img src="https://img.shields.io/badge/Poe-Sign up-purple?logo=poe&logoColor=white&color=5D5CDE&style=for-the-badge" alt="Discord"></a>
<a href="https://www.npmjs.com/package/poe-code"><img alt="NPM version" src="https://img.shields.io/npm/v/poe-code.svg?&style=for-the-badge&color=09B16B"></a>
<a href="https://discord.gg/joinpoe"><img src="https://img.shields.io/badge/Discord-Join-purple?logo=discord&logoColor=white&color=FF44D3&style=for-the-badge" alt="Discord"></a>

</div>

Power your favorite coding agents (Claude Code, Codex, OpenCode, and more) with your Poe subscription—**no need to handle multiple providers/accounts.** Poe Code routes everything through the [Poe API](https://poe.com/api) .

Configure an agent once and use its normal CLI or desktop app, or spawn one-off prompts through Poe. Installing or updating Poe Code leaves your skills untouched.

## Quickstart

### Set it as your default (works with CLIs and desktop apps)

This updates the provider’s config files and continue using your tools normally.

```bash
# Start the interactive setup
npx poe-code@latest configure

# Setup a specific agent
npx poe-code@latest configure codex # (or claude, opencode, goose)
```

### Unconfigure (remove overrides)

```bash
npx poe-code@latest unconfigure claude
```

## Authentication

Poe Code uses your [Poe API key](https://poe.com/api) for authentication. On first run, you'll be prompted to log in via your browser (OAuth). You can also provide your key directly:

```bash
# Interactive login (opens browser)
npx poe-code@latest login

# Or pass your API key directly
npx poe-code@latest login --api-key <your-key>

# Or set it as an environment variable
export POE_API_KEY=<your-key>
```

Credentials are stored locally in `~/.poe-code/`. Use `poe-code auth status` to check your login state.

```bash
# Remove all configuration and credentials
npx poe-code@latest logout
```

## Quick links

- [Utilities](#utilities)
- [Usage and Billing](#usage--billing)
- [Models](#models)
- [SDK](#sdk)
- [Research Preview](#research-preview)
- [Poe API](https://poe.com/api)

## Utilities

Utilities are especially useful for scripting and CI/CD.

#### Spawn a one-off prompt

```bash
npx poe-code@latest spawn codex "Say hello" --mode read
```

`--mode` is the permission mode: `yolo | auto | edit | read`.

#### Spawn against a GitHub repository

```bash
npx poe-code@latest spawn codex "Fix the failing tests" --cwd github://owner/repo --mode edit
npx poe-code@latest spawn codex "Review the auth module" --cwd github://owner/repo#main:packages/auth --mode read
```

#### Spawn a prompt via stdin

```bash
echo "Say hello" | npx poe-code@latest spawn codex --mode read
```

Stdin is piped here, so there is no TTY to prompt on — `--mode` is required.

#### Review a GitHub pull request

```bash
npx poe-code@latest code-review install
npx poe-code@latest code-review run "https://github.com/owner/repo/pull/123"
npx poe-code@latest code-review commit "https://github.com/owner/repo/pull/123" --dry-run
```

#### Test a configured service

```bash
npx poe-code@latest test codex
```

### Install agent CLIs

```bash
# Claude Code
npx poe-code@latest install claude-code

# Codex
npx poe-code@latest install codex

# OpenCode
npx poe-code@latest install opencode

# Goose
npx poe-code@latest install goose
```

### Optional flags

- `--dry-run` – show every mutation without touching disk.
- `--yes` – accept defaults for prompts.

## Usage & Billing

Check your compute points balance and review usage history.

```bash
# Show current balance
poe-code usage

# Show usage history (20 entries, then prompts to load more)
poe-code usage list

# Show a specific number of entries without prompting
poe-code usage list --limit 100

# Filter by model name
poe-code usage list --filter claude
```

## Models

List available Poe API models and filter them by provider, capabilities, modalities, and supported API endpoint.

```bash
# List all models
poe-code models

# Show only models that support the Responses API
poe-code models --endpoint /v1/responses

# Show only models that support Chat Completions
poe-code models --endpoint /v1/chat/completions

# Search by provider or model id
poe-code models --search claude
```

## SDK

In source checkouts, `npm run build` publishes a validated Safe Bash snapshot for `scripts/safe-bash-shim.mjs`, so command rebuilds keep the last successful runtime usable. Snapshots stay in `.cache/safe-bash-runtime`; remove this directory only after stopping local shells, then rebuild before launching again.

Safe Bash FFmpeg preserves leading ID3v2 and trailing APE text metadata when copying ADTS AAC to M4A. Safe Bash FFmpeg copies XVID/FMP4 AVI video to MP4 or Matroska as MPEG-4 Part 2, preserving compressed packets. WAV-to-AVI stream copy preserves IMA ADPCM audio blocks and format parameters. Safe Bash FFmpeg VP9 stream copy to AVI preserves `VP90` codec tags and compressed packets. Safe Bash FFmpeg `-live 1` writes Matroska/WebM with an unknown Segment size and no Duration or Cues; `-live 0` keeps normal file output. Safe Bash FFmpeg raw PCM output accepts `tee:first.pcm|second.pcm` to write identical bytes to both local files. Safe Bash FFmpeg `-cluster_time_limit` controls Matroska/WebM cluster duration in milliseconds while preserving copied packets. Safe Bash FFmpeg `hevc_metadata` crops the visible HEVC frame during stream copy, preserving coded pixels and compressed picture packets. Safe Bash `ffmpeg` and `ffprobe` accept `concatf:parts.txt` to read newline-listed local files as one seekable byte stream. Safe Bash FFmpeg `pcm_rechunk=r=30000/1001` aligns PCM packets to fractional video rates, with optional final-packet padding. Safe Bash FFmpeg `h264_metadata=sei_user_data=UUID+text` inserts UUID-tagged SEI user data during H.264 stream copy. Safe Bash ImageMagick `-local-contrast radius{xstrength}` adjusts local contrast while preserving alpha and 16-bit precision. Safe Bash ImageMagick `-bilateral-blur` smooths noise while preserving sharp edges. Safe Bash ImageMagick `-liquid-rescale` provides content-aware resizing while preserving page geometry. Safe Bash ImageMagick converts XWD window dumps with 8-bit palettes or 24/32-bit true-color pixels to PNG. Safe Bash `ffmpeg -af surround` upmixes stereo to 5.1, with configurable window size and optional LFE. H.264 stream copy supports display-orientation SEI rotation and flips, and selective orientation removal without changing encoded video. Safe Bash `ffmpeg -c copy` preserves Matroska/WebM 360° projection and pose metadata and writes a video-keyframe seek index. Matroska copy marks the first of multiple unmarked audio tracks default in mapping order, while respecting explicit dispositions. VP9 MP4/Matroska/WebM copy supports output `-fflags -autobsf` to preserve separate packets and `-fflags +autobsf` for default superframe grouping. VP9 MP4/Matroska/WebM stream copy automatically packs invisible frames with the next displayed frame, preserving decoded video. `ffmpeg -c:a libvo_amrwbenc -b:a 23.85k` encodes mono 16 kHz PCM to AMR-WB in 3GP or AMR output. Safe Bash FFprobe reports Matroska/WebM spherical projection, cubemap padding, signed pose, and MP3 ID3 user-defined text tags. ImageMagick `-white-balance` corrects color casts while preserving alpha. ImageMagick MPR reads support frame selectors, reversed ranges, and crop geometry. ImageMagick `.xwd` and `XWD:` outputs write native-readable 24-bit RGB XWD. ImageMagick `compare -set comment "reviewed"` adds or replaces PNG difference-image text properties while preserving unrelated properties. ImageMagick `compare -compress None|LZW|Zip|RLE` writes lossless TIFF differences. ImageMagick `compare -colorspace` measures distortion in sRGB, linear RGB, Gray, Lab, or CMYK, including independent black and alpha channels. ImageMagick `compare` applies scoped `-level`/`+level` adjustments while preserving fractional samples. ImageMagick `compare -interlace Plane` writes progressive JPEG difference images; `-interlace None` writes baseline JPEGs. ImageMagick `compare` accepts `( framed.png -trim )` to remove an operand’s border before measuring distortion. Percentage-based `-trim` honors `-define trim:background-color=color`; ordinary trim still uses corner colors. JPEG comparison output supports explicit `-sampling-factor 4:2:0` and `4:4:4`. TIFF difference images preserve the first operand’s resolution axes and units, including absent tags. Safe Bash FFmpeg and ffprobe accept inline `data:audio/wav;base64,...` media inputs. Safe Bash FFmpeg encodes mono 8 kHz PCM with `libopencore_amrnb` to 3GP or AMR and copies AMR-NB/WB audio from 3GP to standalone `.amr` files without re-encoding. FFmpeg and ffprobe detect FLAC after leading ID3v2 tags, retaining ID3 text only when FLAC comments provide no metadata. FLAC stream copy applies per-picture titles and picture types while preserving embedded images and audio. FFprobe applies 3GP AMR edit-list skips to packet side data and decoded-frame timing. Safe Bash FFmpeg stream copy and FFprobe preserve combined MP4 movie and track display transforms; FFprobe omits undeclared AU frame counts. ImageMagick `compare` saves an operand with `( input.png -write snapshot.png )` while retaining it for comparison. ImageMagick `compare` supports positional `-negate` and grayscale-only `+negate`, preserving 16-bit samples. FFmpeg `aphaseshift` rotates PCM phase while preserving tone frequency and sample count. Safe Bash [FFmpeg](packages/safe-bash-command-ffmpeg/README.md) supports Matroska/WebM front seek indexes with `-cues_to_front` and `-reserve_index_space`, and preserves WAV header speaker assignments when input channel-layout options disagree. FFprobe reads MP4/MOV timecode data-track tags and referenced video timecodes, including drop-frame timecodes. FFprobe preserves AU channel counts without inventing speaker layouts. FFprobe decodes both legacy QuickTime language IDs and packed ISO language codes in MP4 tracks. FFprobe reports Matroska video field order. ImageMagick `compare -read-mask mask.png` measures selected pixels and marks excluded pixels gray in the difference image. Safe Bash [qpdf](packages/safe-bash-command-qpdf/README.md) reports recovered PDF damage on stderr and exits `3`, or `0` with `--warning-exit-0`. Safe Bash [AWK record separators](packages/safe-bash-command-awk/README.md) support multi-character regular expressions, buffering regex-separated input to EOF within configured limits. Safe Bash [jq filters](packages/safe-bash-command-jq/README.md) can use `input_filename` and `input_line_number` to identify the current input source and position. `debug` emits JSON diagnostics to stderr while preserving its input. Safe Bash supports noncapturing SDK execution with `captureOutput: false` and streams CLI output without retaining a full result. Sips PDF conversion and detailed image inspection keep input and rendered pixels in caller-backed storage. ImageMagick `compare` applies `-delete` indices within the current image stack before selecting its two comparison frames. [ImageMagick](packages/safe-bash-command-imagemagick/README.md) supports `-treedepth` when reducing colors. Use `-sort-pixels` to sort each scanline by pixel intensity, or `-enhance` to reduce noise by averaging similar neighboring colors. Its `-statistic` uses the requested neighborhood width and height, including even dimensions. Its `-morphology Thicken` grows only foreground/background kernel matches while preserving existing foreground. Invalid `-statistic` geometry such as `x3` or `bad` fails without replacing the output. ImageMagick `-statistic` honors virtual pixels at image borders. Reduced palette colors weight RGB by alpha and group fully transparent colors together. ImageMagick `+remap` builds a shared palette across loaded images using the current `-colors` limit and dithering settings. ImageMagick preserves the first image’s print resolution and units when appending images, and uses stored background colors for smush and shear unless `-background` overrides them; shear applies `-compose` before resampling. It keeps grayscale color-matrix results in the gray channel and preserves CMYK ink channels when morphing mixed-color frames. It rejects the replaced `-recolor` option before overwriting output (use `-color-matrix`); it preserves fractional and out-of-range samples across chained color matrices and supports `-intensity` for alpha masks and linear stretch, ordered channel exclusions such as `-channel 'All,!Alpha'`; it selects only red for quoted `-channel 'Red Blue'`; commas or pipes select multiple channel names. It includes alpha with explicit `-channel Default` for Polynomial and sigmoidal contrast. Its distortion handling fits all supplied Affine and Perspective control point pairs and honors `distort:viewport` output size and origin, with `distort:scale` controlling output scale. AffineProjection applies six matrix and translation coefficients. ImageMagick alpha removal, association and disassociation preserve 16-bit RGB precision for PNG48 output. Swirl and implode honor the selected interpolation method. Sequence noise operators honor `-seed` for reproducible pixels. ImageMagick rejects invalid conversion channel masks before replacing output. [Pandoc RTF conversions](packages/safe-bash-command-pandoc/README.md) use caller-backed parsing and Lua filters, including streamed HTML image embedding. Pandoc DOCX input preserves embedded images and their media bytes. ZIP reads and TAR mutations use caller-backed staging and range reads; large archives require suitable external filesystem storage. FFprobe exposes 20-byte MP4 timecode descriptions with `-show_data -show_entries stream=extradata,extradata_size`. It reports a zero codec tag for ordinary AIFF and accepts `-select_streams d` for MP4 timecode streams and packets. FFmpeg and FFprobe reject piped WAV audio that precedes its format header. FFmpeg and ffprobe read PCM16 NIST SPHERE speech recordings in either byte order, preserving header tags and packet offsets. Both commands read float32 IRCAM audio in either byte order. FFmpeg output color options set SDR/HDR MP4 tags during video stream copy without changing encoded samples. FFmpeg input-side `-ss` retains Ogg Opus page preroll during stream copy. Opus stream copy from Ogg or Matroska into MP4 preserves decoder configuration and timing. [FFmpeg WAV extraction](packages/safe-bash-command-ffmpeg/README.md) decodes Ogg Opus/Vorbis, AAC, CBR/VBR MP3 and mono/stereo integer lossless WavPack audio in memory and supports `adeclip` restoration of clipped PCM peaks and `afwtdn` wavelet denoising and `anull` passthrough, `asupercut` ultrasonic attenuation and `asubboost` low-frequency enhancement in audio filter chains. FFmpeg `adynamicequalizer=mode=listen` outputs the detector’s band-pass signal. FFmpeg and FFprobe accept WebVTT input `-kind subtitles|captions|descriptions|metadata`, preserving the kind in WebM stream copy. FFmpeg supports input `-sub_charenc` for SubRip decoding while preserving raw bytes with `-c:s copy`. FFmpeg preserves named ASS bold styles when converting to SRT; `-xerror` stops subtitle transcoding at the first invalid UTF-8 cue. FFmpeg SubRip stream copy preserves original packet bytes, including non-UTF-8 text. FFmpeg input `-sub_charenc_mode ignore` preserves non-UTF-8 subtitle bytes in SRT and WebVTT output; `do_nothing` still validates UTF-8. FFmpeg converts literal `\n` in WebVTT dialogue to subtitle line breaks during transcoding. SRT-to-WebVTT conversion strips closed `{y:...}` and `{Y:...}` directives while preserving literal braces. FFmpeg retains the final decoded AAC samples unless an explicit time limit trims them. FFmpeg and FFprobe concat inputs accept `-segment_time_metadata 1` to attach per-file start and duration packet tags in microseconds. Concat input seeking honors declared durations and warns when an unindexed manifest cannot seek, preserving native WAV PCM continuation. FFmpeg concat timing directives accept explicitly positive durations, such as `outpoint +0.5`. FFmpeg DASH `-min_playback_rate` and `-max_playback_rate` advertise playback bounds in the manifest. FFmpeg DASH publishes dynamic manifests as segments become available and finalizes a static manifest at EOF. Independent H.264/AAC DASH segments advertise access and bitstream switching flags. FFmpeg DASH supports explicit MP4 or WebM segment selection with `-dash_segment_type`. FFmpeg Opus encoding accepts `-b:a` target bitrates. FFmpeg validates complete `-ac` channel counts before replacing output. FFmpeg DASH `-streaming 1` writes one fragment per frame without indexes while preserving segment boundaries. FFmpeg HLS honors segment intervals below 200 ms when keyframes permit. FFmpeg DASH supports `-utc_timing_url` to advertise a UTC timing source in its manifest. FFmpeg DASH selects WebM for VP9; MP4 media segments carry native `msdh`/`msix` segment brands and support time-based fragment subdivision with `-frag_type duration -frag_duration 0.5`. FFmpeg HLS playlist sizes accept numeric expressions and round decimals to the nearest integer, with exact halves rounded to even. FFmpeg HLS playlist types accept `0` (default), `1` (EVENT) and `2` (VOD). Repeated HLS options validate their final assignments; signed flags modify earlier flags. FFmpeg HLS accepts numeric segment types `0` (MPEG-TS) and `1` (fragmented MP4). FFmpeg HLS flags accept numeric masks such as `0` and `16`, including combinations with named flags. FFmpeg checksum outputs support RIPEMD128, RIPEMD160, RIPEMD256 and RIPEMD320. FFmpeg `md5:` output URLs hash encoded bytes and write a digest line to a file or stdout. FFmpeg whole-output and per-stream hashes support native 128-bit Murmur3 via `-hash murmur3`. FFmpeg `framecrc` includes a software header unless `-bitexact` or `-fflags +bitexact` is set. FFmpeg ADTS and AC-3 stream-copy checksums preserve complete packets and their native time base. ADTS output supports optional ID3v2.4 metadata with `-write_id3v2 1`, preserving copied AAC packets. FFmpeg `framemd5` and `framehash` report copied codec extradata sizes and selected digests, including ALAC configuration. FFmpeg `framecrc` reports copied codec extradata sizes and checksums. FFmpeg segments accept `-segment_time_delta` to cut at eligible packets slightly before each target time. FFmpeg `-initial_offset` shifts segment packet timestamps without changing cut points or list times. FFmpeg segment filenames and list entries can start at a chosen sequence number with `-segment_start_number`. FFmpeg segment lists accept `-segment_list_entry_prefix` without changing output filenames. Its `-segment_list_size N` keeps the last N list entries while retaining every segment file. FFmpeg `-segment_format` selects segment contents independently of the filename suffix, including headerless PCM. WAV segments support a separate header file with `-segment_header_filename`. Its `-write_header_trailer 0` writes headerless PCM WAV segments while preserving segment boundaries and list timestamps. FFmpeg WAV stream-copy segments preserve packet-aligned output seeks and their timestamps. FFmpeg also copies PCM audio into Matroska segments while preserving packet timestamps and samples. Matroska output includes CRC-32 checksums by default (`-write_crc32 0` disables them); WebM omits them. FFmpeg segment lists support filename-only output and CSV timestamps, inferred from the list filename or selected with `-segment_list_type flat|csv`. Its `afreqshift` filter shifts audio frequencies by a signed Hz offset, with output gain control. Its `aeval` expressions support sine waveforms such as `sin(PI*n/2)/2`. Its `aeval=abs(val(ch)):c=same` rectifies each audio channel. Its `aeval` conditionals evaluate only the selected branch and default an omitted else to zero. FFmpeg `-guess_layout_max` controls layout guessing for unmasked WAV input without changing its audio samples. FFprobe exposes all nine MP4 display matrix coefficients for nonidentity transforms. FFmpeg AIFF stream copy preserves title, author, comment and copyright text tags, including explicit `-metadata` overrides. FFprobe reports nominal AIFF PCM stream bitrates even with no sound samples. FFprobe reads local concat manifests and reports packet timestamps across clips. FFmpeg and FFprobe read local `concat:` inputs as one byte stream, including split headers and samples. Its standalone WebVTT packet dumps and hashes include exact caption bytes, excluding cue IDs and settings. Plain WebVTT reports counted cues only through requested read counts, without inventing a declared frame count. FFprobe reports FFmetadata `[STREAM]` sections as ordered data streams, including empty sections. FFprobe truncates AIFF container bitrates to whole bits per second. FFprobe AIFF packet data dumps and hashes exclude SSND padding; declared frame counts remain separate from read packet and frame counts. FFprobe WebVTT frames report decoded subtitle timing and display fields; packets retain millisecond timestamps. WebVTT stream start timestamps are reported only when packets or frames are read or counted. Standalone WebVTT streams omit undeclared language tags. Chapterless FFmetadata omits unknown duration and bit rate from JSON. FFmpeg detects BOM-marked UTF-16 ASS input and preserves its cue text and timing. FFmpeg Matroska/WebM stream copy applies named `stereo_mode` stream metadata edits without changing packets. Matroska audio stream copy supports setting, adding and removing `forced`, `hearing_impaired` and `visual_impaired` disposition flags. SRT-to-ASS conversion discards inline override text while retaining native alignment handling. FFmpeg and ffprobe honor local `subfile` byte ranges when probing, decoding and seeking. FFmpeg and ffprobe read embedded WAV ID3 title and artist tags, with later metadata chunks taking precedence. Automatic ffprobe MP3 and WAV probes also expose ID3 private owners and binary payloads as format tags. Piped WAV input retains every PCM data chunk, while filename input selects the last chunk. FFmpeg and ffprobe read WAV ID3 chapter times and titles. FFmpeg DASH output supports `-ldash 1` for per-frame streaming and GOP-based buffer timing. FFmpeg stream-copies standalone AMR-NB and AMR-WB packets to 3GP and decodes 3GP AMR-NB audio to PCM. FFmpeg also reads and writes Sony Wave64 (`.w64`) audio. Its segment muxer writes M3U8 playlists for `.m3u8` segment lists. Filtered and resampled WAV segments cut at output audio frame boundaries. Its `extrastereo` and `stereotools` filters accept case-insensitive Boolean values. Its `stereotools` filter supports stereo pair rotation (`phase=0`–`360` degrees), input and output gains, and `softclip` with adjustable `sclevel` (1–100). Its `stereotools=base` control narrows or widens stereo audio. Pan expressions accept subtraction, compact gains, scientific notation and hexadecimal gains such as `0x1p-1`; PCM16 mixing matches native integer overflow for large gains. Its `pan` filter infers FFmpeg’s default speaker positions for unmasked multichannel WAV, treats valid input channels absent from the input as silence and accepts nonfinite gains on the PCM16 output path. ImageMagick `compare -extract` crops or resizes subsequent inputs; `+extract` resets it. ImageMagick write masks stay aligned after `-flop`, `-crop`, and `-roll`. ImageMagick formatted output reports palette storage class and counts the index channel separately from alpha. FFprobe reads Matroska/WebM stereo layout tags and Stereo 3D side data directly from the input. FFprobe JSON chapter reports include only the fields selected with `-show_entries chapter=...`; QuickTime timecode samples remain packets without decoded frames. ImageMagick `-despeckle` reduces speckle noise with native border and alpha behavior. ImageMagick `-interpolative-resize` uses the selected interpolation method and preserves scaled page geometry. ImageMagick `-adaptive-resize` uses native mesh interpolation and preserves scaled page geometry. It also provides [Graphviz rendering](packages/safe-bash-command-dot/README.md) through `poe-code/safe-bash/graphviz`, [local audio/video inspection (including codec names, AMR mono layouts, MIME codec strings, H.264 chroma and AVC configuration) and WAV editing](packages/safe-bash-command-audio/README.md) through `poe-code/safe-bash/commands/audio`, [recursive file search with `rgrep`](packages/safe-bash-command-rgrep/README.md), and [structural code search and rewrites with `ast-grep` / `sg`](packages/safe-bash-command-ast-grep/README.md). AMR-WB audio in 3GP inputs decodes to mono 16 kHz PCM. ADTS AAC output supports optional trailing APE metadata with `-write_apetag 1` (off by default).

Use `poe-code` programmatically in your own code:

```typescript
import { spawn, getPoeApiKey, getPoeAuthIdentity } from "poe-code";

// Get stored API key
const apiKey = await getPoeApiKey();

// Fetch the authenticated Poe account identity
const identity = await getPoeAuthIdentity();

// Run a prompt through a provider
const result = await spawn("claude-code", {
  prompt: "Fix the bug in auth.ts",
  cwd: "/path/to/project",
  model: "claude-sonnet-4-6"
});

// Spawn against a GitHub repository
const { events, result: ghResult } = spawn("codex", {
  prompt: "Review the auth module",
  cwd: "github://owner/repo#main:packages/auth"
});

console.log(result.stdout);
```

Agent spawn activity timeouts and parallel concurrency limits are optional; set `activityTimeoutMs` or `maxConcurrent` explicitly when needed. Autonomous spawn retries have no ceiling unless `maxTimeoutRetries` is supplied.

For plugin-first agent composition, import the public agent builder from the
`poe-code/agent` subpath. In Cloudflare Workers, pass `agent({ fs, cwd, homeDir })`
with a SafeFS provider and configure an explicit API key or model. The agent and
`poe-code/memory` exports support Workers without `nodejs_compat`; host subprocesses
require an injected runner where supported:

```typescript
import { agent, openaiResponsesPlugin, systemPromptPlugin } from "poe-code/agent";

const run = await agent()
  .model("gpt-5.5")
  .use(openaiResponsesPlugin())
  .use(systemPromptPlugin())
  .run("Summarize the current repository", {
    cwd: process.cwd()
  });

console.log(run.output);
```

### `spawn(service, options)`

Runs a single prompt through a configured service CLI.

- `service` – Service identifier (`claude-code`, `codex`, `opencode`, `goose`)
- `options.prompt` – The prompt to send
- `options.cwd` – Working directory or workspace locator (optional). Supports local paths and `github://owner/repo[#ref[:subdir]]` locators. See [@poe-code/workspace-resolver](packages/workspace-resolver/) for the full locator syntax.
- `options.model` – Model identifier override (optional)
- `options.mode` – Permission mode: `yolo`, `auto`, `edit`, or `read` (optional; defaults to `auto`. Agents without an auto mode fail clearly)
- `options.args` – Additional arguments forwarded to the CLI (optional)

Returns `{ stdout, stderr, exitCode }`.

### `spawn.pretty(service, options)`

Same as `spawn()`, but renders the ACP event stream to stdout with colored, formatted output — matching the CLI's visual style.

```typescript
import { spawn } from "poe-code";

const result = await spawn.pretty("codex", "Fix the bug in auth.ts");
console.log(result.exitCode);
```

Returns `Promise<{ stdout, stderr, exitCode }>`.

### `getPoeApiKey()`

Reads the Poe API key with the following priority:

1. `POE_API_KEY` environment variable
2. Credentials file (`~/.poe-code/credentials.enc`)

Throws if no credentials found.

### `getPoeAuthIdentity()`

Fetches the Poe account identity for the resolved API key.

```typescript
import { getPoeAuthIdentity } from "poe-code";

const identity = await getPoeAuthIdentity();
console.log(identity.name, identity.handle);
```

Uses `POE_API_KEY` or the stored credential and honors `POE_BASE_URL`. Throws an API error when Poe rejects the credential.

## Research Preview

These features are available but subject to breaking changes.

- **[SafeJS](packages/safe-js/README.md)** — A JavaScript interpreter with explicit host capabilities, portable browser/Worker root exports, a `/workerd` entry, workerd-aware `poe-code/safe-js` and `poe-code/safe-fs` imports, filesystem adapters, explicit Worker host-context capture, configurable unlimited resource budgets, and resumable checkpoints.
- **[Pipeline](packages/pipeline/)** — Run task plans with configurable steps, live task progress, queued follow-up messages, and plans you can add while the TUI is running.
- **[Ralph](packages/ralph/)** — Agentic build loop that iterates on a markdown doc
- **[Experiment loop](packages/experiment-loop/)** — Karpathy-style optimize loop: agent changes code, eval script scores it, keep or discard via git, repeat.
- **[Poe Agent](packages/poe-agent/)** — Composable agent runtime with shared safe-fs access


### Update Poe Code

```sh
npx poe-code@latest update
npx poe-code@latest update --package-manager pnpm
```

For version checks, dry runs, and managed worktrees, see the [reference](docs/README_FULL.md#updates-and-managed-worktrees).
