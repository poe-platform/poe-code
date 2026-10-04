# safe-bash-command-ffprobe

Inspect audio and video with `ffprobeCommands()` from
`@poe-platform/safe-bash/commands/ffprobe` or
`poe-code/safe-bash/commands/ffprobe`.

```sh
ffprobe -v quiet -of json -show_format -show_streams recording.wav
ffprobe -show_entries stream=sample_rate,channels:format=duration -of csv recording.wav
```

Supports `-v quiet|error|warning|info`, `-of` / `-print_format` with
`json`, `compact`, `csv`, `default`, `flat`; `-show_format`, `-show_streams`,
`-show_entries section=fields` (including format/stream tags), `-select_streams a:0`,
and `-i`. Media inputs also support `-show_packets`, `-show_frames`, `-show_chapters`,
`-show_programs`, `-count_frames`, `-count_packets`, and video stream selectors such as `v:0`.
The audio and ffmpeg plugins share this command implementation. Use `-` or `pipe:0` for stdin. Unknown flags fail explicitly.
Ogg comments appear in stream tags with their original field names; M4A format tags include container brands. Xing MP3 bitrates include the header frame, matching native ffprobe.
Writer options include `nk`, `nw`, `p` and `s` where applicable.

`createFfprobeCommand`, `createFfprobeCommands`, `FfprobeCommandsOptions` and
`FfprobeLimits` support direct host integration. Defaults: 32 MiB input, 1 MiB output.

Inspection uses the supplied virtual filesystem and never spawns native tools.

For WAV inspection, `ffprobe -f wav -show_streams recording.wav` uses bounded header reads when the injected filesystem supports retained reads. Input limits still apply to the full logical file size. For stdin (`-`) and streaming filesystems without retained reads, the command scans headers incrementally and discards sample payloads without temporary storage. WAV packet/frame descriptors are generated incrementally. Output uses a bounded cache and caller-authorized filesystem backing before publication, so output-limit failures write no stdout. Large output needs a backing provider with retained read/write handles and conditional removal; memory filesystems keep backing data in RAM.

Automatic WAV metadata probing also uses retained caller reads, preserving the strict audio schema, INFO tags and multiple-data-chunk timing. Strict audio rejection preserves the existing general-media fallback. For stdin and streaming-only filesystems, automatic WAV probes stream into caller-backed storage with a 64 KiB cache, then replay the admitted input through the strict and fallback probes. Large inputs require retained read/write backing and conditional removal; an external backend keeps spilled data out of Worker memory. Input limits and source errors are resolved before output, and the backing is closed before publication. INFO keys and value spans use a caller-backed index, preserving duplicate replacement and numeric-key ordering. All five writers replay UTF-8 values and emit bounded fragments, including quoting and trailing-whitespace removal. Source and tag backing remain open until output admission finishes, then close before publication. Other automatic formats, media-only options and readFile-only backends still have buffering paths.
