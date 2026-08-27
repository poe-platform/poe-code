# Initial checkpoint: three proven retention failures

**20 rows: 17 pass, 3 fail; zero skipped/cancelled/TODO. No production changes.**
Strict unhandled rejections. Node 22.22.2, Darwin arm64, tsx 4.23.12,
TypeScript 5.9.3. No native oracle or external service was needed.

## Contract and root cause

Contracts were inspected before execution; see README for exact ownership
basis and allowed mutation schedule. ByteSource does not promise permanent
storage ownership to a consumer. Existing contract tests exercise producer
reuse; readonly documentation separately promises copies to read consumers.
No mutation occurs while a consumer is entitled to borrow the original chunk.

| Row | Surface and root cause | Expected hex | Actual hex |
| --- | --- | --- | --- |
| 02 | Internal shared `collect`, `src/commands/internal.ts:158` | 00ffc3a9410a | 000000000000 |
| 04 | Public `tail -n 1 /input`, shared `lines`, `src/commands/internal.ts:182` | 00ffc3a9410a | a9410aa9410a |
| 06 | Public `tail -c 4 /input`, command-owned queue, `src/commands/streams.ts:43` | c3a9410a | 00000000 |

Both public commands return status **0** and empty stderr despite corruption.
The internal helper resolves normally; it has no command status. Tests fail
strict byte assertions and the test process exits 1. Named commands only read
the seeded input; they have no output-file operation. The separately checked
tee pipeline creates `/out` with exact original bytes and emits expected base64.

Shared lines retains a partial `Buffer.slice(start)` across the next read.
The first 00ffc3 window becomes a9410a before concatenation, adding an unintended
newline too. Full collector and byte-tail retain aliases through generator
finally, which zeroes the producer's storage after its final read. Uint8Array
controls pass. The public stdin cursor and readonly wrapper also convert the
same borrowed Buffer source to owned bytes and make the relevant tail rows pass.
This is not a universal command, runtime, or FS defect.

## Minimal proposed ownership assignments

- Shared-helper owner: **`src/commands/internal.ts` only**. At line 158 retain
  `new Uint8Array(chunk)`; at line 182 retain
  `new Uint8Array(chunk.subarray(start))`. Preserve existing byte-limit,
  cancellation, delimiter, and error behavior. The completed same-turn fragment
  at line 172 is consumed by concatenate before advancing the source and does
  not require an extra defensive copy for this proof.
- Separate command-owner assignment required: **`src/commands/streams.ts` only**,
  line 43 should own retained queue bytes via `new Uint8Array(chunk)`. Once that
  queue owns plain Uint8Arrays, its later `first.slice(consume)` is not the source
  borrowing defect. Do not rewrite queues or copy every transient chunk.
- **No edits** to accepted `src/commands/text.ts`, FS, runtime, contracts,
  root exports/config, dependencies or existing tests are proposed or made.
  Root must assign exact production paths. A different verifier is required
  after any authorized fix; this leaf has not tested a patched candidate.

## Controls and limits

Passes include contract collectBytes; Uint8Array shared collect/lines/byte-tail;
public Buffer stdin; awaited stdout write reuse and external acceptance;
backpressured byte pipe; public named cat and early head finally; cat/tee/base64
pipeline plus file bytes; readonly named tail; Memory write/read/stream copies;
readonly returned-byte alias isolation; MockS3-backed read/write/stream copies;
EFBIG/sink-error identity and finalization; public cancellation at a controlled
sink barrier. Handshakes establish order; 15-second timers are watchdogs only.

No runtime failure: `src/shell/input.ts:44` owns incoming bytes;
`src/shell/runtime.ts:120` owns captured writes. These remain Sagan-owned.
No Memory/S3Mock/readonly alias failure: retained backing data and readonly
return values are copied at the exercised boundaries. FS remains Poincare-owned.
WebDAV was inspected, not dynamically certified: `bodyChunks` at
`src/fs/webdav/webdav.ts:388` creates plain Uint8Array before readStream slices
at line 639, so that slice is not evidence of a Buffer alias defect.
No deployed-provider, arbitrary-host sandbox, general superiority, performance,
72-hour duration or current full-suite claim. jq/rg/tar, regex stress, broader
corpora, concurrent arbitrary mutation and deployed services are unmeasured.

## Frozen evidence and commands

- `1fe4988`: original expectations, source hashes and repro fixtures committed
  before product runs. `scaffold-source-before.json` and scaffold-typecheck.txt
  preserve an earlier compile-only fixture mistake, not a product failure.
- The first public attempt missed `/input` stat/access setup. Its raw transcript
  is preserved as `evidence/fixture-prerequisite-failure.tap`. The correction is
  explicit in fixture-correction.md; no assertion or expected byte was relaxed.
- `e312860`: committed corrected fixture and original helper failure before
  corrected public execution. Frozen product head is
  `a31b7c36eef00c41763875c863a559594049f13f`. All **212 product files** match the
  earlier source freeze (`044aaaca...`). Global HEAD advanced through unrelated
  workers; tracked source was clean at both freezes, and unrelated untracked/
  staged paths were preserved rather than included in this leaf's commits.
- 222 source/fixture hashes were checked before and after the matrix. Exact
  hashes are in source-public-before.json. Imports use inspected source through
  existing tsx, not shared dist; no build emits were produced.
- `evidence/shared-collect-failure.tap` preserves the first genuine failure;
  `evidence/public-lines-failure.tap` the first corrected public failure;
  `evidence/matrix.tap` the full 20-row transcript; `evidence/results.json`
  records exact command, bytes, events, versions, categories and denominator.

```sh
node_modules/.bin/tsc -p tests/stress/byte-ownership-20260827/tsconfig.json
node --unhandled-rejections=strict --import ./tests/stress/byte-ownership-20260827/binding.mjs --import tsx --test --test-concurrency=1 --test-reporter=tap tests/stress/byte-ownership-20260827/ownership.test.ts
node tests/stress/byte-ownership-20260827/binding.mjs
```

Scoped typecheck exits 0. Matrix exits 1 as preserved failures require; binding
verification exits 0. Add `--test-name-pattern='^04 '` before the filename for
the public line repro (1 tested/1 failed); `'^06 '` selects byte-tail, and
`'^02 '` is explicitly internal helper attribution. Frozen helper TAP was
captured before fixture seeding, with unchanged helper source and byte schedule.

All launched test/compiler commands returned. Every Shell is disposed in test
cleanup; the byte pipe is closed/aborted, generators finalize, the sink barrier
is released, and no audit test subprocess remains. No service/server/worker
was requested by these cases; task-owned transient transcripts remain under
ignored `.work/`, with their raw evidence promoted to tracked text. This is an
initial investigation checkpoint awaiting root assignment, not a source fix.
