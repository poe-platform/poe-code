# Portable media codecs

Decode real H.264 video and encode Vorbis or Opus audio in memory, including in
browser and Worker runtimes without Node, network access, or runtime WebAssembly
compilation. The static JavaScript runtime initializes only when a codec is used.

- H.264: CAVLC/CABAC, intra/inter prediction, reference pictures, B-frame ordering,
  SPS cropping, color conversion, and delayed-frame flushing.
- Ogg audio: Vorbis and mono/stereo Opus packets, codec headers, encoder delay,
  and exact final granule positions. Pass packets to your container writer.
- Decoder iteration releases its context when completed, interrupted, or failed.
  Codec state uses an arena that starts at 16 MiB and grows up to 128 MiB;
  returned frame/packet copies belong to the caller.

```ts
import { decodeH264, encodeOggAudio } from "@poe-code/media-codecs";

// Access units include SPS/PPS, or pass an AVC configuration record as extradata.
for (const frame of decodeH264(packets, extradata, 1920 * 1088)) {
  consumeRgba(frame.width, frame.height, frame.data, frame.pts);
}
const encoded = encodeOggAudio("vorbis", 44100, [leftPcm, rightPcm]);
```

Native code and licenses are preserved in [vendor/NOTICE.md](vendor/NOTICE.md).
