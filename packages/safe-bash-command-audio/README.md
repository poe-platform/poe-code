# safe-bash-command-audio

Inspect audio and edit WAV files without installing native audio tools.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { audioCommands } from "@poe-platform/safe-bash/commands/audio";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(audioCommands());
await shell.exec("sox -r 8000 -n /tone.wav synth 0.1 sine 440");
const result = await shell.exec("ffprobe -of json -show_streams /tone.wav");
await shell.dispose();
```

The same plugin is available from `poe-code/safe-bash/commands/audio`.
The engine API is available from `/audio-ast` under either Safe Bash prefix.
`createAudioCommands()` returns the three command definitions. The composition
package contains no command implementations; each frontend has its own workspace.

| Command | Purpose |
| --- | --- |
| `ffprobe` | Container/stream metadata with five output writers |
| `soxi`, `sox --i` | File type, rate, channels, samples, duration, precision, bitrate, tags |
| `sox` | WAV effects, concatenation, synthesis and analysis |

Registration checks all collisions before changing the registry. Register the
individual `soxCommands()` and `soxiCommands()` plugins if an existing media plugin
already provides `ffprobe`. `replace: true` explicitly replaces existing commands.

These commands run only against the supplied virtual filesystem. They do not spawn
native tools. PCM effects decode and encode WAV; inspection also accepts MP3, FLAC,
Vorbis/Opus Ogg and M4A containers. Compressed transcoding is not supported.

The default limits are 32 MiB of input, 32 MiB of output, 4,194,304 interleaved
samples, 134,217,728 cumulative DSP work units and 64 input files. Override positive integer limits through `limits`.
Cancellation is checked during I/O; synchronous DSP is bounded by sample limits.
