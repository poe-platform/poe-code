# Issue 669: browser-default dependency feasibility

## Assignment and status (2026-09-08)

Preserved request:

> Issue669 browser-default dependency feasibility sidecar. Read AGENTS.md in /home/kjopek/project/poe-code. Root owns integration, three workers handle existing bounded regex provider/Node factory, optional portable preset, and shared browser+portable bundle identity. You own only docs/plans/issue-669-browser-runtime-graph.md and optional NEW narrowly named browser-graph regression test agreed with root; do not edit products, bundler/package scripts/manifests/README or run full suites. Validate exact obstacle: current complete /portable preset still imports node:crypto, node:stream, node:zlib, perf_hooks/timers/path; default public entry must execute representative79-name inventory in actual browser WITHOUT unavailable Node host integrations, as well as workerd/Node/Bun. Inspect reachable source and existing browser/platform.mjs, compression/gunzip/archive semantics and budgets. Produce concise concrete adapter/change map: which dependencies are genuinely portable already, which have pure existing alternatives, and minimal semantics-preserving implementation path for hashes/compression/streaming (including concatenated gzip, CRC, level/options, cancellation/backpressure/cleanup), not generic brainstorming. Preserve full request; do not call browser bundle success runtime acceptance, don't propose native-RegExp timeout fallback, don't weaken bounds or silently drop command families/options. If a missing library is necessary, research only primary docs and report exact tradeoffs; don't install or modify dependency manifests. Current bounded regex provider already exists and should be reused. First send an early blocker/graph finding while root integrates additive mixed-entry fix; then bounded plan with exact test acceptance. No Git operations.

Only this document is changed. Early findings were sent to root before this plan.
No product edits, new tests, dependency installation, full suites, or Git operations.
This is feasibility evidence, **not browser runtime acceptance or issue completion**.
Root retains integration/release ownership; the three existing assignments remain
unchanged. See `issue-669-portable-default-api.md` and
`issue-669-shared-entry-runtime.md` for their separate delivery boundaries.

## Reproduced graph obstacle

Using installed esbuild with `resolveBrowserShellBuild(process.cwd())`,
`write: false`, and sourcemaps disabled produced this reachable source graph:
`src/portable.ts` → `plugins/portable.ts` → `plugins/composition.ts` → complete
command families. The emitted portable entry still imports:

| Reachable source under `packages/safe-bash/src/` | Unavailable host imports |
| --- | --- |
| `commands/bytes/checksums/index.ts` | `node:crypto` (`createHash`) |
| `commands/bytes/compression/files.ts` | `node:crypto` (`randomUUID`) |
| `commands/metadata/mktemp.ts` | `node:crypto` (`randomInt`) |
| `commands/bytes/compression/stream.ts` | `node:stream`, `node:stream/promises`, `node:zlib` |
| `commands/bytes/compression/gunzip.ts` | `node:zlib` (`createInflateRaw`) |
| `commands/archive/stream.ts` | `node:zlib` (`createGzip`, `createGunzip`) |
| `commands/timeout/scheduler.ts` | `node:perf_hooks`, `node:timers` |

Removing the permissive external list and resolver plugin, retaining the existing
`node:stream/web` alias, reproduces **11 browser link errors** at those imports
plus `contracts/path.ts:2` (`node:path`). Important correction: `node:path` is
allowlisted but is **not an emitted external in the inspected current bundle**;
its sole reachable path edge is already replaced by the platform module.

`scripts/bundle-safe-bash.test.ts` currently allows those Node externals and
executes the portable artifact through a Node `createRequire` VM bridge. That
validates composition/identity in Node, not execution without Node integrations.
The browser-only preset's smaller clean graph is not the complete 79-name preset.
Shared chunks fix argument-carrier identity, not these host dependencies.

All probes used Node v22.22.0 and were in-memory; no output files were written. The graph probe is
reproducible by importing `build` from `esbuild` and
`resolveBrowserShellBuild` from `./scripts/bundle-safe-bash.mjs`, calling
`build({ ...resolveBrowserShellBuild(process.cwd()), sourcemap: false })`, then
examining `metafile.inputs[*].imports` and `metafile.outputs[*].imports`.

## Exact change map

Paths below are relative to `packages/safe-bash/` unless qualified otherwise.

| Area | Existing portable implementation / smallest change |
| --- | --- |
| Paths | `browser/platform.mjs` already reexports `posixPath` from `poe-code/safe-fs/core`; use that export directly in `src/contracts/path.ts`, not a new path implementation. |
| Byte pipes and VFS | `src/contracts/io.ts` already implements byte-sized Web `TransformStream` pipes. Replace its Node stream-web import with the global constructor in the common graph. Keep canonical `safe-fs/core` identities; its `ByteSource`, `readBytes`, memory/readonly/mount/overlay implementations are portable. An independent in-memory browser bundle of `packages/safe-fs/src/core.ts` had zero externals. |
| Buffer | The existing platform injection bundles the pure `buffer` package. It does not require host `Buffer` injection. Retain it initially rather than rewriting every byte operation; include its transitive modules in final graph admission. |
| Scheduling | `src/contracts/yield.ts` already has `scheduleTurn`, `cancelTurn`, `yieldTurn`, and a global clock. Replace only Node defaults in `commands/timeout/scheduler.ts` with Web globals; retain its clock validation, chunked deadlines, retirement, injected scheduler and reason identities. Bind `performance.now` to `performance` and timer functions to `globalThis`; do not pass the performance receiver to unbound browser timers. |
| Random names | Replace the two crypto imports with Web `crypto.getRandomValues`: 16 bytes with UUID-v4 version/variant formatting for gzip staging; rejection-sampled base-62 for mktemp (accept byte values below 248). No `Math.random`, modulo bias, Node fallback, or new filesystem authority. Retain private modes, exclusive creation, collision attempts (gzip 16; metadata default 128), cancellation and metadata budget checks. |
| Regex | Reuse `commands/regex-execution/bounded-provider.ts` via its existing public factory. The provider/Node-factory worker owns this. No native-RegExp timeout fallback, broadened dialect, weakened ledger, or host-worker import in the common graph. |
| Checksums | Existing CRC implementation is pure; only `createHash` needs replacement. Keep parsing, manifest checking, filename handling and byte admission in `commands/bytes/checksums/index.ts`; use incremental pure hashes for all six non-CRC algorithms, not only the three named sum commands. |
| Compression | Add one bounded low-level codec driver in the byte/compression area; replace Node streams/pipeline in `stream.ts` with pull-based `ByteSource` composition and replace only raw inflation in `gunzip.ts`. Reuse the driver from `archive/stream.ts` with a separate archive gzip policy. Keep the command parsers and VFS transaction code. |

No product-owned pure MD5/SHA engine or DEFLATE codec was found in the inspected
safe-bash/safe-fs source. S3 hashing uses Node crypto and is not an alternative.
Host filesystem, Node interpreter/provider, native network transport and worker
modules remain explicitly opt-in; do not solve the graph by disabling commands
or enabling host capabilities. A root export that still reexports them is not a
portable default, even if a particular consumer happens to tree-shake them away.

## Hash/codec decision and tradeoffs

**Hashes:** `@noble/hashes` **2.4.0** already exists transitively in this checkout,
but safe-bash has no direct declaration for it. Its pure `sha2.js` exports cover
SHA-224/256/384/512; `legacy.js` covers SHA-1/MD5. Keep `.create().update(block)`
state per operand, convert `.digest()` to existing lowercase hex, and destroy
state in `finally`. An in-memory probe compared all six against Node crypto for
empty, `abc`, and 65,537 arbitrary bytes fed in 137-byte partitions: **18/18
matched**. A browser bundle of those six imports had **zero external imports**.
These are local vectors/link evidence, not actual-browser execution. [H1]

WebCrypto `subtle.digest` accepts a complete buffer rather than an incremental
stream; its standardized digest set does not supply MD5 or SHA-224. Replacing
the current loop with it would change memory behavior and drop algorithms. [W1]
Preserve CRC's length fold separately: POSIX `cksum` CRC is not gzip's CRC-32.
Tradeoff: reviewed pure hash code adds bundled/runtime dependency ownership;
transitive presence is not permission to depend on an undeclared package.

**Codec candidate:** primary sources for **pako 3.0.1** expose public `ZStream`,
`zlibInflateInit2/Inflate/InflateEnd`,
`zlibDeflateInit2/Deflate/DeflateEnd`, and gzip-header configuration. The public
low-level API exposes consumed input and caller-owned bounded output buffers;
use these rather than high-level synchronous `push` callbacks that cannot await
downstream pressure. No package is installed by this sidecar. [C1–C3]

This is the concrete implementation candidate, **not a validated replacement**.
The integration owner must approve dependency policy, pin/check the artifact and
licenses (MIT/Zlib), measure bundle/CPU costs, and pass the gates below. The
selected release's manifest exposes ESM, CJS and declarations and no runtime
dependency list. Prefer its public API over old-version deep imports. If adding
the dependency is rejected, a reviewed vendored codec with retained notices and
the same adapter/tests is substantial remaining work, not a free zero-dependency
solution. No native-host fallback or silent reduced preset is acceptable. [C1]

Native `CompressionStream` is insufficient: its constructor has no level option;
the standard's gzip decoder admits one member and rejects trailing input. That
does not implement the existing command's concatenation/force/warning semantics.
Raw decompression streams also do not expose the consumed-byte boundary needed
to recover the gzip footer and next member. [W2]

## Minimal bounded implementation contract

1. **Driver:** initialize raw inflate with window bits `-15`, and gzip deflate
   with window bits `31`, method 8, memLevel 8, default strategy and the parsed
   level (default 6). Feed at most 64 KiB at once; use caller-owned output slabs
   at most 64 KiB, or smaller archive `chunkSize`. Stop each step on input/output
   exhaustion or stream end. Yield owned bytes before reusing a slab. Use
   `next_in`/`avail_in` to return unconsumed footer/member bytes. Drain `Z_FINISH`
   until `Z_STREAM_END`; distinguish needs-input/output from malformed/truncated
   data and reject impossible no-progress loops. [C2–C3]
2. **Pressure and work:** one active input slice and output slab plus fixed codec
   state; never collect a member/archive or queue all callback outputs. Await
   downstream consumption before further output production/input pulls. Check
   abort and yield an actual event-loop turn between bounded codec work slices,
   including input-consuming/no-output steps, headers, and empty-chunk floods.
   Slab sizes bound individual calls, not total CPU; validate cancellation with
   high-compression data and level 9. Retain all shell/work/output budgets.
3. **CLI gzip:** preserve the existing `gunzipMembers` header parser, FHCRC,
   per-member CRC-32, ISIZE modulo 2^32, concatenated-member loop and unread-tail
   restoration. Keep flags `-c/-d/-k/-f/-t/-1..-9/-n`, aliases, last-level-wins,
   operand order, suffixes and unsupported-option diagnostics. Encoding has zero
   MTIME, no name and OS=255. `-t` must fully decode/check, not just skip output.
   Preserve forced raw passthrough; ordinary trailing garbage warns/exits 2,
   all-zero padding is accepted, truncated/invalid data fails. Do not retract
   already-streamed stdout on a late footer error.
4. **Archive is a distinct gzip policy:** `archive/stream.ts` currently uses Node
   `createGunzip`, not CLI `gunzipMembers`. An in-memory native-stream probe
   accepted concatenated gzip members and zero-prefixed trailing garbage, but
   nonzero garbage failed with `Z_DATA_ERROR`; a single nonzero trailing byte or
   truncated next header failed with `Z_BUF_ERROR`. Preserve/fixture these
   differences rather than inheriting CLI warnings or force passthrough. Reuse
   low-level gzip decoding/member reset with that policy. Keep tar's independent
   prohibition on nonzero trailing tar data/concatenated tar archives, 512-byte
   records, pax handling, paths/links and extraction rules. Pin observed gzip
   header behavior separately; do not accidentally apply CLI normalization.
5. **Budgets:** checksums retain default cumulative 32 MiB admission, 64 KiB hash
   blocks/manifest lines, 16 KiB filenames and existing length guard. Compression
   retains 64 KiB streaming and 256 MiB **file-staging output** cap; that cap is
   not a new stdout/input cap. Tar retains independent compressed/decompressed
   `maxArchiveBytes` (256 MiB), entry 64 MiB, total 256 MiB, 10,000 members,
   paths 4096 bytes, depth 128, pax/files-from/text 1 MiB, arguments 64 KiB,
   diagnostics 4096 bytes, 10,000,000 pattern steps, buffered file 1 MiB, and
   configured chunkSize 512..1,048,576 (default 64 KiB). Check projected output
   before yielding/writing it, not after accumulating an oversized result.
6. **Cancellation/cleanup:** reuse canonical `readBytes`/`writeBytes` and their
   abortable next/write/return behavior. Preserve the exact parent abort reason,
   first operational failure and existing public diagnostic mapping. Always end
   codec state, detach listeners, return input, observe late rejections, and
   settle the consumer before VFS stage cleanup. A consumer returning before
   complete output remains an error. Never close the caller's stdout. Keep
   exclusive private staging, identity/metadata revalidation, commit-before-input
   deletion and cleanup safety; cancellation must not finalize partial files.

## TDD and exact acceptance gates (integration owner)

Do not mark any following gate passed based on this sidecar. Add failing tests
before each product change. Unit fixtures use memfs/in-memory byte sources, not
disk or LLMs. No new regression file was agreed or added here.

- **Graph RED→GREEN:** a narrowly named browser-default graph test must traverse
  all reachable output chunks from the ordinary public entry and `/portable`,
  resolving the real public export conditions and canonical safe-fs dependency.
  Reject Node externals, Node host integration inputs and unresolved runtime
  imports; do not allowlist them or supply `require`. Inspect actual output
  imports, not just source text or bundle success. Preserve shared identity tests.
- **Hashes:** extend the maintained `tests/commands/bytes/checksums/` cases for all
  six algorithms and CRC, empty/arbitrary/sliced/multiblock input, manifests and
  flags, limit−1/limit/limit+1, giant/empty chunks, blocked input/output and late
  cleanup failure. Compare exact digest/output/status and VFS effects; keep
  existing per-block yield behavior and no next-file opening before sink drain.
- **Codecs:** extend `tests/commands/bytes/compression/{behavior,streaming,safety}.test.ts`
  and `tests/commands/archive/{core,lifecycle,boundaries,native}.test.ts`. Test
  every existing level/alias, deterministic header fields, last-level-wins and
  encoded reference compatibility, not merely self-roundtrip. Decode static
  concatenated members across every byte boundary, including footer and header
  splits; corrupt FHCRC/CRC/ISIZE; truncate headers/blocks/footers; test both
  trailing-data policies, force passthrough, test-only mode, archive pax/links,
  binary `tar | gzip | gunzip | tar`, and all existing safety assertions.
- **Bounds/cleanup:** tiny configurable limits and fixed fixtures exercise exact
  boundaries without allocating 256 MiB. Count pulls, live slab bytes and cleanup
  calls under blocked sinks/next/return, early `head`, sink rejection and pre/mid
  abort. Prove output before EOF, no expansion-sized allocation/read-ahead,
  original abort identity, no unhandled rejection, stage removal/input retention,
  and no leaked codec/timer/listener. Retain existing timeout/regex ownership and
  limit tests; the browser graph must not introduce separate relaxed limits.
- **Runtime, separately required:** installed public artifacts must run in an
  actual browser, workerd without `nodejs_compat`, Node and Bun. Use ordinary root
  import and `agentCommands()` with no injected provider; also test explicit
  provider override and `/portable`. The independent expected inventory in the
  existing bundle test is exactly **79 names**. Require registry set equality
  and one meaningful execution case for **each** name, not help/count-only;
  record per-case output bytes, stderr, expected status and VFS effects. Expected
  nonzero commands such as `false` are not failures of the harness.
- **Cross-entry runtime:** execute `env jq -nc '1+1'`,
  `printf '"1+1"' | xargs jq -nc`, `env env jq -nc '1+1'`, and
  `printf '"1+1"' | xargs env jq -nc` using mixed public entries; each yields
  `2\n`, empty stderr and status 0. Check shared argument/error identities and
  disposal too. The browser runner must not inject Node Buffer/process/require,
  worker_threads, crypto/zlib/stream shims or host execution. Bundled pure buffer
  and explicitly packaged pure codecs are allowed; browser Web APIs are real.
- **Browser evidence:** record browser/runtime versions, artifact identity,
  console/import errors, per-name case results and a screenshot of the actual
  result page. Keep worker/Node/Bun results separate. Browser bundling and Node VM
  execution never substitute for this gate. Root coordinates maintained scoped
  checks and any eventual broader integration checks; none ran here.

## Primary dependency references

Inspected 2026-09-08; versions below are explicit inspected candidates, not a
claim to have established the latest available or security-approved release.

- [H1] `https://raw.githubusercontent.com/paulmillr/noble-hashes/2.4.0/README.md`;
  `https://raw.githubusercontent.com/paulmillr/noble-hashes/2.4.0/src/sha2.ts`;
  installed `node_modules/@noble/hashes/{package.json,legacy.js,_md.js,utils.js}`.
- [W1] `https://w3c.github.io/webcrypto/` — digest interface/algorithm table and
  `getRandomValues`; do not substitute whole-input hashing for the streaming API.
- [W2] `https://compression.spec.whatwg.org/` — constructor and gzip format rules.
- [C1] `https://raw.githubusercontent.com/nodeca/pako/3.0.1/package.json`;
  `https://raw.githubusercontent.com/nodeca/pako/3.0.1/src/index.ts`.
- [C2] `https://raw.githubusercontent.com/nodeca/pako/3.0.1/src/zlib/inflate.mjs`;
  `https://raw.githubusercontent.com/nodeca/pako/3.0.1/src/zlib/zstream.mjs`.
- [C3] `https://raw.githubusercontent.com/nodeca/pako/3.0.1/src/zlib/deflate.mjs`;
  `https://raw.githubusercontent.com/nodeca/pako/3.0.1/src/zlib.mjs`.
