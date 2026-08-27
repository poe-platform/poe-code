# Cache-only local timing: frozen protocol, August 27, 2026

Owner: scoped TIMING AUTHOR leaf. This directory and uniquely allocated
`/tmp/sort-cache-timing-*` are the only implementation/evidence write scopes.
The explicitly requested `/tmp/sort-cache-timing-frozen.ready` is a coordination
file. Product, configuration, accepted reports and their 48 ineligible historical
mismatches remain untouched. No external comparator, native oracle, downloads,
dependency installation, private repositories, or other-process management.

## Source isolation and prerequisites

All three counterfactual packages use the complete product source/configuration
archive at `dce6e3824d6de6d03490a531cf2bc7d2d279bb8c` (A). B replaces only
`src/commands/text.ts` with accepted `08a26051438f5c6bdde100a4fe724dbb84f6fca4`
text. C replaces only that file with accepted
`b4fe4c7868b7ab7067599c6f5d10e99d143aea54` text. The committed exact A→B and
B→C patches contain the unkeyed descriptor refactor/cache and guarded single-key
cache respectively; all other source/configuration paths must match exactly.
These are synthetic cache-only packages, NOT the complete historical B/C trees
or current HEAD. Prior acceptance: `3fe952ea89034ceea784be26731581aabbb898c8`
and `b6b2e96acb7891edf3a5185fb9dea290a7de2d44`.

`freeze.mjs` creates exact fixtures, archive/text/patch hashes and inventories
without executing product commands or sampling load. Commit all harness, recipe,
manifest and compressed fixture inputs first. Publish readiness with that exact
commit before build/correctness/admission. Preparation uses only the installed
TypeScript toolchain, compiles isolated archives, packs without lifecycle scripts
with npm cache/logs inside owned scratch, then moves each package to a consumer
`node_modules/virtual-bash`. The consumer imports the public package by name.
Synchronous module hooks restrict actual product loads to that moved package,
record hashes, and reject unexpected imports. Full inventories, including added
entries, are checked before/after; build maps and all package bytes are retained.
Build, identity, or correctness failure blocks timing, with no rebaseline.

## Inputs and correctness

All literal/generated expectations are independent of the implementation and
native tools. `fixtures.mjs` is the precise deterministic recipe; the compressed
JSON input artifact and manifest bind every input, expected output/effect, script,
record count and expected logical cache charge. Every specimen runs against A/B/C
before admission, checking awaited stdout/stderr bytes, exit status and the exact
flat `/work` file map. This is narrow independent regression admission, NOT the
full accepted suite or native parity. Correctness includes precision beyond JS
safe integers, fractional signs, stable/unique/reverse, newline/NUL delimiters,
in-place effects, reused producer Buffer views, check diagnostics, and
b/f/multikey exclusions. All runs retain the existing 4MiB shell output ceiling;
this narrow fixture set does not independently stress every resource limit or
cancellation path. It does not redo the 48 mismatches.

Timing strata: 8,000-record unkeyed `-sn` and ONE effective numeric key
`-s -t: -k2,2n`, each with 8,000 distinct values or 16 repeated values, in fixed
coprime-permuted order; records remain distinct even in duplicate-value strata.
The cache is record-identity-based, not value-deduplicating. Additional fallback
strata: unkeyed 16,385 short entries and keyed 8,193 selected 21-byte values,
crossing 16,384 entries and 1,048,576 logical charge bytes respectively. Exact
boundary and boundary+1 cases for BOTH caches are correctness-only except those
two selected timing strata. A 1,024-record plain sort unchanged control is timed
for each pair. b/f/multikey/check are correctness-only unchanged controls; no
claims of timing equivalence follow. Charge is `6 * selectedBytes + 2`, not RSS.

## Load policy, frozen BEFORE observation

Local macOS `top` help/man documentation supplies metric meaning. Use
`/usr/bin/top -l 6 -s 1 -n 12 -o cpu -stats pid,command,cpu -F -R`.
Keep complete raw output, including the initial sample; discard ONLY the first
sample's interval-derived CPU fields as documented by the local manual. Require
exactly five subsequent parseable global CPU/load samples and process rows.
Missing metrics, command error, unsupported OS or nonfinite values fail closed.

At most THREE admission attempts, each with a 10-second child deadline and a
5-second gap between failures; admission phase deadline 45 seconds. No polling
outside these attempts, threshold tuning, waiting indefinitely or resampling
until fast. All five valid samples must satisfy all of:

- Absolute 1/5/15-minute loads <= 2.0 / 2.5 / 3.0; ALSO load1/CPU-count <= .15.
- Global user+system CPU <= 10%; CPU range across samples <= 5 percentage points.
- Load1 range <= .25; every visible non-controller/non-top process CPU < 25%.

CPU-count normalization alone NEVER qualifies the window. Aggregate CPU and
absolute load and variability and visible competing CPU are conjunctive. `top`
is a bounded diagnostic observer, not a thermal/per-core/frequency assurance.
Background external work may resume; quiet admission is not isolation.

On admission, one continuous owned top observer records every second. Its first
interval is discarded by the same rule. During measurement: absolute load1 <=3,
load5 <=2.5, load15 <=3, load1/CPU-count <=.20; global CPU <=20%, rolling five
CPU range <=10 points and load1 range <=.25. Non-owned visible process CPU must
remain <25%. Only exact controller, observer and currently owned worker PIDs are
exempt from the process threshold; aggregate CPU still includes them. Require
two valid during samples before the first timed call. A failed/missing sample,
observer exit, correctness failure or deadline closes admission immediately;
finish/terminate only owned children, retain ALL collected timings and report
INCOMPLETE/NOISY with no effect estimate. Post-run six-sample observation must
meet the original admission policy; failure invalidates the entire cohort.

## Measurement, bounds and reporting

Pairs are A→B for unkeyed and B→C for keyed, never A→C. Fixed profile order as
stored in fixtures. Warm: fresh worker per variant per stratum, two untimed
warmups per variant, then SIX ABBA blocks (12 observations per variant).
Fresh memory FS/reset occurs outside the exec timer; the worker/module stays
warm, while sort's per-invocation cache always starts empty. No forced GC.
Cold: only four core strata, TWO ABBA blocks (4 observations per variant), a
fresh process/import/registry for every sample. Record first exec separately
from import and parent fork-to-validated-result, which includes harness hashing,
fixture validation and IPC, NOT pure startup or OS-cache-cold performance.
No pooling cold and warm. Warm measured command elapsed time includes the whole
awaited public shell.exec and its output collection; effect inspection is outside
the timer. Retain actual execution order, every slow sample and warmup status.

Identical C locale/UTC, memory FS, `/work`, single owned stdin buffer (except the
explicit borrowed correctness fixture), public standardCommands, 4MiB output,
10,000 command/loop limits, 4096-byte pipe high-water mark, 512MiB Node old-space,
5-second command signal watchdog. Full awaited output and effects verified after
EVERY call. No per-record processes. 192 warm + 32 cold measured commands, 32
warmups, plus three times the frozen correctness specimen count; under 500 total
commands and 128MiB fixture input consumed. Each worker has a 10-second response
deadline. Preparation is <=240 seconds, admission <=45, timing <=180 including
observer/post-check; overall execution <=480 seconds. Exact owned children only
may be terminated on deadline. No servers or persistent children remain.

No outlier removal, fastest subset, adaptive repetitions or retries of failed
measurements. If complete and qualified, report all-sample min/p25/median/p75/max,
AB/BA adjacent paired log ratios and median B/A ratio per stratum/mode; no pooled
overall win, confidence claim, superiority, counter-to-speed inference, hard RSS
guarantee or broad command/backend claim. Any timing effects remain PENDING a
different reviewer routed by root. Failed admission yields TIMING DEFERRED and
zero measured samples. Freeze and evidence are separate atomic owned commits.

## Preparation-only correction before any sampling

The first frozen runner compiled A but npm rejected the author's duplicate
`/dev/null` config paths. Its immutable evidence is in `evidence/`, described by
`PREPARATION_001.md`; it consumed zero correctness calls and zero load attempts.
The second frozen runner uses distinct empty owned npm configuration files and
writes only `evidence-002/`. The failed A build is retained at
`A-preparation-001` under the same scratch root; A is re-extracted from the same
authenticated archive. No source hash, fixture byte/expectation, threshold,
measurement schedule or three-admission-attempt total changes. Both preparation
executions together remain within the original 480-second execution budget.
