# FLAC Worker fixture

`noise.flac` is two seconds of deterministic stereo noise, encoded with native
FFmpeg 9.0.1. It contains 94 valid frames and 96,000 samples per channel; its
223,492 bytes exceed both the 100,000-byte input-limit case and 65,536-byte
allocation bound. Tests only read the checked-in files; FFmpeg is not a test or
production dependency.

Generate the encoded fixture:

```sh
ffmpeg -v error -f lavfi -i 'anoisesrc=color=white:sample_rate=48000:duration=2:seed=42949' -ac 2 -sample_fmt s16 -c:a flac -compression_level 0 -map_metadata -1 -fflags +bitexact -flags:a +bitexact noise.flac
```

Validate and capture the reference from the repository root:

```sh
ffmpeg -v error -xerror -i scripts/fixtures/flac-probe/noise.flac -f null -
ffprobe -v error -of json -show_packets -show_frames -show_streams -show_format -show_entries 'packet=pts,dts,duration,size,pos:frame=pts,nb_samples,channels:stream=codec_name,sample_rate,channels,duration:format=filename,format_name,duration,size:stream_disposition=:stream_tags=:format_tags=' scripts/fixtures/flac-probe/noise.flac > scripts/fixtures/flac-probe/native.json
```

Both commands exited 0 with no diagnostics on native FFmpeg/ffprobe 9.0.1.
Selected fields exercise packet boundaries, timestamps, decoded sample counts,
stream metadata and original file size without coupling this resource test to
unrelated codec/disposition schema differences. Comparison preserves native JSON
whitespace within each top-level section and ignores top-level member order.
Only the input filename changes between the retained, stream and stdin routes.

SHA-256:

- `noise.flac`: `70263a4fb3d4393160fbd12462bddb7bd231bdbe0d1101164093505e78fc36e1`
- `native.json`: `031f999c20058b09550dd7aff7d66c7de74ef71b5f4d1467e041b3bcf73813cb`

The malformed case changes the Vorbis-comment block type at byte 42 to CUESHEET,
whose declared block is too short for a CUESHEET. The metadata-only case uses a
separate synthetic STREAMINFO header with a logical 2 MiB source and forbids
reads beyond byte 42; it exercises `probeFlacSource`, not packet decoding.
