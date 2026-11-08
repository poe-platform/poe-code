# safe-bash-command-sox

Edit WAV audio with `soxCommands()` from
`@poe-platform/safe-bash/commands/sox` or `poe-code/safe-bash/commands/sox`.

```sh
sox input.wav -r 16000 -c 1 output.wav trim 1 2 norm -3
sox first.wav second.wav joined.wav
sox -r 8000 -n tone.wav synth 0.5 sine 440
sox input.wav -n stats
```

Effects: `trim START [DURATION]`, `pad LEAD [TRAIL]`, `norm [DB]`,
`gain -n [DB]`, `rate HZ`, `channels COUNT`, `remix CHANNEL...`
(one-based channels, comma-separated mixing, `0` for silence),
`fade [q|h|t|l|p] IN [STOP [OUT]]`, `reverse`, `stat`, `stats`,
`synth SECONDS sine|square|triangle|sawtooth HZ`. Times accept seconds,
`HH:MM:SS`, or a sample count suffixed with `s`.

Format flags apply to the following file: `-r`, `-c`, `-b`, `-e`
(`signed-integer`, `unsigned-integer`, `floating-point`), `-t wav`.
Input rate may override WAV timing; channel and precision declarations must
match the WAV header. Output supports unsigned 8-bit, signed 16/24/32-bit,
and floating 32/64-bit WAV. Use `-` for stdin/stdout and `-n` for the null device.

Exports `createSoxCommand`, `createSoxCommands`, `SoxCommandsOptions`, `SoxLimits`.

These commands run only against the supplied virtual filesystem. They do not spawn
native tools. PCM effects decode and encode WAV; inspection also accepts MP3, FLAC,
Vorbis/Opus Ogg and M4A containers. Compressed transcoding is not supported.

The default limits are 32 MiB of input, 32 MiB of output, 4,194,304 interleaved
samples, 134,217,728 cumulative DSP work units and 64 input files. Override positive integer limits through `limits`.
Cancellation is checked during I/O; synchronous DSP is bounded by sample limits.
