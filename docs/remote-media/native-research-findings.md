# Native media research findings

Research date: 2026-09-14. This report records research evidence. The implementation
plan is [remote-media-cli](../plans/remote-media-cli.md). No production implementation
or deployed compatibility is established here.

## Native ordering evidence

[The recorded oracle results](ffmpeg-native-ordering-probes.json) contain the full
argv, executable version/configuration, stderr, status and output hashes for seven
local FFmpeg 8.1 cases on macOS arm64. They use a generated one-frame input and owned
temporary directories. These are native reference observations, not shim tests.

| Case | Exit | Observed effect |
| --- | ---: | --- |
| Valid single output | 0 | Creates the encoded output |
| Unknown option after first output argument | 8 | Existing first output remains intact |
| Missing second output parent | 254 | Existing first output is truncated before failure |
| Missing LUT filter resource | 254 | Existing first output remains intact |
| MP4 on nonseekable stdout | 234 | Fails without emitting stdout bytes |
| Optional unmatched audio map | 0 | Automatic selection still produces video |
| Refuse overwrite with `-n` | 0 | Reports refusal; preserves existing output |

Error staging matters: eager dependency validation and publish-only-on-success
would both change behavior in these cases. An apparent error diagnostic is not
sufficient to invent a nonzero exit status.

The release source explains the surprising overwrite result:
[FFmpeg n8.1 ffmpeg_opt.c](https://github.com/FFmpeg/FFmpeg/blob/n8.1/fftools/ffmpeg_opt.c)
returns AVERROR_EXIT on refusal, and
[ffmpeg.c](https://github.com/FFmpeg/FFmpeg/blob/n8.1/fftools/ffmpeg.c)
projects AVERROR_EXIT to zero. The separately inspected
[source snapshot](https://github.com/FFmpeg/FFmpeg/blob/639ee849526cfe61ceb312776335c245b98bd9d4/fftools/ffmpeg_opt.c)
uses AVERROR(EEXIST) in that path. Source extraction and native oracles therefore
must refer to the same selected release/build, with platform effects recorded.

## Native file access has several entry points

In the FFmpeg snapshot above, libavformat/avformat.h documents io_open for
format-context stream access. libavfilter/vf_lut3d.c directly calls
avpriv_fopen_utf8; vf_drawtext.c calls ff_load_textfile again on configured reload
frames. libavutil/file.c uses open/fstat and, in mmap-enabled builds, mmap. Its
mmap-error path returns an error; its read fallback is a compile-time alternative.
A format-context callback alone is consequently insufficient as the complete
native dependency bridge.

The inspected [ImageMagick source snapshot](https://github.com/ImageMagick/ImageMagick/tree/2ed1b96b9bc71434f0c4e82e3c63fec029c684c6)
contains direct file opens and mapping in MagickCore/blob.c, including shared
writable mappings. MagickCore/delegate.c executes subprocess commands. A blob
callback must not be assumed to cover filesystem accesses made by delegates.

The design implication is a JavaScript parser and dependency resolver supplemented
by runtime file mediation covering the native access surface. A low-level mount
bridge is a candidate transport for those requests, not a replacement for the
JavaScript frontend. Static uploads alone cannot model later reads of mutable
resources, early output truncation or another client's concurrent writes.

## Provider and filesystem evidence limits

[Cloudflare Containers documents a FUSE example](https://developers.cloudflare.com/containers/examples/r2-fuse-mount/),
and [Sandbox documents bucket mounts](https://developers.cloudflare.com/sandbox/guides/mount-buckets/).
These establish available mounting mechanisms; they do not certify a custom
canonical filesystem, POSIX object-store semantics or every deployed Sandbox image.

[Modal VM Sandboxes](https://modal.com/docs/guide/vm-sandboxes) document FUSE support
and currently exclude GPUs. Standard Sandbox and VM Sandbox are distinct deployment
choices. A CPU filesystem proof does not qualify GPU workflows.

[Kernel FUSE I/O documentation](https://docs.kernel.org/filesystems/fuse/fuse-io.html)
distinguishes direct I/O, cached write-through and writeback. Direct I/O and mmap
capabilities depend on negotiated kernel features; cached data requires a coherent
invalidation scheme. Writeback assumes mutations pass through that cache and is
unsuitable as a default when other canonical writers exist. Latest kernel
documentation is not evidence that a provider's deployed kernel has that feature.
[libfuse low-level operations](https://libfuse.github.io/doxygen/structfuse__lowlevel__ops.html)
permit asynchronous replies, which is useful for a JavaScript-owned authority, but
callback lifetime, native inode mapping, cancellation and operation-specific error
semantics still require proof.

The [safe-bash contract audit](safe-bash-contract-findings.md) records missing public
contracts for extra descriptors, terminal control, coherence/locking, portable
identity, byte paths and exact large offsets. Interfaces alone will not establish
native mapping coherence. Qualification must cover all participating writers and
retained handles, including rename/unlink, not only path-based copies.

The local environment used for these observations had FFmpeg/ffprobe, but no
ImageMagick executable or Docker/Podman/Lima runtime was found. No Linux mount,
ImageMagick native corpus, Cloudflare deployment or Modal deployment was run.
These limitations remain explicit qualification work in the plan.

## Close errors and invalidation scheduling

Further inspection of [libfuse operations](https://libfuse.github.io/doxygen/structfuse__lowlevel__ops.html)
shows that release errors do not reach the triggering close/munmap. Flush can occur
multiple times for duplicated descriptors and is not fsync. Local locks can still
appear to work when network lock callbacks are absent. Therefore release cannot be
the bridge's sole publication/error boundary, and single-client lock tests are weak
evidence of distributed locking.

The [notification API](https://libfuse.github.io/doxygen/fuse__lowlevel_8h.html)
forbids entry invalidation along related operation paths or while holding locks those
operations need. Inode invalidation with writeback enabled can synchronously request
dirty-page writes; it does not await older pending writebacks. Notifications are
version-gated and may return unsupported. An invalidation acknowledgment alone is
not a complete ordering barrier.

These findings rule out a naive implementation that holds one global authority lock
while awaiting native invalidation. The execution plan now requires an independent
notification scheduler and explicit operation/lifetime tests. This is a design
constraint derived from documentation, not a successfully exercised bridge.

## Redirected HLS input: native HTTP oracle

[Recorded local HTTP evidence](hls-redirect-oracle.json) uses FFprobe 8.1, a generated
MPEG-TS segment and a loopback HTTP server. The server redirects
`/entry.m3u8?original=synthetic` to `/nested/index.m3u8?token=synthetic`.
The playlist names `segment.ts`. FFprobe succeeds and requests
`/nested/segment.ts`, without inheriting either query string. All three requests
carry the synthetic X-Oracle header and a bytes=0- Range header. The fixture uses
no real credentials. This establishes this same-origin case only; it does not
establish cross-origin credential handling, TLS behavior or cloud networking.

The [release HLS implementation](https://github.com/FFmpeg/FFmpeg/blob/n8.1/libavformat/hls.c)
maintains URL-based playlist/segment state. Combined with the observed redirect,
this rules out treating a downloaded playlist's temporary file path as its original
resolution base. A media dependency graph must retain protocol and effective base,
not just a list of bytes to upload. Network connection locality remains a separate
requirement from the directory materialization API.

## ImageMagick incremental execution and filesystem-sensitive parsing

Source inspected at commit `2ed1b96b9bc71434f0c4e82e3c63fec029c684c6`:
[magick-cli.c](https://github.com/ImageMagick/ImageMagick/blob/2ed1b96b9bc71434f0c4e82e3c63fec029c684c6/MagickWand/magick-cli.c),
[operation.c](https://github.com/ImageMagick/ImageMagick/blob/2ed1b96b9bc71434f0c4e82e3c63fec029c684c6/MagickWand/operation.c),
[option.c](https://github.com/ImageMagick/ImageMagick/blob/2ed1b96b9bc71434f0c4e82e3c63fec029c684c6/MagickCore/option.c).

ProcessCommandOptions reserves the final argument for implicit output, processes
options incrementally, and checks exceptions after operations. Its final-write
path checks stack balance. CLINoImageOperator's write branch clones image state
and calls WriteImages immediately. Thus the source supports an incremental effect
model, not a single final publication transaction. Native fixtures remain necessary
to establish concrete error severities/statuses for each case.

IsCommandOption reads the option:pedantic registry value and, when false, consults
IsPathAccessible before classifying a leading-sign token. This helper is not called
for every token: ProcessCommandOptions first looks up known option information.
The JS port must reproduce actual call sites, not generalize the documentation's
filename rule to all recognized options. Final output classification also calls
this helper. Dependency resolution and parsing therefore have an observable
filesystem interaction, not a universally pure argv-to-AST boundary.

The initial -concatenate special case calls ConcatenateImages. That function opens
the output before iterating inputs and removes each opened input after copying it.
This hidden delegate-oriented command adds deletion effects to the inventory.
These findings are source evidence only; no ImageMagick binary was executed.

## Native parser entry points are not discovery APIs

**Design decision after Fable review:** use stock executables with original argv.
The custom typed native-worker alternative discussed below is not selected. Native
metadata-dependent filenames reach the shim through runtime file access; JavaScript
does not control a second native media-operation state machine.


In [FFmpeg n8.1 ffmpeg_opt.c](https://github.com/FFmpeg/FFmpeg/blob/n8.1/fftools/ffmpeg_opt.c),
ffmpeg_parse_options splits arguments, applies global options, initializes terminal
handling, creates filtergraphs, opens inputs and outputs, creates loopback decoders
and finalizes filter bindings. The native entrypoint in
[ffmpeg.c](https://github.com/FFmpeg/FFmpeg/blob/n8.1/fftools/ffmpeg.c) calls it before
transcode. The [tool Makefile](https://github.com/FFmpeg/FFmpeg/blob/n8.1/fftools/Makefile)
builds those scheduler/option/mux components into the executable. These inspected
interfaces do not establish a public read-only CLI planning library.

Design consequence: invoking a native parser as a discovery pass before executing
the command is unsound. It can touch outputs, consume streams, initialize devices
or contact a one-use endpoint. Parsing in JavaScript must preserve stage boundaries,
and native feedback must be associated with the same execution session. Likewise,
ImageMagick's CLIOption dispatch is an executing operation, not a pure validator.

Two mechanisms must remain distinct in the architecture: an original native process
receiving argv with runtime resource mediation, and a custom native worker receiving
structured operations. The latter introduces a native ABI and lifecycle implementation;
it is not obtained merely by linking libavcodec. Prefer preserving the original
process where it satisfies the JS frontend contract. Where metadata feedback is
necessary, the early proof must identify a same-session hook and its exact native
ownership. Independent ffprobe invocations cannot stand in for reads of a changing
or non-repeatable input. No functioning hook or typed native worker is claimed here.
