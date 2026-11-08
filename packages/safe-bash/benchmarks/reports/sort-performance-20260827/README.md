# Frozen sort performance / isolated candidate — August27,2026

**Live product remains unchanged. Candidate review, not merge approval.**
Harness and candidate-artifact commit: `3d2e6ff84b3029eb618c919ae1dd993127cb296d`.
Source freeze: `6e99656dd9d6e285b33fb3cf99ed5fef19146a48`, the committed HEAD when
this assignment began. Later authors' source/working-tree changes are excluded.
All new repository files are confined to this report folder. No root/config/
registry/contracts/dependency/private-package edits or installations occurred.

## Decision and exact write-set

The selected candidate materially improves several measured workloads, not just
one outlier. It does **not** make sort universally faster than just-bash, remove
the numeric bottleneck, or establish whole-product superiority. Request a
different reviewer before authorizing any live patch.

`prototypes/candidate.patch` proposes **32 added lines in src/commands/text.ts
only**: sort-local record collection with one asynchronous source-chunk loop,
synchronous record acceptance and owned byte copies. Comparator/key/numeric/
stable/reverse/unique behavior, check-mode early exit, output batching, output
publication, diagnostics and limits remain on their existing paths. No ASCII
assumption or Unicode decoding fast path is introduced. Non-sort consumers of
the shared `lines` helper are untouched.

At this freeze, env is in `src/commands/execution.ts`, not text.ts; the shared
`src/commands/internal.ts` also remains unchanged. `manifest-after.json` checks
all three live files against the freeze, all equal. The complete200-file copied
source differs only at commands/text.ts. This is the write-set disclosure;
**no live product patch was made**. Recheck ownership/current diffs before any
future application, especially alongside ongoing env/runtime work.

| Candidate custody | SHA256 |
| --- | --- |
| Original text.ts |17a4c60061bdeeca1000499ae9b433f7e3e58c768e1c855e81e7c5338f8998d2|
| Candidate text.ts |08a27afc45d2f5a48b082cc2c979e3a13d01fbef42129bc0e72d5477d56a074d|
| Candidate patch |f13d6c89a6b43962c0b7794510d15a3fdc7b33f9113db09747c1f5484ce29811|

The temporary patch applier uses apply_patch, requires the exact original hash,
and refuses non-owned-temp paths or an already-patched preimage. An independent
regular-file reconstruction produced the exact candidate hash; reapplication
was correctly refused. Full source/build/test/dependency hashes are retained.

## Profiles before choosing an approach

CPU sampling on the actual compiled current implementation, not assumed code:

- Plain5000: line splitting11.3% sampled self time, concatenation4.2%, comparator
  wrapper/Buffer comparison about15.8%, and GC14.0%; the sort callback/output
  path also appears prominently. Profiles include fixture/capture overhead and
  profiler startup; percentages are diagnostic samples, not exact accounting.
- Historical sort|uniq: line splitting14.9%, concatenation4.2%, GC11.5%; async
  task processing and uniq remain substantial. Optimizing sort cannot remove
  all downstream uniq/pipeline cost.
- Numeric8000: repeated numeric parse33.8%, Latin1 slicing8.6%, with further
  Buffer allocation/slicing costs. This independent bottleneck is not fixed by
  the chosen record collector; no numeric speedup claim is manufactured.

`profile-hotspots.json` and three complete CPU profiles retain the observations.
Prototype A decorated records with reversible Latin1 string keys: it regressed
common plain/in-place workloads and was rejected. Prototype B compared a bounded
byte prefix without allocations: modest gains with inconsistent reverse-log
results. Both patches and raw exploratory trials remain. Neither is included
in the selected patch. Prototype C targeted the measured async/copy overhead
and showed wider gains. Before final validation it was tightened to explicit
Uint8Array copies, including Buffer subclasses, rather than relying on slice
ownership. Final timings below use that exact tightened candidate, not the
earlier exploratory versions. Exploratory timings are not pooled into results.

## Matched protocol and authenticated comparator

Node22.22.2, Darwin25.4.0, reported Apple M5 Pro,15 logical CPUs; same machine,
Node flags and protocol for all variants. Host is shared/uncontrolled: observed
one-minute load3.743–4.157; no affinity, frequency lock or exclusive-host claim.

- Authenticated just-bash3.4.2 baseline from accepted010411ef evidence: retained
  official tarball rehash matches captured SHA512 SRI/SHA1; all955 installed
  published files match the authenticated per-file manifest, then are copied
  as regular files. Tarball SHA256
  `f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d`.
  No source edits, rebuild or replacement package. Transitive dependency bytes
  are frozen/rehash-checked, not newly publisher-authenticated. No new download,
  signature verification or source-build provenance claim is made.
- All variants use compiled/bundled public modules in isolated regular-file
  copies. A resolution guard rejects repository fallback and uncompiled product
  imports; actual import URLs are retained. TypeScript loaders are used only
  for unchanged test cohorts, not timed product execution.
- Ten declared workloads, each measured18 warm samples and6 first-execution
  cold samples per variant: **720 timed executions**. Warm uses15 warmups per
  workload/variant, then all six execution-order permutations repeated three
  times. Cold uses fresh processes/imports/registries and all six permutations.
  All warmups, failures and outliers remain recorded; nothing is trimmed.
- Virtual FS fixture reset occurs outside the execution timer. Identical input,
  script, C locale, stdout/stderr bytes/status and complete fixture-directory
  file bytes are compared to fresh GNU9.7 native sort/uniq before timing results
  are eligible for cross-engine speed comparison. Output conversion/comparison
  and filesystem snapshots are outside the timer. The baseline's required
  Latin1 stdin argument conversion is inside its public-call timer; raw Uint8Array
  input is used by ours. Thus these are supported public-call workflow timings,
  not identical low-level adapter-free algorithm timings. Current/candidate
  comparisons use the identical API and adapter.
- Shared settings:4MiB output ceiling,10000 commands/loops,5s execution deadline;
  ours retains its4096-byte pipe high-water mark. Node heap setting512MiB is the
  same for all workers. The command's32MiB input/record buffer policy and64KiB
  output chunks are unchanged. No safety/cap relaxation is used to improve time.

Native GNU9.7 executable hashes in preparation/after manifests:
sort `4fb5d7f504e18e2b98c96c562837caf37c2494be89f56356a58c8295a50bcc59`;
uniq `5df74cca1d5fb360e27cf3a6cf5ea3211b2aeafc38c3816c1098ef4eb03c9a97`.
These are the available metadata-stress Darwin build, not the older performance
capture's differently hashed GNU build. Native processes run only in owned
temporary oracle directories. Product commands never invoke them.

## Warm execution results

Milliseconds, median; current/candidate IQR in brackets. Each cell has18 samples.
The last column is the number of paired rounds in which candidate was faster.

| Workload | Current | Candidate | just-bash3.4.2 | Paired gains |
| --- | ---: | ---: | ---: | ---: |
| Historical sort\|uniq5000 |5.083 [4.942–5.331]|4.596 [4.514–4.811]|3.145|17/18|
| Plain5000 |2.792 [2.580–3.026]|1.830 [1.750–1.917]|3.941|17/18|
| Unique paths20000 |16.834 [15.620–19.401]|12.669 [11.728–13.590]|35.910|17/18|
| Reverse logs12000 |7.539 [7.243–8.840]|6.348 [5.400–7.764]|21.125|16/18|
| Unicode8000 |4.745 [4.287–5.364]|3.236 [3.083–3.994]|byte mismatch; timing in raw data|18/18|
| Numeric stable8000 |29.823 [28.727–30.618]|28.440 [27.377–30.230]|12.102|12/18|
| Numeric key8000 |34.698 [34.028–36.310]|34.153 [32.561–35.906]|28.953|11/18|
| In-place5000 |2.865 [2.586–2.974]|1.848 [1.818–1.947]|3.392|16/18|
| Tiny32 |0.112 [0.102–0.141]|0.116 [0.105–0.135]|0.201|9/18|
| Invalid bytes8000 |4.178 [3.552–4.394]|2.386 [2.215–3.177]|byte mismatch; timing in raw data|18/18|

Material own-source gains: plain34.5%, paths24.7%, in-place35.5%; reverse15.8%.
Historical pipeline improves9.6%, but **baseline3.145 is still faster than
candidate4.596**. Both numeric cases remain slower than baseline; tiny median
regresses3.2% with overlapping dispersion. Unicode/invalid-byte current-candidate
comparisons are eligible and improve31.8%/42.9%, but no external-baseline speed
win is claimed for those mismatching outputs. Summary also retains min/max/p90,
MAD, paired ratios, every raw sample and per-sample host-load readings.

Current and candidate each match native on240/240 timed observations. Baseline
matches192/240: its two failing datasets account for48 retained mismatches,
all status0 with different bytes, not skipped/unsupported rows. Warmup failures
are separately retained. No denominator union or broad compatibility score.

## Cold results and historical interpretation

Cold first-exec medians (six samples), separate from import/setup:

| Workload | Current | Candidate | Baseline |
| --- | ---: | ---: | ---: |
| Historical pipeline |17.608|16.021|14.838|
| Plain5000 |7.777|6.223|13.111|
| Paths20000 |23.228|17.660|46.752|
| Reverse logs12000 |15.586|10.825|31.762|
| Numeric stable8000 |40.564|38.431|22.422|
| Numeric key8000 |44.792|43.080|46.709|
| In-place5000 |8.573|6.615|15.745|

Cold end-to-end wall times include process/import/setup/fixture/IPC overhead:
historical114.022→112.292ms versus baseline95.013ms; plain105.846→105.035ms
versus baseline94.294ms. Faster warm execution does not imply faster cold startup.
All ten cold datasets and dispersion are retained; this table is not a new gate.

The original40.672→10.811 versus6.320 evidence is untouched. Exact historical
script, stdin bytes and native stdout match this run's historical recipe
(stdout SHA256 `07c55ee7001039318f51fa66e0530c67fbda29776432a2d573ef5c86a3888a9a`).
That older measurement used TS source, different historical runtime and one
warmup. Do **not** attribute10.811→5.083 to this candidate: only matched current
5.083→candidate4.596 isolates the candidate under this new protocol.

## Correctness, failures and resource controls

| Frozen cohort | Current | Candidate |
| --- | ---: | ---: |
| Unchanged independent core controls |100/100|100/100|
| Unchanged adjacent sort/core-expanded |65/65|65/65|
| Fresh native/resource/actual-pipeline holdouts |25/26|26/26|
| Complete-source TypeScript/declaration build |exit0|exit0|

Zero skips. The prior111-focused/6-recipe/10-runtime evidence is historical
context, not falsely relabeled as these65 adjacent checks. No whole suite or
current-working-tree gate was rerun. All new harness modules pass node --check.

Fresh checks cover all byte values, invalid UTF8/non-BMP, numeric precision,
stable/reverse/unique/keys, LF/NUL and unterminated records,1/3/17/65536-byte
source chunks, long prefixes, file errors/-o preservation,32MiB overflow,
backpressure/owned64KiB output, unchanged partial-output boundary, pre/in-flight
abort with late rejection, check-mode early pull termination, and actual Shell
pipeline/file effects/shared output quotas.

The additional current-source failure is a **borrowed Buffer reuse** probe:
producer reuses a Buffer only when the consumer requests the next chunk, with
a record spanning chunks. Current returns `\n1\n\na\n` instead of `a1\nb1\n`;
candidate owns the retained bytes and passes. This is a direct injected-source
robustness finding, not a claim that every FS adapter emits reusable buffers or
that trusted host plugins are universally sandboxed. Existing100 controls still
pass unchanged. The shared helper used by other commands was not edited.

Two retained negative controls mutate **only the temporary candidate**:
removing total input cap yields1/26 failure; borrowing a record instead of
owning it yields2/26 failures. Both guards detect the defect. Candidate source
is restored byte-for-byte and rebuilt after each mutation.

Two harness corrections are explicit, not product fixes or quiet rebaselines:

1. Initial adjacent tests both failed discovery because the snapshot omitted
   tests/commands/helpers.ts. Added that exact frozen6e99656 helper identically
   to both copies; unchanged tests then pass65/65. Old module errors remain.
2. First fresh output-sink test incorrectly expected direct-command rejection.
   Actual shared define() converts non-abort sink errors to status1/diagnostic.
   Corrected only this new test to require status1/EFBIG and the exact same
   already-published65536 native bytes. No policy or product change. First
   current24/26 and candidate25/26 captures remain beside final25/26 and26/26.

Per-command memory peaks were **not** established. Warm after-execution RSS
observations range131.1–178.6MiB current,132.7–169.9MiB candidate,96.3–158.2MiB
baseline; these include imports/JIT/fixtures/history. Before/after heap/RSS and
process-lifetime maxRSS are retained, not marketed as caps or lower-memory proof.
Node documents memoryUsage RSS in bytes and resourceUsage maxRSS in KiB; Buffer
slice is a view whereas a new Uint8Array copy owns bytes (primary Node process/
buffer API documentation). Async source consumption remains bounded by existing
limits; record processing/Array.sort are synchronous, not universally preemptible.

## Cleanup, reproduction, next reviewer

All183 final timing workers exited, no forced kills. Final process scan found
no process referencing the owned scratch root. Frozen source/test/dependency/
native bytes were rehashed, copied baseline files unchanged, and the exact owned
scratch/reconstruction trees and state file were removed. Foreign authenticated
tarball/extraction directories, private checkout and other workers' files remain
untouched. Source/live-scope hashes, positive/negative patch reconstruction and
cleanup are in evidence/manifest-after.json.

Use unique report/state paths; existing evidence is never overwritten:

```sh
export SORT_REPORT=/tmp/sort-review-new-report
export SORT_STATE=/tmp/sort-review-new-state
node benchmarks/reports/sort-performance-20260827/prepare.mjs
node benchmarks/reports/sort-performance-20260827/probe.mjs
node benchmarks/reports/sort-performance-20260827/apply-prototype.mjs
node benchmarks/reports/sort-performance-20260827/validate.mjs
node benchmarks/reports/sort-performance-20260827/measure.mjs
node benchmarks/reports/sort-performance-20260827/mutants.mjs
node benchmarks/reports/sort-performance-20260827/summarize.mjs
node benchmarks/reports/sort-performance-20260827/finish.mjs
```

Requires existing dev dependencies and retained authenticated comparator/native
tooling; no installation is performed. If unavailable, report missing evidence,
not a pass. `MANIFEST.sha256` seals this report's inputs and raw artifacts.
Root should route the32-line candidate and these measurements to a different
reviewer, then explicitly authorize any live source ownership/application.
