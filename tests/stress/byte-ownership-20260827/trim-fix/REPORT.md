# Bounded byte-tail trim correction — 2026-08-27

## Frozen scope and handoff

Code + canonical tests commit: `7d7dce7ced596b24e60e1ab3fea5bcd50c070755`.
Only the byte-mode queue in `src/commands/streams.ts` and additions in
`tests/commands/streams.test.ts` changed. The source diff adds six lines net.
`internal.ts`, line-queue behavior, completed transient line fragments, public
APIs, filesystem/runtime/text/regex code, root configuration and dependencies
are unchanged. New author evidence lives only in this `trim-fix/` directory.

The prior author was closed and ownership was explicitly transferred by the
user. The separate verifier froze undisclosed holdouts at
`b1c823af09c1cc4bf9a13225ef0ae9c170d22d80` before this correction. Neither
`independent/**` contents nor verifier vectors were read. The source-ready marker
was written at **2026-08-27T10:23:09.482Z**, immediately after the code commit,
scoped checks and unchanged-original replay. No source/canonical edits followed.
The separate verifier can run while this evidence is completed; its actual
offline npm-pack, moved-package, frozen30 and extra holdout results are not
claimed here. The evidence commit is recorded in the final ready marker.

| Frozen file | SHA-256 |
| --- | --- |
| `src/commands/streams.ts` | `be601a62f51a95c62778987118e292aea6637ca4e7271486239af2f8d65e7d1c` |
| `tests/commands/streams.test.ts` | `119a53e868f896bf4ab42785d79fe02348e92de68ca7859a284446f596e3bfff` |
| unchanged `src/commands/internal.ts` | `ade20c95a7d3dac5250a214d112ab25d710ce7909a4c6605f18ee21781949654` |
| unchanged `tests/commands/internal.test.ts` | `406be07ceb7a76b792737e14aa6e8d1dcf26c0589f111b8061c60fab18877840` |

## Defect and smallest correction

The prior ownership candidate `7a517cecab21d9fbff204df01a6a2ad2712a7673`
correctly copied retained inputs, but `first.slice(consume)` repeatedly copied
the surviving owned prefix-slot remainder. The recorded 65,536-byte first chunk
plus 256 one-byte chunks, retaining 65,536 bytes, copied **16,744,320 trim bytes**
for 65,792 input bytes. That was a blocker, not an acceptable caveat. The previous
`fix/` report, observations and source identity remain intact.

The correction retains a subview of the already-owned first chunk until its
remaining length is at most half its backing allocation; it then copies that
remainder into an exact-sized owned allocation. Fully consumed byte slots are
deleted immediately, before advancing to the next slot. Empty byte chunks are
ignored after the existing abort check. The existing `start > 1024` array
compaction and post-trim `bufferLimit` check remain in their original positions.
This does not install a ring buffer, change capacities, silently cap counts,
restructure line processing, or add any public/internal API.

### Exact resource argument

Let `I` be total nonempty incoming bytes and `L` one incoming chunk's length.
Its initial owned copy costs `L`. Partial trimming either creates a view with
no byte copy, or copies at most half the current backing. Subsequent copies
from that lineage cost at most `L/2 + L/4 + ... < L`. Summed across chunks,
queue-owned byte copying is at most `2I`, independent of the number or raggedness
of later trims. A single incoming chunk can cause at most one partial trim;
earlier slots in that iteration are fully consumed. Thus there are at most two
owned byte allocations per nonempty input chunk. View-object allocation is not
a backing-byte copy; this is not a bound on all JavaScript allocations.

At a successful post-trim/source-resumption checkpoint, every reachable live
queue entry has backing length at most twice its live length: freshly owned and
compacted entries are exact-sized, and noncompacted views retain more than half
their backing. Distinct queue entries never share one owned lineage. Consumed
slots have no value/reference, and empty byte chunks add no entry. Therefore
queue-reachable backing is at most `2 * size`, hence at most
`2 * min(count, bufferLimit)` after a successful limit check, and zero for a
zero-byte tail. This is a reachability bound, not a promise of immediate GC.
It specifically covers oversized chunks trimmed down to tiny requested tails
and fully consumed large slots before the 1024-slot array compaction.

The unchanged metadata compaction is separate: after a completed iteration,
there are at most 1024 consumed holes plus at most one entry per retained byte.
Array compaction still copies references and is not claimed to provide a new
global linear-time shell algorithm. During acquisition/trimming, the original
source chunk, its owned copy and a transient compaction allocation can coexist;
the prior implementation already materialized entire input chunks before its
post-trim limit check. No count-only peak-RSS or source-chunk-size bound is
claimed. A sink or source retaining its own references is outside queue ownership.

Omission output is still awaited before deleting/replacing the corresponding
slot. No compaction mutates old backing, borrowed input, or accepted output.
Cancellation, sink rejection, finalization, prefix early-return behavior, limit
value, check placement and exact existing diagnostics remain unchanged.

## Regressions first, preserved denominators

Twelve canonical controls were added **before the source patch**. With the
previous candidate source and these exact additions, 27 existing tests passed
and all 12 new tests failed (`canonical-before.tap`). The first ragged control
copied 136,515 bytes for 1,055 input bytes; the zero-tail/empty control retained
49,260 bytes and 2,058 slots. Neither failure was rebaselined.

The independent-from-verifier author vectors use counts 521/2081/8329, a first
count-sized chunk followed by count+13 singleton chunks, both immutable and
next-read-reused Buffer/native Uint8Array, and both tail and head omission.
The separate retention controls use counts 0/1/37, oversized 24,577-byte chunks,
47/59-byte chunks, and 2,051 intervening empty chunks. Every case checks exact
bytes, finalization and no input mutation. Copy/allocation and backing/slot
envelopes are deterministic, not timings or GC thresholds.

The test-only observation temporarily wraps Uint8Array construction/slicing and
Array.push, recognizes the owned queue, and inspects all its array slots at
source resumption. It observes unique backing buffers, including consumed slots
if still referenced. It does not insert a product hook, export a queue, alter
expected bytes, or rely on WeakRef collection timing. Globals are restored in
`finally`. Its traversal overhead is excluded from timing observations and is
not presented as product throughput.

| Check | Result | Evidence |
| --- | --- | --- |
| Prior source, canonical27 plus new12 | 27 pass / 12 fail | `canonical-before.tap` |
| Corrected source, canonical27 plus new12 | **39/39** | `canonical-after.tap` |
| Original unchanged ownership cohort | **20/20** | `original20.txt` |
| Focused existing io/shell/text/rev suites | **46/46** | `adjacent.tap` |
| Existing scoped TypeScript noEmit config | exit 0 | empty `typecheck.txt`, `final-verification.json` |
| Original source binding against correction | expected exit 1 | `original-binding-rejects.txt` |
| Prior candidate source binding against correction | expected exit 1 | `previous-binding-rejects.txt` |

The canonical set retains existing exact EFBIG/finalizer, empty-window,
borrowed-view, await-sink accept/cancel/reject, and early-return controls. The
focused existing46 and unchanged20 preserve their own scopes and denominators;
these are not a whole-repository gate.

At freeze, new `binding.mjs` authenticated **267** source/config/fixture/evidence
hashes using `candidate-source.json`. It preserves all prior binding entries
except the two explicitly changed source/test paths, and additionally checks
all **29** frozen `fix/` artifacts byte-for-byte against evidence commit
`b32b336465962cd169d52583ec5d45bdc570a840`. Original test and expectation hashes
remain respectively `36ff384d758c7d9291c9aa5db6c90a59b8b0230aa194b560d63c814f29f10d6f`
and `38e0f8c766cbd336ed8040b27baefed5540390a91de4719d5da9f1cb4494cd03`.
The historical initial **17/20** failures and prior corrected **20/20** replay
remain preserved. The new binding never rewrites the old manifests or fixtures.

At **2026-08-27T10:27:58.698Z**, final shared-checkout verification detected
concurrent integration commit `1ad428edb7bce7d30f081c0e9bd4332eb280c677` changing
`package.json`, `src/index.ts` and `src/plugins/index.ts`. `concurrent-drift.json`
preserves all three old/new hashes. The full frozen binding now correctly rejects
that different candidate. All four owned/read-only source and canonical hashes
still match, and their working scope is clean. Nothing was restored, rebased,
rebound or edited to conceal this external change. The results here qualify the
frozen code candidate and preceding source snapshot, **not** the later integrated
package. Current combined-package requalification belongs to the root integration
owner/verifier and remains outstanding in this author evidence.

## Bounded observations, not performance claims

`observations.mjs` compares the exact hash-checked, byte-correct ownership
candidate `7a517cec` with this correction. The previous stream module is
transpiled in memory with only import bindings changed; both use the same
unchanged `internal.ts`. No buggy borrowed baseline is used as a speed comparator.

There are **56 cohorts**, **672 timed byte-checked outputs**, and **224** additional
instrumented/warmup outputs: both commands, four storage/reuse controls, three
sizes (64 KiB, 256 KiB, 1 MiB), 1024/65536-byte chunks, plus the prior adverse
65,792-byte ragged workload. The 1024-byte tail cohorts use the prior author's
same byte generation, sizes and 4096-byte retained count. Large-chunk and head
omission cohorts are additions, not mislabeled unchanged prior coverage.
Each cohort has six paired repetitions with alternating order after warmup.
Exact hashes, counts, all raw timings and order are in `observations.json`.

Selected immutable Buffer tail results (previous / corrected):

| Workload | Total queue copy bytes | Max observed queue backing | Median milliseconds |
| --- | --- | --- | --- |
| 64 KiB, 1024-byte chunks, count4096 | 65,536 / 65,536 | 65,536 / 4,096 | 0.153 / 0.164 |
| 1 MiB, 1024-byte chunks, count4096 | 1,048,576 / 1,048,576 | 1,048,576 / 4,096 | 1.043 / 1.357 |
| 1 MiB, 65536-byte chunks, count4096 | 1,114,112 / 1,114,112 | 65,536 / 4,096 | 0.100 / 0.097 |
| 65,536 first bytes + 256 singletons | 16,810,112 / 65,792 | 65,536 / 65,792 | 0.920 / 0.363 |

For that ragged workload the corrected queue performs **zero trim copies**;
all 65,792 copied bytes are initial ownership copies. The retained backing can
be slightly larger than the live tail, as intended and bounded by the proof.
All four storage controls and both commands reproduce the exact copy counts.
The smaller-chunk timing regressions are retained openly; these short runs
establish neither a general speedup nor a throughput guarantee. The acceptance
claim here is the deterministic byte-copy/retention correction, not performance
superiority.

Observation interval: **2026-08-27T10:24:55.846Z–10:24:56.564Z**. Node v22.22.2,
darwin/arm64, tsx 4.23.12, TypeScript 5.9.3. Host load was approximately
10.07/11.36/9.64 over 1/5/15 minutes; other workers share this host. Whole-process
memory snapshots include both implementations, compiler/loader and fixtures;
they are not per-candidate or peak measurements. No full build, deployed-provider,
72-hour work-duration or broad just-bash-superiority claim follows.

## Contract basis and reproduction

As the prior author correctly reported, bare `ByteSource`/`ByteSink` declarations
contain no explicit lease-duration prose. The basis is executable io copying,
reuse and awaited-acceptance behavior; AGENTS ownership/await requirements; and
the user's next-read, finalizer and write-completion mutation schedules. The
filesystem hook is `readStream`. This does not protect arbitrary concurrent
host mutation or turn host JavaScript into a sandbox.

From the repository root, without overwriting recorded evidence:

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/commands/internal.test.ts tests/commands/streams.test.ts
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/contracts/io.test.ts tests/shell/streaming.test.ts tests/commands/text.test.ts tests/commands/stream-format/rev.test.ts
node_modules/.bin/tsc -p tests/stress/byte-ownership-20260827/fix/tsconfig.json
node --unhandled-rejections=strict --import ./tests/stress/byte-ownership-20260827/trim-fix/binding.mjs --import tsx --test --test-concurrency=1 tests/stress/byte-ownership-20260827/ownership.test.ts
node --unhandled-rejections=strict --import tsx tests/stress/byte-ownership-20260827/trim-fix/observations.mjs
```

The bound replay/observation commands require the exact frozen inventory and
intentionally reject a later shared candidate, including the concurrent export
integration recorded above. Unbound suite commands on later source do not
retroactively certify this frozen evidence or qualify that integration here.

`record.mjs` is the write-once initial recorder using captured raw development
transcripts; it is not needed for replay. `observations.mjs --record` also refuses
an existing JSON destination. Canonical tests stay in their canonical TypeScript
location; evidence scripts/data introduce no TypeScript discovery exclusions.
Raw TAP/assertion whitespace is preserved, not reformatted; final whitespace
checks qualify any such evidence-only warnings separately.

All author test/compiler/observation processes returned. No server, detached
worker or service was started. Existing Shell cleanup, source finalizers and
sink barriers are exercised and released. Unrelated edits/staging/native scratch
are preserved; no shared dist or other owner's path is written. The final ready
marker supplies evidence commit and clean owned-path status after commit.
