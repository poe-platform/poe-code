# safe-bash-command-soxi

Read audio properties with `soxiCommands()` from
`@poe-platform/safe-bash/commands/soxi` or `poe-code/safe-bash/commands/soxi`.

```sh
soxi -r recording.wav
soxi -D recording.wav
```

`-t` type, `-r` sample rate, `-c` channels, `-s` samples, `-d` clock duration,
`-D` seconds, `-b` precision, `-B` bitrate and `-a` comments select one property.
Without a flag, print a readable summary. Multiple files are supported.
The same flags are available via `sox --i`.

Exports `createSoxiCommand`, `createSoxiCommands`, `SoxiCommandsOptions`, `SoxiLimits`.

These commands run only against the supplied virtual filesystem. They do not spawn
native tools. PCM effects decode and encode WAV; inspection also accepts MP3, FLAC,
Vorbis/Opus Ogg and M4A containers. Compressed transcoding is not supported.

The default limits are 32 MiB of input, 32 MiB of output, 4,194,304 interleaved
samples, 134,217,728 cumulative DSP work units and 64 input files. Override positive integer limits through `limits`.
Cancellation is checked during I/O; synchronous DSP is bounded by sample limits.
