# Deferred sort timing handoff — August 27, 2026

**NOT AUTHORIZED TO RUN.** Root must explicitly approve a quiet window, host-load
profile, repetitions, and a future execution owner/write scope. Curie packageTSC
and other cohorts may load this host. This is a documentation-only handoff:
zero native-oracle, benchmark, timing, build, typecheck, or test executions. The plan is
ready; an executable four-way harness is **not** ready. No operation-count result
is a wallclock win, and no historical pipeline improvement is claimed here.

## Frozen inputs

Labels below mean full committed product snapshots, not current HEAD or dirty
files. SHA256 values identify `src/commands/text.ts`:

| Label | Full source commit | Text SHA256 |
| --- | --- | --- |
| A: pre-cache | `dce6e3824d6de6d03490a531cf2bc7d2d279bb8c` | `08a27afc45d2f5a48b082cc2c979e3a13d01fbef42129bc0e72d5477d56a074d` |
| B: accepted unkeyed | `08a26051438f5c6bdde100a4fe724dbb84f6fca4` | `dfc9baed56564395bf90472fd505ea56a8eb5820712c0a5096d95ef2e2db47cc` |
| C: accepted keyed | `b4fe4c7868b7ab7067599c6f5d10e99d143aea54` | `9a66dc0e320c62aad86d78da9c55580cf6910a537a47db8a330e5122f63a1895` |

A's internal helper SHA256 is
`ade20c95a7d3dac5250a214d112ab25d710ce7909a4c6605f18ee21781949654`.
Root accepts B with independent evidence
`3fe952ea89034ceea784be26731581aabbb898c8`, and C with independent evidence
`b6b2e96acb7891edf3a5185fb9dea290a7de2d44`. Read-only evidence is in the sibling
`unkeyed-author/`, `unkeyed-review/`, `keyed-author/`, and `keyed-review/` reports.
Diagnosis `68f037111981356823ad5fa1a58943e5231ccfd4` observed source
`e090f29d9eb1aaf52eba08b2c2bf0aae53b9fb64`; its frozen21 and `ACCEPTANCE.md`
are semantic/counter prerequisites, not timing results. Collector source
`7ba5301d43345c2eb621b7df95a452a87b74e909` and independent evidence
`96e051e81312c7d33d8f4f5078efa09a4dd87947` establish the earlier campaign only.

Full A/B/C trees include unrelated committed grep-alias/runtime/column changes.
Report **whole-command/full-snapshot** differences honestly. The inspected
historical harness overlays only its old collector prototype; it does not offer
a same-runtime A/B/C cache-overlay mode. Such a counterfactual requires separate
root authorization and a frozen explicit source-only delta, identical surrounding
runtime, rebuilt artifacts and separate results. Never silently attribute
full-tree differences to sort or pool counterfactuals with actual packages.

**D: published just-bash 3.4.2.** Reuse `benchmarks/node_modules/just-bash`
only after reauthentication against all 955 published files, not version alone.
Authentication commit: `010411eff3dd210b9575e061914efccd65c13547`, directory
`benchmarks/reports/comparison-fairness-20260827/published-artifact-authentication/`:
`published-files.json` and `registry-metadata.raw.json`. Prior independent
`evidence/preparation.json` records:

- Tarball SHA256: `f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d`.
- Published file-list SHA256: `75347f6df092ddf527dff58da2c1d3d58071764b20b3f1e5f55048101c4a4c9d`.
- Loaded `dist/bundle/index.js` SHA256: `70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c`.
- Prior tarball locator: `/private/tmp/safe-bash-published-auth-JydnQ4/just-bash-3.4.2.tgz`;
  availability is **not checked here**. Missing authentication material blocks
  reuse; no install, download, or ambient dependency substitution is authorized.

## Existing recipes and eligibility

Reuse exact `evidence/workloads-native.json` from the independent collector report
at `96e051e81312c7d33d8f4f5078efa09a4dd87947`. Its committed SHA256 is
`fbe44160ba609de854c3434144cf7bdfc87aa046950dd0c55211f835a1f2767c` (JSON
compaction differs from the original captured hash; preserve both manifests).
Do not recapture native expectations or regenerate inputs with changed sizes.

Prior externally eligible IDs: `historical-sort-uniq-5000`, `plain-5000`,
`unique-paths-20000`, `reverse-logs-12000`, `numeric-stable-8000`,
`numeric-key-8000`, `in-place-5000`, `tiny-32`. The historical pipeline is a
control, not evidence that either cache fixes its gap. Preserve
`unicode-8000` and `invalid-bytes-8000` as comparator-ineligible: their **48**
historical mismatches remain visible within **720** measured calls, with original
base240/240, collector240/240, comparator192/240. Never rewrite this denominator.
They may be own-source-only controls if root approves, not external speed wins.

Before timing, every intended pair A/B, A/C, B/C, A/D, B/D, C/D must match the
frozen expected stdout **bytes**, stderr **bytes**, exit status, and complete
observed `/work` file map (extra/missing/changed paths fail). Check `in-place`
final `input` bytes as well as stdout. Recheck every measured call; a new mismatch,
exception, timeout or incomplete capture excludes that pair's timing claim, not
the failure from the report. Prior eligibility does not certify A/B/C now.
The old oracle covers flat regular files under `/work`, not metadata, empty
directories or outside-root effects; label those unmeasured, never claim full
filesystem equivalence. An effect-scope extension needs a disclosed adapter.

## Inspected commands, and the missing adapter

All commands below are **future-only**, from the repository root unless noted.
Uppercase variables are operator-supplied placeholders, not supported new flags.
No command here starts an approved A/B/C/D campaign.

Read-only historical evidence check (existing CLI; no native recapture):

```sh
node benchmarks/reports/sort-performance-independent-20260827/seal.mjs --check
```

That check authenticates listed paths and committed integration, but does not
reject newly added evidence entries. Future input inventories must enumerate
names too. Never invoke this seal without `--check`: its other mode writes the
accepted directory. Do not rerun other accepted report writers in place.

Existing isolated setup primitives, as used by `keyed-review/harness.mjs`
(`SOURCE_REF` = exactly A, B or C; `RUN_ROOT`/`BUILD_DIR` = fresh owner-controlled
paths; `REPO` = this repository; precreated build directory and authenticated
toolchain link required). These are primitives, **not** a complete prepared
timing layout or a moved-package admission check:

```sh
git archive "$SOURCE_REF" src package.json tsconfig.json tsconfig.build.json > "$RUN_ROOT/source.tar"
tar -xf "$RUN_ROOT/source.tar" -C "$BUILD_DIR"
(cd "$BUILD_DIR" && node --max-old-space-size=512 "$REPO/node_modules/typescript/bin/tsc" -p tsconfig.build.json)
(cd "$BUILD_DIR" && npm pack --ignore-scripts --json --pack-destination "$RUN_ROOT")
```

Existing historical CLI surfaces, inspected in `sort-performance-20260827/`:

| Stage | Actual command | Why it is not the requested ready runner |
| --- | --- | --- |
| Setup | `node benchmarks/reports/sort-performance-20260827/prepare.mjs` | Hardcodes old source `6e99656dd9d6e285b33fb3cf99ed5fef19146a48`, old tarball locator and two product trees; copies native tools. |
| Fixture preflight | `node benchmarks/reports/sort-performance-independent-20260827/fixtures.mjs` | Runs native sort/uniq; replace with authenticated frozen fixture reuse, not a new oracle run. |
| Timing | `node benchmarks/reports/sort-performance-20260827/measure.mjs` | Fixed base/candidate/baseline, 15 warmups, 18 warm and 6 cold samples; no revision, repeat, filter or four-way CLI flags. |
| Report | `node benchmarks/reports/sort-performance-20260827/summarize.mjs` | Fixed three variants and base/candidate ratios; does not filter unequal outcomes from timing statistics. |
| Cleanup | `node benchmarks/reports/sort-performance-20260827/finish.mjs` | Assumes old collector-only patch, reruns patch controls/native versions and removes its old scratch layout; unsuitable here. |

Historical scripts use `SORT_REPORT` as a new output directory and `SORT_STATE`
as a **file containing the scratch root**, not as that directory. Defaults can
target old evidence: never omit these for a future authorized adapted runner.
`worker.mjs` uses `SORT_ROOT`/`SORT_VARIANT` internally through `session.mjs`;
it is an IPC child, not a standalone preflight CLI. General `npm run benchmark`
is the broader correctness corpus, not this timing protocol.

Minimal future adaptation, in a separately assigned new subtree: bind three
immutable archives and authenticated D to the existing worker protocol; reuse
frozen fixtures; add non-measured equality admission; parameterize variant order
and root-approved repetitions; gate pairwise reports on equality and interference;
capture inventories/loaded hashes and settle every child on every failure path.
Preserve old tooling unchanged. Freeze/review the adapted command before running.
There is **no existing complete setup/preflight/run/report CLI for four versions**.

## Schedule, profile and reporting

- Run sequentially, never competing timing workers. Four-way balanced crossover
  block: **A B D C / B C A D / C D B A / D A C B**. Each variant occupies each
  position once and each directed neighbor pair occurs once. For approved
  own-only controls use all six A/B/C permutations, not a partial block.
  Root chooses repeat counts in whole balanced blocks; historical 15/18/6 are
  descriptive, not permission for a new campaign. Record actual order/block IDs.
- Match scripts, exact input/file bytes and deterministic recipe arithmetic
  (no new seed), single-buffer stdin, fresh fixture reset, memory FS, cwd `/work`,
  C locale/UTC and environment, 4MiB output, 10,000 command/loop budgets, 5s
  deadline, 512MiB V8 old-space flag and ours' 4096-byte pipe high-water mark.
  Preserve comparator byte API/rawScript handling; don't pretend it exposes
  identical internal chunking controls. No changed limits for speed.
- Warm: existing long-lived worker/shell, matched per-recipe warmup and explicit
  GC policy, fixture reset outside timer, public `shell.exec` only inside timer;
  equality/effect inspection outside timer. Cold: fresh child/import/registry
  per sample, first workload exec separately from parent fork-to-result and
  import/setup. This is process-cold, not flushed OS caches or cold hardware.
  Never pool warm, first-exec and end-to-end timings.
- Before/after the run, record OS/release/arch/CPU/memory, Node/version flags,
  compiler version and entry/runtime hashes, npm/package/lock identities, source
  archive/tree inventories, emitted/package hashes, actual loaded-module paths
  and hashes, comparator files and harness/fixture hashes. Reject live-source
  fallback. Compare complete before/after names and hashes to detect additions;
  reject unexpected symlinks. Historical Node22.22.2/TS5.9.3/Darwin arm64 is a
  prior profile, not an assertion about a future host.
- Root must approve numeric load thresholds and known cohost activity before
  scheduling. Record load averages and process/activity snapshots at admission,
  around each paired block, and after exit. Curie/packageTSC, build/test activity,
  a threshold breach, thermal/power change or unknown interference invalidates
  the **whole affected matched block**, regardless of which version benefits.
  Keep its raw rows/reason; pause, and rerun only with root approval in a new
  attempt. Do not kill foreign jobs or selectively discard slow samples.
- Write exclusive new captures; preserve failures, exclusions, schedules and
  original evidence. Report per-workload eligible denominators, paired ratios
  and dispersion for A/B, A/C, B/C and each eligible D pair; distinguish sample
  counts from durations. RSS/heap snapshots and lifetime maxRSS are not command
  peaks or hard memory bounds. No general speed, parity or superiority claim.

## Ownership and cleanup

This leaf owns only this new `timing-plan/**` subtree and
`/tmp/sort-timing-plan-*` markers; all product, configuration, dependencies, old
reports/seals and foreign staging remain untouched. Only this document is
committed, with `git commit --only` and its explicit path. Validation is static
path/CLI inspection and scoped `git diff --check`, not execution evidence.

No child workers, servers or scratch execution trees were started here. Retain
`/tmp/sort-timing-plan-ready.txt` for root; after consuming it root may remove
that exact marker with `rm -- /tmp/sort-timing-plan-ready.txt`. No wildcard
cleanup. A future execution owner must record its exact allocated paths/PIDs,
dispose shells, close IPC, await child close (including startup failures), clear
watchdogs, preserve final captures/integrity checks, then remove only those
recorded scratch paths. Do not reuse historical `finish.mjs` as generic cleanup.
Release this documentation scope after commit/marker publication; root owns the
quiet-window decision and separately delegates any adapter or actual timing.
