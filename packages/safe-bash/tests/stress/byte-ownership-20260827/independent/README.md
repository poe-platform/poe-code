# Independent borrowed-byte holdouts

Owned only by the DIFFERENT independent verifier. The author must not inspect
holdout contents before the candidate is ready. No production, original audit,
root configuration, dependency, filesystem implementation or regex edits.

## Freeze and runs

`node tests/stress/byte-ownership-20260827/independent/run.mjs --freeze`
records source and fixture SHA-256 values before any product execution. Commit
that freeze and these explicit files before running the baseline. Then run:

```
node tests/stress/byte-ownership-20260827/independent/run.mjs prepatch-v3
node tests/stress/byte-ownership-20260827/independent/run.mjs candidate
```

Each run builds current source with the existing TypeScript compiler into owned
ignored scratch, copies the unmodified actual package manifest, physically moves
the built package, and imports its existing `virtual-bash` root export from the
moved consumer. No source or runtime dependency is copied into that package.
The private helper cohort is explicitly separate and is not public API evidence.
A loader compares every loaded package module against pre-run SHA-256 values;
source, fixtures and all emitted package files must remain unchanged during a run.
All child processes are synchronous, individually bounded and use strict unhandled
rejections. Every Shell is disposed. No server or broad process cleanup is used.

## Denominators and schedules

The frozen inventory is **30 tests: 10 internal attribution, 20 actual public
package tests**. Native Uint8Array controls are 5 internal and 7 public; Buffer
cases are 5 internal and 13 public. Test outcomes remain separate from build,
discovery or fixture failures. Explicit byte literals are the oracle; expectations
are never recomputed from candidate output. No external native oracle is required.

The borrowed source uses nonzero-offset unequal views, zero-length views, reused
backing storage and generator-finalizer zeroization. Storage changes only when the
consumer requests the next read or closes the generator; the sink producer awaits
each accepted write before requesting the next chunk. Guard bytes and entire
backing checks reject consumer mutation. No concurrent arbitrary mutation is owed.
Bare `ByteSource = AsyncIterable<Uint8Array>` has no prose lease duration. The
schedule is justified by the executable reused-buffer collector and accepted-sink
controls in `tests/contracts/io.test.ts`, plus the project ownership instructions;
this is not an invented stronger universal contract.

Direct source inspection found `grep -F -f` as the actual shared `collect` consumer.
Public tail line/byte retention, head exclusion using the same queue, fixed-string
pattern files, pipelines and saved VFS bytes are covered. Small collector and shell
output limits, upstream failure, cooperative abort and sink rejection are bounded
controls. There are no pathological regex, giant-line or filesystem-adapter tests.

## Report boundary

The original 17/20 baseline and frozen scaffolding history remain read-only and
are not rebound by this runner. Author-owned unchanged-20 replay is separate.
This leaf reports its own 30-test frozen cohort and moved-build identity only.
The preserved first harness attempt and exact corrections are documented in
`scaffolding-correction.md`; current scaffolding binds `freeze-scaffold-v3.json`.
Timing records include compiler/loader/harness effects and cohost load is
uncontrolled. Allocation is not measured; source-level copy observations may be
reported after the candidate is inspected, not as a blanket-copy recommendation
or throughput/memory improvement. No superiority or full-gate claim follows.
