# safe-bash-command-ffprobe

Inspect audio with `ffprobeCommands()` from
`@poe-platform/safe-bash/commands/ffprobe` or
`poe-code/safe-bash/commands/ffprobe`.

```sh
ffprobe -v quiet -of json -show_format -show_streams recording.wav
ffprobe -show_entries stream=sample_rate,channels:format=duration -of csv recording.wav
```

Supports `-v quiet|error|warning|info`, `-of` / `-print_format` with
`json`, `compact`, `csv`, `default`, `flat`; `-show_format`, `-show_streams`,
`-show_entries section=fields` (including format/stream tags), `-select_streams a:0`,
and `-i`. Use `-` or `pipe:0` for stdin. Unknown flags fail explicitly.
Ogg comments appear in stream tags with their original field names; M4A format tags include container brands. Xing MP3 bitrates include the header frame, matching native ffprobe.
Writer options include `nk`, `nw`, `p` and `s` where applicable.

`createFfprobeCommand`, `createFfprobeCommands`, `FfprobeCommandsOptions` and
`FfprobeLimits` support direct host integration. Defaults: 32 MiB input, 1 MiB output.

Inspection uses the supplied virtual filesystem and never spawns native tools.
