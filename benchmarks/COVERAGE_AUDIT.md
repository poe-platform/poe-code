# Benchmark coverage and claim audit

The exact requirement **"IT MUST BE BETTER than just-bash, much better"** is not
established. Neither a 109-case pass count nor this expanded matrix defines
overall superiority. The exact preference **"one more note - zero dependency if
posisble"** remains: no runtime dependencies; optional comparator tooling is
isolated under `benchmarks/`.

## Measured surfaces

| Surface | Evidence | What it does not establish |
| --- | --- | --- |
| Shell compatibility | Unfiltered 88 Bash fixtures, 18 generated cases, three streaming/concurrency/cancellation probes against pinned just-bash 3.4.2 | Full Bash, every flag, locale, process/job control, real or remote adapters |
| Independent sed/awk compatibility | 141 native cases: address/action/end-of-input matrix, regex, script files, in-place effects, C-locale bytes, field/pattern/array/control/output behavior, three actual pipelines | Every GNU/BSD dialect, generalized fuzzing, arbitrary locale, full POSIX capture disambiguation |
| Text-program safety | 20 isolated cancellation, lookahead, preflight, in-place preservation, loop/regex/array/recursion/buffer/output quota probes | Transactions across files, hostile filesystem atomicity, peak memory guarantees |
| Performance pilot | Twelve size-scaled workloads, two warmups and ten measured samples per engine, alternating paired execution, all outliers retained | Statistical confidence, controlled host load, sustained persistent-shell throughput, peak RSS, remote latency or a release-performance gate |
| Adapter protocol correctness | Separately owned `tests/fs/conformance/**` and `tests/stress/adapters/**`, including pagination, ETags, XML, lock cleanup, cancellation, body lengths, and partial rename | A just-bash protocol comparison, live S3/WebDAV server compatibility, calibrated throughput |

The native matrix is a separate oracle experiment, not extra just-bash passes.
Its file snapshots include bytes, directories and modes under explicit matched
umask 000; the original shell comparator asserts regular-file bytes but not
modes, empty directories, or timestamps. Reports must not merge these distinct
denominators into a fabricated total or hide the differences in assertions.

## Protocol work still required

- Publish an executable backend capability grid: required operations, optional
  operations, explicit unsupported results, and concurrency/atomicity policy.
- Exercise S3 pagination/token cycles, key-prefix collisions, range/length
  mismatches, conditional mutations, partial copy/delete, auth/status mapping,
  and cancellation across independently implemented compatible services.
- Exercise WebDAV multistatus and namespace variations, percent-encoded hrefs,
  depth, ETags, locks/tokens/cleanup, redirects/authentication, and streamed-body
  cancellation against more than local mocks. No credentials are available or
  used by this benchmark task.
- Measure memory/real/S3/WebDAV across explicit RTT, bandwidth, payload, file
  count, concurrency and failure-injection dimensions. Record request counts,
  bytes, cancellation latency, tail latency and peak memory; preserve error and
  unsupported outcomes. Identify comparator backend absence honestly rather
  than treating it as a performance win.
- Reconcile protocol results with the source-owner checkpoint and exact source
  hashes. User-reported adapter checks are attributed evidence, not reruns by
  this benchmark worker.

## Performance interpretation

Run `node --unhandled-rejections=strict --import tsx benchmarks/performance.ts`.
The optional comparator must already be installed. The report is
`benchmarks/reports/performance-pilot.json`; execution and snapshot/assertion
latency excludes setup and worker transport. Raw warmup/measured outcomes are
retained. Timings are verified only if all ten measured correctness checks pass,
the source fingerprint stays stable, and worker background errors are absent.
Pending/unsupported/incorrect workloads have no verified latency. The pilot
exits nonzero on any non-pass or source drift and never emits a winner claim.

The initial run had 264 pass/24 pending across 288 samples and source drift.
The pending samples were comparator public-text stdout on invalid UTF-8, not
confirmed byte corruption: file-byte assertions passed. That run is preserved
as `performance-pilot-initial.json` and its latency fields are not valid evidence
because source drift occurred. Current code nulls verified timing for drifted
runs. A second, source-stable run also records 264 pass/24 pending, with no
background errors: virtual-bash passes all 144 warmup/measured samples;
just-bash passes 120 with 24 pending across the two binary workloads. Measured
samples alone are virtual-bash 120 pass and just-bash 100 pass/20 pending.
In that stable pilot, text pipelines are slower for virtual-bash even where
isolated sed/awk and file-write workloads are faster. Choosing only favorable
workloads is not acceptable. Imported benchmark helpers are pinned by this
commit, but this pilot hashes only its own entrypoint, workload source, and
library source rather than every transitive harness file or the entire lock.

The refreshed full comparison in `reports/after-text-verification.json` is
source-stable: virtual-bash 105 pass/four fail; just-bash 3.4.2 103 pass/five
fail/one unsupported, each out of 109. The four virtual failures remain case,
quoted/unquoted heredocs, and here-strings. These counts cannot be added to the
separate native matrix (131/141 pass) or safety probes (20/20 pass).

Next performance work needs dedicated-host runs, confidence intervals, repeated
process-level trials, cold and persistent-shell profiles, peak RSS/external
buffer measurement, expanded agent workflows, and a documented comparison
criterion before making a broad performance or superiority statement.
