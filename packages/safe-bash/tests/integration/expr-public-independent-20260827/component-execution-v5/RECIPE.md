# EXPRPUBLICCOMPONENT v5: one bounded TRACE attempt

Authorization date August 28, 2026; historical 20260827 paths unchanged. Only this
owned subtree is new. One invocation after recipe commit and SHA-256 manifest
freeze. No product execution during preparation, no retry, no expectation fix,
no HTML/DU29/TAP/fullgate, product/engine/TEMP or foreign edits. Accepted-DU and
original gate remain HELD; selected DU75 names are not an accepted prerequisite.

## Inspected immutable predecessor and accepted proof reuse

Read v4 recipe 8a28b7bffa5ef093cff2374ec32cba4ec4ca83f0, recipe manifest
71ec5ec3a8b27cdcb0e3c6bfa27eec9b4d12396022f76d950c5b38ee9a2e1179,
evidence 1ec1912001db43f803af46bb5dea89a7e397b83b, evidence manifest
5baf947732e17db0e61d734de5c8bde3acfbe5daa14d634539dd1ecea4de7eb4 and seal
23678ecd1f6a8767b529ea85d72cf04ad2b9ba21437ca0ab1771ee99a5c997f4.
Authenticated all 84 raw entries and read the actual killed compiler receipt:
254ms, 1048498 stdout bytes, SIGKILL at ordinary 1MiB cap, no product verdict.
V4 104 runtime unrun, 1 supervised type failure/39 unrun, 9/36 package controls,
28 repair controls, independent357-input build/exact pack remain as recorded.
No rescoring/replay or authorpack-as-independent-build substitution.

P01 is explicitly BOUND_ACCEPTED_PROOF, NOT a fresh build. Bind the accepted v4
independent raw pack, c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd,
727526 bytes, all834 regular members. Require exact original357 selected Git
object IDs, local retained build input bytes/modes, complete retained build/tools
inventory including new entries, original tools and both Node hashes. A missing
binding stops execution; no fallback/rebuild. Do not duplicate source or old raw.
The root-accepted v4 28 repair controls and v3 reader16 qualification are bound,
not replayed; no reader semantics changes, new reader controls or reader claim.
V3 recipe56f550afee7e6fd895b6d700e4cec376b6cf1eaf/evidence
d3136122f2d1d47f0d0db82d71a4f50593359446 and manifest
f2344a8bac78bf32599ba78b73eafa98e8102cf53976e5628b3d9bbf1b2af5c3 stay intact.

Keep candidate44f00bf84278e3361b52106478d59c707ab7b2bc,
tree5905cf8d43233c68ea2bd499275ada2641223d9a,
sourcea1c95fc52ddeef2d753950b09dd2a26b44b4ab6e. Bind the exact ninefreeze
f8b982f09e51b9a0a073b0b7bb393cb54796dd62 and addendum
a0142c7711c4be2cc33384c87bd6d8dea9e3d07d,
d4c894e971725f0a6b0ee6f8d6c20f8ad3d39a63c9ac8aa114788474e898d1b7.
Copy/bind unchanged cases.json bytes; no regeneration. Bind author handoff and
POLICY at 8d07bd6e7549aaa9a1096c3e9278b231692bc699. Pre/post authenticate history,
originals, tools, recipe, modes, hashes and new entries. Historical work trees
are excluded from top-level history listing but the reused v4 build/tools trees
are checked recursively against saved receipts, including new entries.

## Fixed transport bounds and complete raw evidence

Unchanged compiler invocation includes --traceResolution exactly for positive
and broken-declaration as v4. Other eight type invocations per layout remain
ordinary. No source/tool/original/other writes under any compiler: --permission
with exact read grants only, no write grants because every type check is noEmit.
No emission directory is needed. Existing tool closures only; no network/deps.

Declare a fixed combined stdout+stderr TRACE artifact ceiling of 64MiB per child.
This is deliberately finite, not a universal TypeScript bound: one pinned
compiler, fixed271-entry TS/Node/undici closure, one selected consumer fixture,
fixed834-member package, four known layouts and exact compiler args. Sixty-four
times the observed 1MiB v4 prefix permits complete traces while bounding this
fixed job. Ceiling overflow is a supervised HOLD, not adaptive growth or retry.
Ordinary combined output cap and TRACE preview are independently 1MiB. Crossing
TRACE preview alone never kills a compiler. Raw stdout/stderr spool separately,
untouched, in at most64KiB chunks with awaited writes/backpressure BEFORE parsing.
Each complete artifact has byte count and full SHA256. A supervised/overflowed
producer is labeled captured-prefix-truncated, never full trace. Observed byte
counts after kill are not claims about bytes an interrupted producer never wrote.

Incremental UTF8 decoding, incomplete line at most128KiB, at most256 diagnostics
and262144 diagnostic bytes. Overflow kills/reaps and HOLDS, not silent dropping.
Parse every captured line, not the preview, for diagnostics, public declaration
paths and successful /src/ resolutions. Preserve exact v4 type assertions.
No unbounded Buffer.concat; bounded previews alone concatenate at most1MiB.
Full raw archive is streamed gzip/NDJSON with64KiB base64 chunks, not a giant
JSON/Buffer; fixed2GiB aggregate raw ceiling. This separately caps aggregation
of22TRACE children and ordinary children/receipts for this fixed cohort; crossing
that archive ceiling is also a HOLD, never adaptive allocation.
Receipt JSON and old pinned evidence have separate finite bounds; no constant
RSS or arbitrary concurrent mutation safety claim.

Child deadline remains at most15s, kill/reap grace5s, context120s, outer900s with
60s termination grace. Kill uses owned detached child process group; receipts
state natural versus forced closure. Process/output/hash receipts fsync before
assertions; required phase verdict and evidence seal durable before actual exit.

## Frozen qualification: 38 new controls, no product-type credit

Sixteen transport controls: eight on EACH exact Node22/24. The producer and
supervisor, compiler, config and fixture are hashed before launch. Real compiler
controls pad beyond1MiB BEFORE importing the actual pinned CLI in the same
permission-fenced process; --traceResolution and strict settings retained:

1. Positive compiler >1MiB succeeds naturally; both channels captured in full.
2. Late actual TS2322 after preview cutoff exits2, reaches type-diagnostics.
3. Late actual successful resolution to an owned /src/ fixture exits0 but reaches
   forbidden-resolution, not missing-module or launch failure.
4. Fixed64MiB artifact overflow produces a prefix hash/count, SIGKILL and closure.
5. Actual exit7 after preview cutoff reaches nonzero-child, natural closure.
6. Oversized incomplete line is bounded/killed/reaped, not silently discarded.
7. Synthetic diagnostic-retention overflow is bounded/killed/reaped.
8. Ordinary output still kills at1MiB, independently of TRACE allowance.

Twenty-two aggregate controls: unchanged seventeen v4 categories adapted to
explicit bound P01/reused qualification, plus missing-bound-proof, failed and
missing trace qualification, supervised type, and missing phase. Actual child
exit reflects verdict; fixture includes otherwise-zero outer fields. These are
synthetic aggregator inputs, never40 product-type evidence. A failed/unclosed
qualification holds all product phases; no second control attempt.

## Versioned phase order and aggregation (v5 delta)

V4 order was package admission -> types -> runtime; its type supervision failure
globally blocked runtime. V5 is explicitly, PER LAYOUT:
package admission (9) -> independent runtime (26) -> types (10).
Installed Node22, installed Node24, then actual rename of whole consumer/package
to a path with spaces, moved Node22 and moved Node24. All104 runtime assertions,
40 type checks and36 package controls preserve v4 actual expectations.
Runtime failures or recoverable CLOSED type supervision do not automatically
block independent remaining phases/layouts. Continue only with intact bindings
and proven process/observed-worker closure. Mandatory integrity/load/cleanup
failure stops dependents; no type outcome can waive earlier runtime failure.
Missing/failed P01 binding, any failed control/type/runtime, unrun required case,
missing phase/finalization, unexpected supervision or missing closure forces
aggregate NONZERO even if child/outer fields misleadingly say zero.

Actual loader and worker-load hash evidence, full pack/binding and strict source
fallback/negative controls are unchanged. Original observer
1fffd7e99be072e87127be1af56461334a6db529d37c8be38b5418762548e37c and silent worker
fbd03925f44cda3e46a012e3060e4c2e5547773dc4c26ca40a0dcb53bc5ef9ed copied unchanged.
R25 exec-only before dispose,50ms startup/1000ms request/max1, silent worker
0ready/0requests and natural product retirement before exec settlement remain
strict. R26 direct shared-definition two contexts/exactreason/sibling, then Shell
exec/dispose+sibling remain strict. Held transport is not a CPU-contention claim.
No weakening to author exec+dispose, unknown nested regex override, engine edit,
extra command count or optional curl/SafeJS/getopts inclusion.

## Execution and commit recipe

Preparation reads/authenticates and emits patches only. Use apply_patch for all
manual edits. Syntax checks only before freeze; no control/product dry run.
Seal all recipe files with SHA256/modes/lengths; commit ONLY explicitly enumerated
owned recipe paths using git commit --only. Print full commit, manifest,38controls
before exactly ONE launch.mjs invocation with pinned Node22 and that full commit.
Afterward inspect saved receipts read-only; preserve all failures, mistaken
fixtures, raw prefixes and binding evidence. Commit only enumerated owned
evidence paths, then verify committed manifest/archive read-only. No retry until
green, fixture correction, clean/reset/stash/ref/branch, or foreign staging changes.
