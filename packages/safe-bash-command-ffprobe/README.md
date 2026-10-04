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

For WAV metadata, `ffprobe -f wav -show_streams recording.wav` uses bounded header reads when the injected filesystem supports retained reads. Input limits still apply to the full logical file size. Packet/frame enumeration, stdin, and automatic audio probing still use the buffered path.
