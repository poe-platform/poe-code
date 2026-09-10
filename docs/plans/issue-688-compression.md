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
source admission, invalid inventories, and symlink refusal. The normal workspace
build and maintained safe-bash type route passed. Packed consumers passed 413
checks each in Node, Bun, browser, and workerd, plus three strict type consumers.
Repository-wide unit and lint gates and release verification remain outstanding.

The repository-wide unit run exposed three stale root/playground command
inventories. Updating the exact names and counts, with three actual playground
codec pipelines, passed all 82 focused checks. Two native Git cache tests and
one TypeScript header contract also failed in the shared run. Final diagnostics
confirmed five-second timeouts. The Git checks now prepare their independent
cache fixtures separately from the tested transitions, retaining five-second
bounds and every native operation and assertion. All four focused checks pass.
The header contract reuses TypeScript syntax trees through DocumentRegistry,
while independently checking all four compiler profiles with full library
checking and the same positive and negative cases. All four checks pass. The
previously failing profile measured 967 ms versus 2133 ms in a baseline run;
host contention limits the timing comparison. Independent review approved both
repairs; the repository-wide unit rerun remains required.

The complete lint traversal found an explicit throw in cleanup's finally block,
an unused test binding, and compiler-generated unused bindings and intentional
switch fallthrough. Cleanup now branches before closing, preserving original
failures and propagating cleanup errors on success; 39 focused safety checks
pass, including a cleanup-error identity control. A named configuration entry
turns off only no-unused-vars and no-fallthrough for the three exact generated
modules. They remain parsed and covered by every other rule. Generated bytes,
hashes, handwritten-code rules, and historical lint policies remain unchanged.

The next maintained unit run passed the shared stage (22,401 tests), then
exposed stale byte-family fixtures and inventory assertions. The lifecycle
suite had passed raw bytes to the six new decoders, preventing its sink tests
from reaching the sink. Native format-correct frames restore that coverage;
all 73 checks and strict types pass without late unhandled rejections. The
byte-plugin suite now checks the exact 23-command order and collision handling
for every command; all 48 focused checks pass. The full run remains in progress.

The source census rejected the generated zstd module at its ordinary 1 MiB
limit. It now admits only the three exact codec paths using the same manifest
size bound as the build copier (at most 4 MiB per artifact), exact byte length,
and SHA-256 verification. Manifest bytes are included in admission evidence and
must match their later source capture. Ordinary 1 MiB, aggregate 64 MiB, and
5,000-file limits remain unchanged. Four new in-memory controls and four existing
census checks pass; the originally failing authorization suite passes all 56
checks. Independent review approved the change.

Committed-package verification also pinned the build command from before asset
copying. Its current bootstrap now authenticates the exact copier alongside the
compiler, admits only the maintained command, and explicitly runs the copier
before capturing the dist baseline. Synthetic controls verify all eight copied
asset hashes, three actual build/pack consumer profiles, and refusal of missing,
changed, symlinked, or legacy build inputs before product source reads. All 191
archive controls pass. The completed broader run's 40 failures belong to the
repaired lifecycle, inventory, census, and build-verifier groups; a clean
maintained rerun is still required.

The maintained type route also exposed exact-optional-property and TextDecoder
receiver type errors in two existing test files. Narrow corrections preserve
the fixture behavior and passed focused strict typechecking and runtime tests;
they are separate from the codec implementation.
