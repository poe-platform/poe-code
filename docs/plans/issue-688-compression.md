# Issue 688: bounded bzip2, XZ, and Zstandard commands

Add `bzip2`/`bunzip2`/`bzcat`, `xz`/`unxz`/`xzcat`, and
`zstd`/`unzstd`/`zstdcat` to the byte-command family. All three formats need
compression and decompression, stdin/pipelines, `-d`, `-c`, `-k`, and virtual
file replacement with the existing compression family's source-preservation
rules. No native process or network codec fallback is permitted.
Preserve native defaults: bzip2 and xz remove successfully compressed input
unless `-k` is selected; zstd retains input by default.

## Implementation order

1. Reproduce all nine missing commands with focused tests.
2. Qualify the codec boundary before integrating it: bounded input and output
   steps, admitted codec memory, bounded synchronous work, cancellation between
   steps, cleanup, concatenated frames, and actual portable runtime loading.
3. Reuse the current compression stream and VFS staging machinery through
   format profiles. Keep gzip behavior covered by its existing tests.
4. Cover native fixture interoperability, binary/empty streams, file effects,
   corruption, truncation, hostile memory requirements, output limits,
   cancellation, and independent concurrent invocations.
5. Update maintained command inventories and test membership without rewriting
   sealed historical evidence. Verify built public consumers on Node, Bun,
   browser, and actual workerd; run appropriate maintained build/test/lint gates.
6. Commit owned paths, push main, verify release and published consumers, then
   close the issue.

## Feasibility findings

The existing byte command factory registers only gzip, gunzip, and zcat.
The existing gzip implementation already provides bounded byte chunks,
cooperative cancellation, private VFS staging, and output-consumer completion
checks. Its framing and filename rules are gzip-specific.

Initial library review rules out whole-buffer adapters. `compressjs` has
synchronous whole-stream entrypoints; its stream-shaped callbacks do not
provide asynchronous backpressure. The stock `compress-utils` streaming
wrapper drains and merges output synchronously. Its raw C bridge also needs
review of consumed-input reporting, concatenated-frame handling, and decoder
memory limits. Neither library is yet qualified for integration.

All nine command-availability tests fail against the current factory. An
isolated workerd probe using static compiled WASM modules roundtrips 64 KiB
through each of the three upstream codecs without Node compatibility. This
establishes a loading option, not production memory or CPU bounds. The ordinary
browser bundle currently requires no WASM module configuration, so an owned
bridge and generated JavaScript alternative are being evaluated before
changing the public packaging contract.

## Implemented candidate

The owned native bridge exposes consumed/produced counts and frame completion,
uses a 64 MiB allocation budget and a 128 MiB memory ceiling, and rejects
oversized decoder memory requirements. The generated JavaScript factories run
without runtime downloads, native processes, or dynamic WASM compilation. The
maintenance-only generator uses pinned sources and tools; repeated generation
produced identical hashes. Normal builds authenticate and copy the committed
artifacts, declarations, provenance manifest, and licenses into `dist`.

The streaming driver retains bounded input/output buffers, frame remainders,
XZ padding handling, backpressure, and cooperative cancellation. The existing
VFS staging and source identity checks remain shared. Native bzip2 output uses
periodic encoder flushing to bound sorting work; measured maximum calls in the
qualification cohort dropped from approximately 3.3 seconds to 233 ms. These
measurements are not a universal wall-clock guarantee. See
[the bridge evidence](issue-688-native-codec-bridge.md).

The 45 command checks pass, including embedded native fixtures and multi-file
streams. Independent native decoders accepted the produced empty and binary
streams for all three formats. Existing gzip cohorts passed 73 and 84 checks.
The build copy helper passed four in-memory checks for normal copying, complete
source admission, invalid inventories, and symlink refusal. Broader maintained
gates, final packed consumers, and release verification remain outstanding.

The maintained type route also exposed exact-optional-property and TextDecoder
receiver type errors in two existing test files. Narrow corrections preserve
the fixture behavior and passed focused strict typechecking and runtime tests;
they are separate from the codec implementation.
