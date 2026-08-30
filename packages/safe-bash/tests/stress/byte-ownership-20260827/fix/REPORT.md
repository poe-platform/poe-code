# Minimal retained-byte ownership candidate — 2026-08-27

## Scope and source freeze

Code + canonical tests commit: `7a517cecab21d9fbff204df01a6a2ad2712a7673`.
Exactly three production substitutions were authorized and made:

- `src/commands/internal.ts`: collect retains `new Uint8Array(chunk)`.
- `src/commands/internal.ts`: unfinished lines retain
  `new Uint8Array(chunk.subarray(start))`.
- `src/commands/streams.ts`: tail's retained queue uses `new Uint8Array(chunk)`.

Completed transient line fragments retain their existing `.slice(start, offset)`
behavior: Buffer views are concatenated before the next source read. No extra
copy was inserted there. No FS/runtime/root/config/dependency/text/regex source
changes were made. The byte-tail source transfer was explicit. The source and
canonical tests are frozen after the code commit for separate packed verification.

`authorization.json` preserves the root's AUTHORIZED marker and the exact
pre-edit source hashes. Root confirmed the independent holdout freeze before
authorization. No independent test, expectation, or evidence contents were read.
The author announced exactly `tests/commands/internal.test.ts` (new) and
`tests/commands/streams.test.ts` (existing) before editing either canonical path.

SHA-256 before / after:

| File | Before | Candidate |
| --- | --- | --- |
| `src/commands/internal.ts` | `28d83d91d5086b39b50494ea1130d34c3b48b22a15dc04c2912ee2503a7536d5` | `ade20c95a7d3dac5250a214d112ab25d710ce7909a4c6605f18ee21781949654` |
| `src/commands/streams.ts` | `8966dd770c11731e5256a1e42aaec4b07ae7f0508a3e89a3efc956d27109098d` | `06bff98731e9244f502589de6f81c5dec9737c70a3eb285ebf90bf2a3dd93a9d` |

## Contract basis and legal mutation schedule

`ByteSource = AsyncIterable<Uint8Array>` and `ByteSink.write` declarations in
`src/contracts/io.ts` do **not** explicitly spell out a byte lease duration.
The relevant executable conventions are `collectBytes` and `createBytePipe`
copying retained bytes, `pipeBytes` awaiting sink writes, and the reused-buffer
collector and sink-acceptance cases in `tests/contracts/io.test.ts`. AGENTS also
requires chunk ownership and awaited writes. The user explicitly authorized the
next-read, generator-finalizer, and write-completion reuse schedules under test.
The actual optional filesystem method is `FileSystem.readStream`.

These fixes preserve bytes under those schedules. They do not promise protection
against arbitrary concurrent host mutation during consumption, make host JS a
sandbox, or change cancellation into rollback. Named VFS streams exercise the
retained sites without relying on Shell's already-copying stdin cursor.

## Preserved history and qualification

The original audit remains **17/20 passing, 3 failing**. The shared collect
Buffer result was all zeros; public `tail -n 1 /input` duplicated the last chunk
with status 0; public `tail -c 4 /input` returned zeros with status 0. Those
fixtures, expected bytes, manifests, reports, raw transcripts, and failures were
not changed or rebaselined. The original manifest still rejects changed source;
the expected exit 1 is preserved in `evidence/original-manifest-rejects.txt`.

The candidate replay invokes the **exact unchanged original**
`../ownership.test.ts` and `../expectations.ts`, using new `binding.mjs` and
`candidate-source.json`. Their SHA-256 values remain:

- Original tests: `36ff384d758c7d9291c9aa5db6c90a59b8b0230aa194b560d63c814f29f10d6f`.
- Original expectations: `38e0f8c766cbd336ed8040b27baefed5540390a91de4719d5da9f1cb4494cd03`.

All 222 original frozen source/fixture hashes matched before production edits.
Candidate binding verifies 242 hashes, including original artifacts, tracked
product sources, canonical regressions, and author runner/config bindings.
Run records check hashes before and after execution. This is a scoped source
binding, not certification of every repository TS fixture or a current full gate.
The shared worktree contains unrelated concurrent edits; they were not included
in this leaf's commits. Per-run HEAD/status/index snapshots retain that context.

## Checks

| Run | Result | Evidence |
| --- | --- | --- |
| Initial new author fixtures, before source edits | 15/24; six ownership failures, three diagnostic fixture mistakes | `evidence/canonical-initial.txt` |
| Corrected final author fixtures, before source edits | 20/27; seven borrowed-Buffer failures | `evidence/canonical-before.txt` |
| Same final canonical tests, candidate | **27/27**, no skip/TODO/cancel | `evidence/canonical.txt` |
| Relevant existing suites | **46/46**, no skip/TODO/cancel | `evidence/existing.txt` |
| Exact unchanged original20, candidate | **20/20**, no skip/TODO/cancel | `evidence/original20.txt` |
| Scoped TypeScript check before and after source edits | exit 0 both | `evidence/typecheck.txt`, `evidence/typecheck-candidate.txt` |
| Bounded equivalent-work observations | exit 0, all compared output bytes exact | `evidence/observations.txt` |

`fixture-correction.md` discloses the author's initial missing `EFBIG: ` prefixes
and the unchanged helper sink's Buffer alias caveat. No broad diagnostic
assertion was substituted for an exact comparison. Relevant existing suites are
`tests/contracts/io.test.ts`, `tests/shell/streaming.test.ts`,
`tests/commands/text.test.ts`, and `tests/commands/stream-format/rev.test.ts`.
The existing rev suite includes 17 Apple `/usr/bin/rev` comparisons, not a
GNU/Linux oracle. It was available; binary SHA-256, OS build, a byte-exact probe,
and supplemental hashes of unchanged adjacent tests/helpers are recorded in
`final-verification.json`. Failure diagnostics retain the existing helper's
status/nonempty-stderr policy; this patch does not redefine that native cohort.

Canonical additions cover nonzero offsets, empty views, next-read storage reuse,
finalizer overwrite, native Uint8Array controls, binary/UTF-8 bytes, empty and
unterminated lines, custom NUL separators, unchanged input/sentinels, source
error identity, collection/line/tail byte limits, and public head omission
accept/reject/cancel handshakes. The abort reason is errno-shaped and must remain
the exact original object. The line limit is checked at its exact 32 MiB boundary
and one byte over; collect uses an exact small limit; tail exercises overflow.

## Bounded copying and performance — including an adverse result

The three new retained constructors copy each retained input fragment once.
There is no new accumulated-prefix concatenation or whole-input materialization
in tail. For collect, one final concatenate copies the collected bytes once more;
for lines, concatenation happens once per yielded record. Completed Buffer line
fragments remain views until that concatenate. Existing native completed-fragment
slice behavior is unchanged.

Constructor instrumentation on immutable Buffer controls, outside timed runs:

| Input bytes, 1024-byte chunks | Collect retained bytes | Line unfinished bytes | Tail retained bytes |
| --- | --- | --- | --- |
| 65,536 | 65,536 | 64,512 | 65,536 |
| 262,144 | 262,144 | 261,120 | 262,144 |
| 1,048,576 | 1,048,576 | 1,047,552 | 1,048,576 |

The final line chunk contains the terminating newline, so its completed fragment
is not additionally owned before concatenation. Numeric allocation observations
show one result allocation for collect and one for the single line, not repeated
growing-prefix concatenations. These counts establish linear **retained-site**
copying; they do not establish a universal bound for the whole tail algorithm.

**Adverse ragged-tail result:** the unchanged `first.slice(consume)` operation
recopies the remaining first retained chunk. A 65,536-byte first chunk followed
by 256 one-byte chunks, retaining 65,536 bytes, copies **16,744,320 additional
trim bytes**. That cost occurs for both baseline and candidate native Uint8Array.
The candidate now also incurs it for Buffer input because the retained chunk is
plain Uint8Array; the byte-correct immutable Buffer baseline used aliasing views
and incurred no trim copy. Candidate retained constructors still copy only the
65,792 input bytes. Thus no global linear-tail or absence-of-quadratic-slicing
claim is justified; a broader queue optimization needs a separate authorization.
No source change beyond the three authorized sites was made to conceal this.

The ragged immutable Buffer paired median is 0.562 ms baseline / 1.119 ms
candidate; native owned control is 1.369 / 1.397 ms. These are bounded observations,
not performance guarantees. The existing byte limits and check placement are
unchanged: they bound retained payload size, not source chunk size, transient
pre-check allocations, or metadata for arbitrarily many empty/tiny chunks.
No universal memory-bound or unbounded-input materialization guarantee is made.

Timing cohorts use owned Uint8Array, reused native Uint8Array, and immutable Buffer
controls; **buggy borrowed Buffer output is never a performance-win comparator**.
Three sizes, three sites, three controls yield 27 representative cohorts, with
six paired repetitions and alternating implementation order after warmup; two
additional ragged controls retain the adverse result. All 348 timed outputs are
byte-checked, alongside warmup/instrumented outputs. Exact input/output hashes,
orders, raw timings, process memory snapshots, and source hashes are retained.
Memory snapshots include compiler/loader and both implementations; they are not
per-candidate or peak-memory measurements. Host load averaged approximately 3.81,
6.77, 5.84 over 1/5/15 minutes. Other workers share this host.

Node v22.22.2, darwin/arm64, tsx 4.23.12, TypeScript 5.9.3. Baseline code is taken
from exact hash-checked git blobs at `eb78897cb276e29637ebae30c10aa0e448e31bc6`,
transpiled in memory with only import bindings changed. Candidate code is loaded
directly via tsx. No shared dist or root config is emitted/modified. Recorded
pre-edit snapshot: 2026-08-27T10:05:15.652Z; timing observation interval:
2026-08-27T10:11:52.039Z–2026-08-27T10:11:54.183Z. These timestamps do not imply
72 hours of work, broad superiority, a full build, or deployed-provider coverage.

## Reproduction and handoff

From the repository root:

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/commands/internal.test.ts tests/commands/streams.test.ts
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/contracts/io.test.ts tests/shell/streaming.test.ts tests/commands/text.test.ts tests/commands/stream-format/rev.test.ts
node_modules/.bin/tsc -p tests/stress/byte-ownership-20260827/fix/tsconfig.json
node --unhandled-rejections=strict --import ./tests/stress/byte-ownership-20260827/fix/binding.mjs --import tsx --test --test-concurrency=1 --test-reporter=tap tests/stress/byte-ownership-20260827/ownership.test.ts
node tests/stress/byte-ownership-20260827/fix/binding.mjs
node --unhandled-rejections=strict --expose-gc --import tsx tests/stress/byte-ownership-20260827/fix/observations.mjs
```

`record.mjs` is a write-once recorder: it refuses existing evidence destinations.
The direct commands above replay without overwriting recorded evidence. All
canonical TS stays in its adjacent canonical test paths; raw audit evidence is
JSON/text, and there are no copied oracle TS files to exclude from discovery.
Production/canonical diff checks pass. The staged evidence-wide whitespace check
returns 2 solely for Node TAP assertion-diff spacer lines in the two preserved
pre-fix transcripts; `evidence/whitespace-check.json` records every warning. Raw
transcripts are not normalized, and no repository formatting rule is changed.

All author test/compiler/benchmark processes returned; no server, service, or
background worker was started. Public Shell instances dispose through test
cleanup; source finalizers and sink barriers are asserted/released. Existing
unrelated native scratch artifacts remain untouched. Independent moved/packed
public-module verification is a different leaf's responsibility and is not
claimed by this author report. The evidence commit and final owned-path status
are supplied in `/tmp/byte-helper-author-ready.txt` after the separate commit.
