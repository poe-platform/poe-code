# Byte ownership initial frozen cohort

Leaf ownership: this directory only. No production, existing test, root config,
dependency or dist writes. No delegation, regex workload, external service,
user file, native oracle, arbitrary concurrent mutation or security claim.

## Authority and schedule frozen before executions

- `src/contracts/io.ts`: ByteSource is AsyncIterable<Uint8Array>; ByteSink.write
  returns Promise<void>. Its readBytes forwards chunks, pipeBytes awaits writes,
  collectBytes and createBytePipe own retained chunks using new Uint8Array.
- There is no separate io.md or explicit prose lease duration in those type
  declarations. The established executable contract is
  `tests/contracts/io.test.ts`, especially the reused-buffer collector test and
  sink-acceptance-before-next-chunk test. AGENTS requires chunk ownership and
  awaited sink writes. This cohort uses the user's explicitly allowed next-read,
  generator-finally, and post-write-completion schedule, not a stronger invented
  concurrent-mutation obligation.
- `src/contracts/filesystem.ts` uses the same ByteSource for **readStream** (the
  actual method name, not readFileStream) and Uint8Array for readFile/writeFile.
  `src/fs/readonly/README.md` Read delegation and ownership explicitly promises
  fresh Uint8Array copies for readFile and readStream, including Buffer/reuse.
- `7ba5301d43345c2eb621b7df95a452a87b74e909` adds a sort-only collector that
  copies retained partial Buffer windows and complete standalone records.
  It does not replace shared internal.collect/lines or byte-tail retention.
- Node primary docs inspected 2026-08-27: `https://nodejs.org/api/buffer.html`
  (Buffers and TypedArrays, buf.slice): Buffer.slice aliases storage whereas
  TypedArray.slice copies. Contracts above, not external docs, control findings.

Independent literals in expectations.ts encode 00 ff c3 a9 41 0a, a split UTF-8
é followed by A/newline with NUL/ff binary prefix. The borrowed stream presents
two three-byte views at relative offset 4 in sentinel-guarded storage. It only
overwrites after the consumer requests next(), then zeroes in finally after EOF
or return(). Early head finalization must produce the prefix before zeroing.
The output producer only reuses storage after each awaited write completes.
Readonly consumers mutate only already-returned, contractually copied bytes.
No walltime races: event vectors and explicit promises establish causality;
15-second per-test limits are cleanup watchdogs, not scheduling assumptions.

## Binding and commands

Run from repository root. Tooling is existing local tsx/TypeScript; imports
resolve the inspected source, not potentially stale shared dist. Hashes cover
all tracked src files (including public index) and exact fixtures/tool configs.

```sh
node tests/stress/byte-ownership-20260827/binding.mjs --freeze
node_modules/.bin/tsc -p tests/stress/byte-ownership-20260827/tsconfig.json
node --unhandled-rejections=strict --import ./tests/stress/byte-ownership-20260827/binding.mjs --import tsx --test --test-concurrency=1 --test-reporter=tap tests/stress/byte-ownership-20260827/ownership.test.ts
node tests/stress/byte-ownership-20260827/binding.mjs
```

Freeze only once for this candidate; do not rebaseline a source change. The
binding intentionally refuses changed source or fixtures. Future candidates
need separate manifests/evidence retaining the original failure. Source/tests
stay canonical TypeScript, raw transcripts are explicit evidence text, and
task-owned transient captures live in .work/ only. No test-discovery waiver.

Twenty rows isolate contract collection, shared collection, named-VFS lines and
byte-tail, public stdin/capture/pipes, cat/head/tee/base64, Memory, readonly and
S3Mock. WebDAV's bodyChunks copy and readStream slice are inspected only; no
deployed adapter claim. jq/rg/tar and larger corpora are not needed initially.
Results, counts, exact observed bytes and limitations are recorded in REPORT.md
and evidence/results.json. Current binding uses source-public-before.json;
source-before.json preserves the original pre-seeding fixture, and
scaffold-source-before.json preserves the initial compile-only scaffold.
