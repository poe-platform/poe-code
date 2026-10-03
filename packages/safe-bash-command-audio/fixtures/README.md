# Audio reference corpus

These short, generated tones contain no third-party recordings. They exercise two
channels (440 Hz at amplitude 0.3, 660 Hz at amplitude 0.2), 48 kHz, 0.12 seconds.
The fixtures are intentionally checked in: unit tests never create disk files or
require native encoders. `ffprobe.json` records FFprobe 9.0.1 (Lavf63.1.101) output;
filenames are normalized to basenames. Only the virtual command's supported schema
is compared; native-only codec diagnostics and dispositions are not promised.

Generation: FFmpeg lavfi input
`aevalsrc=0.3*sin(2*PI*440*t)|0.2*sin(2*PI*660*t):s=48000:d=0.12`, with
`-metadata 'title=Audio differential'`. WAV codecs: `pcm_u8`, `pcm_s16le`,
`pcm_s24le`, `pcm_f32le`. MP3: `libmp3lame -b:a 128k -write_xing 0` for CBR,
`libmp3lame -q:a 4` for Xing VBR (both retain ID3v2). FLAC: `-c:a flac`.
SoX 14.4.2 converts s16.wav to tone.ogg; FFmpeg `-c:a aac` converts s16.wav
to tone.m4a. Capture the oracle with
`ffprobe -v quiet -print_format json -show_format -show_streams FILE`.

Run recorded comparisons in the ordinary audio workspace unit task. Set
`AUDIO_NATIVE_TESTS=1` to also compare against installed ffprobe, SoX and soxi:
`AUDIO_NATIVE_TESTS=1 npm run test:unit --workspace=safe-bash-command-audio`.
Missing native tools produce explicit skips; native results are never cached here.
Native commands have five-second deadlines and 1 MiB output bounds.

SoX comparisons use raw little-endian float64 stdout to avoid non-seekable WAV
header guesses. Dithering is disabled. Trim, channels and normalization require
RMS error at most one 16-bit quantization step; concatenation is sample-exact.
Resampling requires identical rate/channel/sample counts and RMS error <=0.002,
including boundaries, for the independent sinc implementations. Statistics agree
to six decimal places. All virtual commands execute with an in-memory filesystem.
