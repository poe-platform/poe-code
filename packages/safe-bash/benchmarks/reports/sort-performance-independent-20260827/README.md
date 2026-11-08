# Independent sort collector review — August27,2026

## Accepted and integrated scope

**Accept the exact candidate collector, not overall just-bash superiority.**
Live source commit:7ba5301d43345c2eb621b7df95a452a87b74e909, only
src/commands/text.ts and two focused public borrowed-Buffer regressions in
tests/commands/core-sort/borrowed-buffer.test.ts. Root conditionally authorized
this exact integration after independent correctness/material-benefit checks.
No further production change was made. Time-env, env, FS, runtime, root exports,
configuration, dependencies and private packages remained outside this write-set.

At task admission HEAD wasd1de554e2756e4437a7220feeeab86a1b8664372. text.ts was
clean in both worktree and index and exactly matched the candidate preimage;
other workers' staged tree files were left untouched. The preimage was rechecked
immediately before applying the patch. The final source is byte-for-byte the
candidate, **32 added lines**, not a rewritten alternative:

| Object | SHA256 |
|---|---|
| Original text.ts |17a4c60061bdeeca1000499ae9b433f7e3e58c768e1c855e81e7c5338f8998d2|
| Integrated candidate text.ts |08a27afc45d2f5a48b082cc2c979e3a13d01fbef42129bc0e72d5477d56a074d|
| Author candidate.patch |f13d6c89a6b43962c0b7794510d15a3fdc7b33f9113db09747c1f5484ce29811|

The collector owns complete records and unfinished tails before requesting the
next source chunk. Comparator/key/numeric/unique/stable/reverse logic, check-mode
path, output batching/publication,32MiB input accounting and64KiB output chunks
remain unchanged. internal.ts and execution.ts retain their original hashes.
No global `lines` helper fix, locale shortcut, cap relaxation or numeric fast
path is hidden in this integration.

## Correctness and actual public defect

Frozen source for paired prototype review is the author's committed
6e99656dd9d6e285b33fb3cf99ed5fef19146a48. Its exact text.ts also matched the
live preimage. Source/config/tests are regular-file copies; only candidate text.ts
differs. Existing author harnesses at3d2e6ff/3ea5eb9 are reused read-only after
inspection; the hidden controls, native fixture recapture and independent
assessment here are new. This is an independent rerun, not copied author results.

| Cohort | Original | Exact candidate |
|---|---:|---:|
| Unchanged core100 |100/100|100/100|
| Adjacent sort/expanded65 |65/65|65/65|
| Author fresh26 |25 pass /1 fail|26/26|
| Independent hidden30, corrected fixture |21 pass /9 fail|30/30|
| Canonical public named-VFS regression |0/2|2/2|
| Two isolated source mutants |not product results|both caught:1 and2 failing assertions|

The Buffer defect is real through public Shell with a faithful pluggable VFS,
not solely a direct benchmark context. A readStream yields a nonzero-byteOffset
Buffer view valid until the next iterator advancement, then reuses its storage.
The previous shared `lines` helper calls `.slice()` on that Buffer, retaining a
view for an unfinished record; the producer's next chunk overwrites it before
concatenation. The exact candidate uses new Uint8Array copies for retained tails.
Named file inputs bypass ShellInput's stdin copy. Direct public stdin already
passed before the patch because ShellInput owns a copy on each take.

ByteSource is AsyncIterable<Uint8Array>; Buffer is a valid subtype. There is no
declared permanent immutability requirement on yielded arrays. The established
contract test `tests/contracts/io.test.ts` explicitly requires collectors to
copy reused Buffers. This review tests cooperative lifetime-until-next reuse,
not arbitrary concurrent mutation while a consumer still owns the current
iteration. Node's Buffer documentation confirms `.slice()` creates a view,
unlike Uint8Array copying. No lifetime contract was weakened or invented to
excuse the failure. The canonical test runs actual public Shell/standardCommands
with unchanged backing file bytes, in LF and NUL modes.

Hidden controls additionally cover Buffer/Uint8Array views and offsets, chunks
of1/2/5/17 bytes, EOF mutation, binary/invalid UTF8/Unicode, stable precise numeric
and multi-key sorting, empty records/input, exact32MiB admission boundaries,
pre-publication source/missing-input failure with -o preservation, cancellation
of pending reads and empty chunks, late rejection observation, output ownership
and backpressure. Check mode has a separate native-status control; this does not
certify all other shared-lines callers or fix them implicitly.

One initial **new fixture** incorrectly expected status1 for an input collection
cap failure; both original and candidate return status2 from the existing input
error path. Initial20/30 and29/30 are retained. Only that assertion was corrected
to2; EFBIG and zero-publication assertions remain. This is distinct from the
author's older output-phase cap fixture, whose status1/already-published-byte
history remains in the original report. Neither source behavior nor native
expected bytes was changed to make a benchmark green.

## Paired timing and fairness

Measurements ran2026-08-27T09:05:16.242Z–09:05:51.931Z, Node22.22.2 on Darwin
arm64, shared host. One-minute load ranged4.969–5.292, higher than the author's
older run; no exclusive CPU, frequency/affinity lock or low-noise claim.

The existing authenticated just-bash3.4.2 tarball is rehashed against official
registry SHA512 SRI/SHA1 from010411ef. All955 published installed files match
the authenticated manifest before copying; transitive bytes are frozen and
rehash-checked, not newly publisher-authenticated. No download/install, source
rebuild or claim that3.4.2 is the current release. Tarball SHA256:
`f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d`.

All ten original recipes, stdin bytes and VFS expected effects were independently
recaptured with pinned GNU9.7 sort/uniq and exactly match the original fixtures.
Run all ten, including baseline failures:720 measured calls,18 warm and6 cold
per variant/workload, plus450 separately retained warmups. All six variant orders
are rotated; each warm permutation repeats three times. Each cold call uses a
fresh process/import/registry. No case was removed based on timings or correctness.

The unchanged worker times the public shell.exec workflow; setup, fixture reset,
output conversion/comparison and final VFS snapshots are outside the timer.
Baseline's required Latin1 input conversion remains inside its call timer; ours
accepts bytes. Thus external comparisons are public-adapter workflow timings,
not identical algorithm-only timings. Original/candidate use identical adapters.
Matched exit/stdout/stderr/final-file bytes are required for speed eligibility.
Limits are unchanged:4MiB output,10000 commands/loops,5s deadline,512MiB Node heap
flag; ours retains4096-byte pipeline high-water mark. None is relaxed for speed.

Warm medians in milliseconds;18 samples/cell, paired gains are candidate-faster
rounds. Full dispersion, paired ratios and individual samples remain in evidence.

| Workload | Original | Candidate | just-bash3.4.2 | Paired gains |
|---|---:|---:|---:|---:|
| Historical sort\|uniq5000 |6.361|5.868|3.640|13/18|
| Plain5000 |3.238|2.153|4.091|16/18|
| Unique paths20000 |16.150|12.426|35.760|17/18|
| Reverse logs12000 |8.941|7.013|21.176|18/18|
| Unicode8000 |5.354|3.675|ineligible: bytes differ|17/18|
| Numeric stable8000 |31.163|29.951|13.694|12/18|
| Numeric key8000 |34.722|33.890|29.800|10/18|
| In-place5000 |3.233|2.155|3.851|17/18|
| Tiny32 |0.135|0.138|0.235|6/18|
| Invalid bytes8000 |4.133|2.549|ineligible: bytes differ|18/18|

Material own-source reductions repeat: plain33.5%, paths23.1%, in-place33.3%,
reverse21.6%. Tiny median regresses2.1%. Numeric improvements are small and both
numeric cases remain slower than baseline warm. Historical pipeline improves7.7%
but baseline3.640 remains faster than candidate5.868. No overall baseline win.

Cold execution medians also differ from cold end-to-end costs. Plain exec
8.228→6.311ms, but fork-to-result107.519→109.773ms (baseline95.864). Historical
exec19.780→18.713ms, but end-to-end127.488→133.345ms (baseline95.665). Paths
end-to-end126.766→121.320ms. There is **no blanket cold-start win**.

All240 original and240 candidate measured calls exactly match native expected
results. Baseline matches192/240;48 Unicode/invalid-byte calls differ. Their raw
timings and actual bytes remain but are excluded from external speed-win claims.
All720 stay in the denominator. RSS/heap observations and process-lifetime maxRSS
are retained, not per-command peaks or hard memory bounds. Warm RSS includes
imports/JIT/fixtures/history (original131.5–184.5MiB, candidate131.3–174.2MiB,
baseline96.6–143.2MiB); it is not proof of a lower memory cap.

## Integration proof, ownership and cleanup

The live integration validation freezes
cd37ce07c1f41f3797e19e0f701b662823338843 plus only the exact candidate and new
canonical test.167/167 targeted tests, clean build and strict Node-profile scoped
types pass. That is a specific frozen source+overlay proof, not a whole-product
gate for a moving worktree. Source/test hashes match those committed in7ba5301.
No new dependency or public API. A first standalone type invocation accidentally
included TypeScript's default DOM library and produced WebDAV RequestInit.duplex
TS2353; the actual project specifies lib=[ES2023]. The preserved corrected run
uses that Node profile at the **same frozen revision**, without root/FS edits.

All183 timing workers exited without forced kills. Hidden/control supervisors
report no survivors, timeout or output overruns. Native processes were bounded
and synchronous. Exact owned source/build/dependency/state/temp trees are removed;
evidence directories contain logs only. Foreign authentication artifacts/private
state were untouched. The final source is exact candidate08a27afc…, and patch
reconstruction matches; applying to an already-patched preimage is refused.
Author rejected prototypes A/B, exploratory candidates, old failed fixtures and
original measurements remain under sort-performance-20260827 unchanged. They
are not pooled into this acceptance. No live full-suite run is inferred.

## Reproduce

Use new output/state paths and existing authenticated comparator/native/dev tools;
no install. These author harnesses are inspected and reused read-only:

```sh
export SORT_REPORT=/tmp/sort-independent-new-report
export SORT_STATE=/tmp/sort-independent-new-state
node benchmarks/reports/sort-performance-20260827/prepare.mjs
node benchmarks/reports/sort-performance-20260827/apply-prototype.mjs
node benchmarks/reports/sort-performance-20260827/validate.mjs
node benchmarks/reports/sort-performance-independent-20260827/validate.mjs
node benchmarks/reports/sort-performance-20260827/mutants.mjs
node benchmarks/reports/sort-performance-independent-20260827/fixtures.mjs
node benchmarks/reports/sort-performance-20260827/measure.mjs
node benchmarks/reports/sort-performance-20260827/summarize.mjs
node benchmarks/reports/sort-performance-independent-20260827/assess.mjs
node benchmarks/reports/sort-performance-20260827/finish.mjs
node benchmarks/reports/sort-performance-independent-20260827/seal.mjs --check
```

The live applier is not a normal verification step: it requires explicit source
ownership/authorization and the exact old hash, so it now refuses this integrated
tree. `validate-live.mjs` builds an isolated explicit source+owned-overlay snapshot
without touching shared dist/config. Primary Node22 buffer/process documentation
was consulted for Buffer view/copy behavior and RSS/maxRSS interpretation; measured
runtime version remains22.22.2, not the newer online documentation version.
