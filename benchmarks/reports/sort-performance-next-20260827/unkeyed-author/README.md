# Author checkpoint: guarded unkeyed numeric reuse

**Author validation only; independent verifier/root acceptance is pending.**
No numeric-key extension, runtime dependency, public API or collector change.

## Identity and scope

- Prechange source: `dce6e3824d6de6d03490a531cf2bc7d2d279bb8c`, tree
  `ba4c35fdbd3c6a1c7717249def3f955daace3c8b`; dirty status and selected hashes
  frozen in `baseline.json` before product edits. Owned source was clean.
- Source + 21 new canonical regressions: **`08a26051438f5c6bdde100a4fe724dbb84f6fca4`**.
  Only `src/commands/text.ts` and `tests/commands/core-sort/unkeyed-numeric-cache.test.ts`
  are in that atomic commit. Text SHA256:
  `dfc9baed56564395bf90472fd505ea56a8eb5820712c0a5096d95ef2e2db47cc`.
- Baseline text/internal match accepted e090 source exactly. Full candidate
  source additionally includes intervening **committed** grep-aliases/index.ts
  and shell/runtime.ts changes; they are not this patch or dirty overlays.
  `attempt-1/freeze.json` pins all 221 source files, selected tests/configs,
  Git trees, archive hashes, emitted files, tool identities and loaded packages.
- Root index, package metadata and emitted text-command declaration are unchanged
  between selected baseline/candidate. No helper, other command implementation,
  old test/evidence, dependency, FS or runtime edits. No review subtree was read.

## Guard and retained accounting

Only unkeyed `-n` without `b`, `f` or check mode gets an invocation-local Map,
keyed by collector-owned record identity. Every explicit key bypasses it.
Plain paths allocate no cache/descriptors. Admission is lazy, in deterministic
comparison order; existing hits remain usable after saturation. Misses beyond
either cap run the same parser/comparison, with no new rejection or budget debit.

Caps: **16,384 entries** and **1,048,576 conservative logical retained bytes**.
Before parsing/admission, each record of N bytes costs **6*N + 2**. This reserves
two bytes/code unit for (1) the complete decoded Latin1 parent, (2) unnormalized
whole/fraction captures or their backing, collectively at most N, and (3) retained
normalized strings, collectively at most N+1 including synthetic zero. It does
not assume regex substrings compact their parents. Thus even a one-digit prefix
with a huge nonnumeric suffix is charged by its entire record, not its tiny value.
The charge intentionally exceeds the earlier report's illustrative accounting.
Empty records consume both one entry and two logical bytes. Metadata is bounded
by the entry cap, but its engine-dependent overhead is not measured.

This is **not a hard heap/RSS bound**: ordinary owned input, transient uncached
decoding/regex/padding, Maps/objects and engine allocation overhead are separate.
Neither input/output limits nor ownership copies changed. Parser grammar and
normalization are extracted verbatim; cached and uncached paths share the same
sign/whole/fraction-padding comparison. Stable/reverse/unique and whole-record
fallback logic is unchanged. No float conversion, global cache or async work.
Cache misses check the invocation signal; existing collection/output cancellation
remains. Synchronous Array.sort is still not preemptible; no rollback guarantee.

## Gates and measured operations

- Scoped text typecheck passes. Isolated committed candidate normal `tsc` build
  and strict source/selected-test typecheck pass. Canonical sort + byte-I/O tests:
  **75/75**, including unchanged 35 native observations at both original widths,
  existing public borrowed-Buffer tests and 21 new regressions. This is not the
  full typecheck/maintained-consumer inventory or a current whole gate.
- All original **21 frozen specimens pass unchanged** in five variants: full
  committed baseline, candidate, moved npm package, and both instrumented builds.
  Exact stdout/stderr/status/final-file equality and observation hashes agree.
  Original workloads SHA256 remains
  `3d99fdebe7262d3fcce473e96af7ddbe6bb27b1fe17886657cddc8d32e8c0504`.
  All prior manifest entries authenticate against `68f03711`; no rebaseline.
- **13 author cap/guard fixtures pass** in actual candidate package, instrumented
  candidate and an explicitly labeled same-runtime baseline-text counterfactual.
  Fixture descriptions/hashes freeze before these executions. Empty-entry case
  reaches 16,384 entries and 22 uncached parses; unique variant has 31 fallbacks.
  Exact character boundary reaches 1,048,576 bytes with 2 entries and 3 fallbacks.
  Large-decimal saturation reaches 1,008,140 bytes/7 entries; oversized-tail case
  retains only two small entries/16 bytes. All seven guard cases create no cache.

Frozen numeric-stable-8000, one call per variant (not timed):

| Counter | Baseline | Candidate |
|---|---:|---:|
| Exact numeric parses | 185,764 | 8,000 |
| Numeric input-copy bytes | 3,018,123 | 130,195 |
| Numeric comparisons | 92,882 | 92,882 |
| Fraction padEnd calls | 61,946 | 61,946 |
| Padded logical characters | 60,356 | 60,356 |
| Cache entries / charge | none | 8,000 / 797,170 |

177,764 hits avoid 177,764 parses and 2,887,928 logical input-copy bytes.
Collector/output/byte/key/numeric-comparison/padding counters agree for all21.
Numeric-key remains **164,900 parses/extractions**, deliberately unoptimized.
Historical pipeline remains **zero numeric parses**: its old gap is unresolved.

## Method, artifacts and limits

Node 22.22.2, TypeScript 5.9.3, Darwin arm64. Tool hashes and cohost load are in
freeze files. No external network, native campaign, dependency install or 720-call
timing replay. Operation workers are bounded by 512MiB V8 heap, 60s CPU guard,
90s child deadline, 5s exec abort and 8MiB logs. Heap flag is not an RSS limit;
abort cannot preempt synchronous sorting. Every Shell is disposed; synchronous
child handles are reaped; scratch hashes verify before/after and scratch is removed.

`capture.mjs` uses immutable Git archives and normal builds, then instruments only
isolated text/internal copies. `worker.mjs` derives from the authenticated original;
its only change selects instrumentation for names ending in `instrumented`.
`caps.mjs` reuses the actual moved package; its two instrumented modules use
isolated ES2023/ES2022 transpilation, not a fresh normal build. Cap counterfactual
replaces baseline text/internal only in candidate runtime; it is not falsely
called the full baseline. Full baseline already passed frozen21 separately.

`attempt-1/candidate-package.tgz` is the actual `npm pack --ignore-scripts` output,
unpacked and exercised away from the build tree, then preserved for the reviewer:
SHA256 `044399eb6baecef1d4660b012e1b2e68c03295edf22aeb2c2ec668d7c14d73f2`.
Loaded-file hashes/import records are retained; no dependency symlink is in the
moved package. Reproduction scripts require explicit `--capture` and a fresh
owned `attempt-*` / `caps-*` output. `seal.mjs` defaults to read-only verification.

`initial-test-source.ts.txt` and `initial-test-failures.md` preserve the first new-test
setup/expectation failures and corrections. Original frozen21 assertions never
changed. The baseline marker's first preparation hit Node's default maxBuffer on
the large workload artifact; it wrote nothing and executed nothing, then retried
with a bounded larger read. No product failure is hidden by either correction.

TAP durations are runner diagnostics, **not wallclock performance claims**.
Author tests are not independent acceptance; hidden holds/mutants, independent
moved-package review and broader limits/consumer qualification remain with the
verifier/root. No superiority/completion/72-hour claim. Historical 720-call
denominator and all **48 baseline mismatches remain ineligible and unchanged**.
