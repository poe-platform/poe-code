# Audio AST implementation and handoff — #1646

## Scope

Implement the private, dependency-free `@poe-code/audio-ast` engine. #1647 owns ffprobe/sox commands and safe-bash/root exports; #1648 owns comprehensive differential/stress qualification; #1653 owns the combined publication gate. Those issues and parent #1446 remain separate work.

## Requirement verification

| Requirement                                                        | Completion evidence                                                                                                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WAV/RIFF fmt, PCM 8/16/24/32, IEEE float 32/64, extensible format  | Integer/float round trips in `index.test.ts`; extensible valid precision, subformat GUID and channel mask in `formats.test.ts`; native 24-bit extensible WAV inspected successfully    |
| WAV data, LIST/INFO, bext, fact                                    | INFO tag round trips; Broadcast Wave description/time reference/coding history and fact test; preserves bext on rewrite                                                                |
| MPEG-1/2/2.5 Layer III headers                                     | In-memory mono/rate/version/VBR fixtures in `formats.test.ts`; frame-by-frame byte bounds and consistent layout validation                                                             |
| Xing/Info/VBRI, exact duration/bitrate                             | Each VBR header tested; gapless count/delay/padding regression; native MP3 gives 12,000 presentation samples / 0.25 seconds and 128,000 bit/s                                          |
| ID3v1, v2.2/v2.3/v2.4, text/track/album/artist/artwork             | Version-specific fixtures, UTF-16, comments, JPG/PNG artwork, unsynchronization, v1.1 track and rewrite tests; transformed unsupported frames reject lossful edits                     |
| FLAC marker/STREAMINFO/sample layout/sample count/MD5              | STREAMINFO signature fixture in `containers.test.ts`; native FLAC sample layout/count verified                                                                                         |
| FLAC Vorbis comments, PICTURE, SEEKTABLE                           | Comment/vendor edit and seek point fixtures; picture/application-block preservation in `formats.test.ts`                                                                               |
| Ogg page framing and Vorbis/Opus identification/comments           | Checksummed page fixtures, packet continuation across pages, >64 KiB comment rewrite, artwork, granule grouping, chain/multiplex tests; strict native Vorbis/Opus decode after editing |
| Ogg granule duration                                               | Vorbis end granules and Opus pre-skip tests; chain vs multiplex duration regression                                                                                                    |
| M4A/MP4 ftyp/moov/trak/mdia/minf/stbl/stsd, mp4a/alac/Opus         | Sample descriptions/configuration tests in `mp4.test.ts`; absolute byte offsets and native AAC/ALAC files verified                                                                     |
| MP4 mvhd duration, udta/meta/ilst iTunes tags                      | Movie/media/edit-list timing tests; text/track/disc/artwork and freeform-atom preservation; 32/64-bit chunk relocation with moov before/after mdat                                     |
| decodePcm/encodeWav/transformAudio                                 | Public planar Float64 PCM API; full integer and float precision round trips                                                                                                            |
| Linear/windowed-sinc resampling                                    | DC preservation, output length and suppression above output Nyquist; native output is 16 kHz after resampling                                                                          |
| Mono/stereo remix and channel extraction                           | Averaging/duplication/custom matrix and channel extraction APIs; composition and extraction tests                                                                                      |
| Precision conversion                                               | Integer 8/16/24/32 and float32/64 WAV encoding/decoding; each output strictly decoded and probed natively                                                                              |
| trim/concat/pad/normalize/fade/stats                               | Composition, matching-layout concat, silence, peak/RMS dBFS, DC offset, crest factor and zero crossings tests; input immutability                                                      |
| Private package, empty runtime dependencies, esbuild dist/index.js | Actual manifest and lockfile; declared fresh workspace build; bundle metafile has no runtime imports                                                                                   |
| Package policies                                                   | All 18 rules evaluated without skips or violations in isolated audio artifact scope, using actual package metadata and esbuild metafile                                                |

## Checks executed

- `npm run test --workspace=@poe-code/audio-ast`: 48 passing tests across four files; all fixtures are in memory.
- `npm run lint --workspace=@poe-code/audio-ast`: ESLint plus production and test typechecks.
- `npm run build:workspaces -- --workspace=@poe-code/audio-ast --no-cache`: selected declared build completes normally.
- `npm run test:workspaces -- --workspace=@poe-code/audio-ast --no-cache`: selected declared unit task completes normally; no unavailable tests counted as passes.
- Package-lint API: all 18 rules evaluated for the audio artifact, zero violations/no skipped rules; esbuild output has zero imports.
- Native manual checks: FFmpeg-generated 0.25-second WAV, MP3, FLAC, Vorbis, Opus, AAC/M4A and ALAC/M4A files parsed, tags edited, then decoded with `ffmpeg -v error -xerror` and inspected with ffprobe. Six DSP output WAV precisions also strictly decoded and probed as mono/16 kHz/0.25 seconds.

The repository-wide package-lint CLI in this focused checkout reports six missing dist assets in github-workflows, poe-agent, terminal-pilot, tokenfill and toolcraft, and skips the root bundle rule because the root bundle has not been built. These are distinct from the audio artifact's complete policy evaluation; the combined root publication verification remains #1653's scope. No CLI presentation changes are included.

## #1647 handoff

Import the engine through `@poe-code/audio-ast` (development build dependency), and bundle it into the command package with esbuild. Public exports include `parseAudio`, `probeAudio`, `writeAudioMetadata`, `decodePcm`, `encodeWav`, `transformAudio`, `trim`, `concat`, `pad`, `normalize`, `fade`, `stats`, `remix`, `extractChannels`, `resample`, and their types. See the package README for examples and numeric semantics.

Compressed codecs support container/frame inspection and metadata editing; PCM decoding/encoding supports WAV integer/IEEE float. Fragmented MP4 metadata editing and opaque transformed ID3 frames reject unsafe rewrites. Commands must report those errors rather than claim compressed decoding/transcoding support. Existing container bytes remain views of immutable input; DSP outputs are independent buffers. Silence has negative-infinite dBFS. Ogg presentation samples subtract Opus pre-skip; MP3 presentation samples honor recognized gapless metadata; M4A presentation duration honors edit lists.

## Delivery checklist

Commit specific changed files, fetch/rebase onto current remote main, repeat the focused checks after any conflict resolution, push `HEAD:main` without force, and verify remote main contains the implementation commit. Record the commit and the complete requirement audit in #1646 before closing it. The user explicitly waived waiting for the full release.
