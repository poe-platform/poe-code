# Audio AST

Inspect audio containers, edit their metadata, and process PCM samples in JavaScript without subprocesses or runtime dependencies. This private engine is bundled into the safe-bash audio tools.

| API                                                  | Use                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `parseAudio(bytes)`                                  | WAV, MP3, FLAC, Ogg Vorbis/Opus, and M4A audio AST with byte spans, metadata, pictures, and stream timing |
| `probeAudio(bytes)`                                  | Format, stream, duration, bitrate, and normalized tags                                                    |
| `writeAudioMetadata(bytesOrAst, tags, { pictures })` | Merge tags and preserve encoded audio; regenerate container sizes, MP4 chunk offsets, and Ogg checksums   |
| `decodePcm(bytesOrAst)`                              | Decode integer and IEEE float WAV to planar `Float64Array` channels                                       |
| `encodeWav(pcm, options)`                            | Encode 8/16/24/32-bit integer or 32/64-bit float WAV, with optional INFO tags                             |
| `transformAudio(pcm, effects)`                       | Apply ordered trim, pad, rate, channels, extract, normalize, and fade effects                             |
| `concat(buffers)` / `stats(pcm)`                     | Join compatible PCM buffers; measure peak/RMS dBFS, DC offset, crest factor, and zero crossings           |

```ts
import { parseAudio, decodePcm, transformAudio, encodeWav } from "@poe-code/audio-ast";

const info = parseAudio(inputBytes);
console.log(info.format, info.duration, info.tags.title);

const pcm = transformAudio(decodePcm(inputBytes), [
  { type: "trim", startSec: 1, durationSec: 5 },
  { type: "channels", channels: 1 },
  { type: "rate", sampleRate: 16000, method: "sinc" },
  { type: "normalize", targetDb: -3 },
  { type: "fade", inSec: 0.1, outSec: 0.2 }
]);
const outputBytes = encodeWav(pcm, { bitsPerSample: 24 });
```

PCM channels contain normalized samples. Operations return new buffers and leave inputs intact. Integer encoding rounds and clips to its representable range; float encoding preserves values outside ±1. Linear resampling is available for speed; the default windowed-sinc filter suppresses frequencies above the output Nyquist limit. Mono mixing averages inputs, mono-to-stereo duplicates samples, and `remix` accepts an explicit output-by-input weight matrix. `extractChannels` uses zero-based channel indices.

WAV parsing includes extensible format precision/channel masks, INFO, Broadcast Wave (`bext`), and `fact`. MP3 inspection walks MPEG-1/2/2.5 Layer III frames, reads Xing/Info/VBRI, and accounts for recognized LAME/Lavc encoder delay and padding. ID3v1 and ID3v2.2/2.3/2.4 expose text, comments, and artwork; writing uses UTF-8 ID3v2.4. FLAC exposes STREAMINFO, MD5, seek tables, comments, and pictures. Ogg supports continuation pages, logical streams, Vorbis/Opus comments and picture comments, and Opus pre-skip. M4A supports AAC, ALAC, and Opus sample descriptions, movie/media timing and presentation edit lists, iTunes text/track/disc tags and artwork, and 32/64-bit chunk offsets.

Compressed formats support inspection and metadata editing; decoding and encoding compressed audio are outside the PCM API. Metadata writing preserves unknown container chunks and blocks. ID3 frames with unsupported transformation flags or unmappable v2.2 identifiers cause a rewrite error rather than silently losing data. Fragmented MP4 editing is rejected because fragment-relative offsets require a different writer. Truncated structures, inconsistent layouts, invalid checksums, and unsupported encodings throw errors. AST byte arrays are views of the input; keep the input immutable while using its AST. Silence has `-Infinity` peak/RMS dBFS and zero crest factor. Zero crossings are counted per channel, ignoring intervening zero-valued samples.
