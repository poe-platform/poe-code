# Independent current-source comparison replay

Completed August 27, 2026; awaiting root and independent final review. No staging
or commits. This directory is new evidence; prior current-integration and
expanded-comparison history was not changed.

Post-execution qualification: `CAPTURE-LIMITS.md` and
`capture-qualification.json` govern the call-budget and capture-proof claims.
The prior text is retained byte-exact in `README.pre-qualification.md`.

## Result and scope

| Profile, 224 original cases once each | virtual-bash pass/fail | just-bash 3.4.2 pass/fail | Lifecycle |
|---|---:|---:|---|
| Original, harness `0294afb`, native-corrected golden | 222 / 2 | 155 / 69 | PASS |
| Scratch-aligned, harness `d1b10a3`, separate aligned golden | 223 / 1 | 155 / 69 | PASS |

No timeouts, engine/harness errors, invalid-oracle cases, skips or pending cases.
The two profiles used **identical product source and dependencies**. Every exact
stdout/stderr/status/fixture-entry observation agrees between profiles for both
engines: 448/448 row/engine pairs. Only the separately documented native golden
delta changes a score; do not call the additional pass a product fix.

The historical author evidence `8e09db9`/`d484f98`, frozen product `bd2cacb`, remains
**206/18 versus 155/69**. Compared with that original-profile history, this new
source changes 17 product observations, including 16 fail-to-pass changes and
the still-failing original patch dry-run. Baseline observations are unchanged.
These numbers are not a full product gate, backend interoperability result,
performance result, or proof of the user's “much better” requirement.

## Exact remaining failures

- `kernel/type/type`, both profiles: expected `builtin\nfile\nfunction\n`, actual
  `command\ncommand\nfunction\n`. Status, stderr and VFS effects match. Route to
  root's shell/introspection owner (historical Sagan). This is an architectural
  command-classification profile mismatch; do not falsely label registry plugins
  as shell builtins to manufacture parity.
- `command/patch/dry-run`, original only: expected an extra empty `tmp` directory
  inside the fixture; product does not create it. All bytes and status match.
  Route to benchmark/fairness owner, not an instruction to add a fake product
  directory effect. The original native harness set TMPDIR to a nonexistent
  fixture child. Aligned harness precreates external scratch for each engine;
  its separately committed native golden drops only this empty directory.

All 69 baseline nonpasses per profile remain exact failures: 18 target six absent
baseline names; 11 have returned-byte patterns consistent with UTF8 encoding of
the expected latin1 view; 40 other exact profile mismatches remain unwaived.
`failure-routes.json` retains **141 per-profile/per-engine nonpass records**, each
with exact case ID, script, input, expected and actual byte fields, stderr,
status, fixture effects, assertion fields, and owner route. `FAILURE_ROUTES.md`
is a scan-friendly index. This classification is not a substitute for the other
leaf's baseline-only union/fairness assessment.

## Source identity and isolation

- HEAD at freeze: `c2902a6016dd4a42818e27d055895c0dc29f73f2`, **dirty**, not a
  committed-only snapshot. Source-manifest digest:
  `76deb591783ac168ca5daef04c4351d7e80b159c003cd27d3a445190ca6fd74c`.
- 176 source/config files: tracked source plus seven untracked
  `src/commands/stream-inspection/**` files. Dirty tracked source includes
  `src/commands/safejs/README.md`, `src/commands/safejs/index.ts`,
  `src/shell/parser.ts` and `src/shell/runtime.ts`. The preliminary plan's short
  parser/runtime description was incomplete; `source-manifest.json` always
  retained the full status and hashes. No private runtime, SafeJS plugin work,
  SafeJS tests or S3 HTTP tests were executed. Public adapter module definitions
  can be imported by the public entry without invoking the optional plugin.
- Retained regular-file freeze:
  `/private/tmp/safe-bash-comparison-replay-20260827-EuLV2d/product`.
  All 4,046 source/dependency/harness/golden/audit files are content-unchanged
  across controls and both profiles, regular files and read-only at final check.
  No symlink or import aliases point to live source.
- Existing dependency trees copied **once** with per-file before/copy/after
  equality. Installed package versions and hidden-lock integrity metadata agree
  with locks: 7 root development packages, 81 isolated comparator packages.
  No install, download, runtime dependency addition or registry tarball
  revalidation occurred. `dependency-manifest.json` gives exact provenance.
- `source-harness-goldens.tar.gz` preserves source/config, both harness profiles,
  byte-exact goldens and audit entrypoints. SHA256:
  `47b9a6d61ac3b26cf93c5e59c805406cc07395c5b08d8ded8945e820954d0f73`.
  Dependency regular-file copies remain in the retained freeze, not the archive.
- `live-after.json` explicitly separates later live changes from this tested
  freeze. Later integration work, including new command registration, receives
  no score credit here.

## Harness and oracle provenance

Original executed case modules are exact committed blobs from
`0294afb6e690433aed994868e5ed437ecf58ae48`, the harness recorded by the historical
author run. Corrected modules are exact blobs from
`d1b10a375a13f031f9f604a64395cd507f21a071`. The new driver changes only orchestration:
it selects the current dirty regular-file snapshot instead of `git archive`,
uses copied dependencies, adds process/import supervision and does not launch
automatic performance. Recipes, comparison assertions, engine/session code,
inventory checks, loopback server, alternating ordering, and the existing
24 uninstrumented neutrality controls remain unchanged.

Golden SHA256 identities:

- Original `native-corrected/native.json`:
  `976601e3aeb465fcb5eb11e53e9e61e48978d148e8615a9ee37c2261743df801`.
- Aligned `native-scratch-aligned/native.json`:
  `e305e1c3f3fa15e0f53699808c1cb20ea156c80b8ceff6d98835888ea5c57bb8`.
- Historical defective first capture, retained but not used for scoring:
  `9bc0295c3a7b53f6bbc7cbc722039a04f85489e40735a75fb81e6171b83061d9`.

All 228 golden recipe hashes are retained, although only the 224 functional
recipes were executed. Across goldens all stdout/stderr/status bytes match;
only patch dry-run's empty directory entry differs. `profile-delta.json` seals
this separately from `scratch-profile-commit.patch` and product/dependency seals.

Captured native profile is GNU Bash 5.3.0/coreutils 9.7 on Darwin, GNU sed 4.9,
gzip 1.14, tar 1.35, diff 3.12, patch 2.8, plus individually identified native
utilities including Apple jq 1.7.1, awk 20200816, curl 8.7.1 and rg 15.2.0.
This is **not GNU/Linux or uniformly GNU**. Full executable hashes and captured
version outputs are in `oracle-identities.json`. No current native oracle was
invoked or recaptured; committed native bytes, not current binary availability,
are the oracle for this replay.

## Execution checks

- Existing bounded harness controls: **15/15**, with four engine startup/shutdown
  handshakes. No functional224 run occurred during controls.
- Instrumentation neutrality: **24/24 per profile**, plus **nine baseline
  transport calls per profile**, separate from 224 scores. This exact subset
  budget was not fully declared in the initial plan; its disclosure and root
  disposition are post-execution, not retroactive preapproval. These add no
  unique coverage and do not replay a full224. See `CAPTURE-LIMITS.md` for the
  complete observed/inferred budget, including empty initialization calls.
- Actual default inventory: **56**, required unshadowed registry dispatch
  **53/53**, plus curl dispatch in **8/8** network cases. The unchanged inventory
  assertion passed; no stale count was edited. Curl is not default registered.
  The seven untracked stream-inspection files are not aggregate registrations
  and are not credited as new command coverage.
- Transport controls: **8/9 per profile**. The one baseline terminal invalid-UTF8
  output mismatch is retained. The same binary input survives internal piping
  to base64 and writing to VFS. Do not reinterpret API byte-tag behavior as
  internal cat/gzip/curl corruption.
- Functional workers: **26 per profile** (two persistent scoring workers plus
  24 fresh neutrality workers), **310 distinct attempted module files per
  profile**. The loader logs before `nextLoad` and has no resolve hook; this is
  not proof that all310 modules evaluated or a complete CJS/WASM asset trace.
  Attempt paths/hashes match the freeze. Successful chosen entry imports are
  specifically supported by sealed startup-handshake flow and observations.
- All phases exited 0. Existing logs show all56 engine-child exits as expected
  session-close `SIGTERM`, no timeout/escalation trigger and zero residual/leaked
  children observed. This is bounded managed-session/process-group cleanup PASS,
  not voluntary guest-worker/thread cleanup. There are no OS birth identities,
  termination-purpose/request events, PID-linked request ledger or independent
  socket/listener event monitor; see `CAPTURE-LIMITS.md` for the bounded proof.
- Scrubbed host env, owned HOME/TMPDIR and explicit `127.0.0.1` loopback binding;
  both products use fresh memory FS and declared cwd/env/limits. Fixture byte,
  type/link and selected mode assertions are exact. No ambient credentials,
  external services, native product processes, or unowned fixture directories
  were used. This does not establish general network confinement or real-provider
  behavior. See `setup.json`, `network-binding.json` and `network-requests.json`.

## Attempt history and commands

`EARLY_PLAN.txt` preserves the pre-run plan. `prepare.mjs` copied and verified
source/dependencies, then hit Node's default git-show buffer on the large
historical first golden. `prepare-attempt-1.json` preserves this **pre-case setup
failure**. `seal.mjs` resumed only unfinished harness/golden copying with a 64MiB
buffer, verified the retained files, and never recopied source or dependencies.
No scoring failure was retried; each profile's 224 ran exactly once.

Executed from repository root:

```sh
node benchmarks/reports/current-integration/comparison-replay-20260827/prepare.mjs
node benchmarks/reports/current-integration/comparison-replay-20260827/seal.mjs
node benchmarks/reports/current-integration/comparison-replay-20260827/supervise.mjs controls
node benchmarks/reports/current-integration/comparison-replay-20260827/supervise.mjs original
node benchmarks/reports/current-integration/comparison-replay-20260827/supervise.mjs scratch-aligned
node benchmarks/reports/current-integration/comparison-replay-20260827/audit.mjs
```

Each supervisor's exact Node argv, cwd, scrubbed env, process group and deadline
are recorded. Outputs use exclusive creation. **Do not rerun224 for review**;
inspect the retained source/archive and JSON/log artifacts. Any authorized future
replay needs a new owned output directory and independently identified source.

## Performance decision for root

No performance execution is authorized by the current qualification handoff.

**Not run.** The historical 30 matched trials were five repeats × two engines ×
three eligible workloads, not 30 sort trials. Existing `expanded/run.mjs` has no
performance-only selector and would repeat224 plus the entire matrix. Existing
`expanded/sort-review.mjs` hardcodes old `b5ec52a`/`f3eb0fe` derived sources and
18 three-way trials; it cannot certify this current freeze unchanged. The older
`benchmarks/performance.ts` runs another complete matrix with a fixed output.

Root could authorize a new owned bounded *orchestrator* that reuses the unchanged
four existing performance recipes and frozen engine modules once, preserves
eligibility failures, five paired trials per eligible recipe, one warmup,
alternating order and child cleanup. Eligibility may differ, so 30 must not be
promised. No new workload, automatic double matrix, or such execution is claimed
here. Functional observation timing/memory fields are raw data shape only and
provide **no performance claim**.

## Reviewer entry points

Start with `summary.json`, `final-integrity.json`, `profile-delta.json`,
`historical-delta.json`, `failure-routes.json`, then both profile `lifecycle.json`,
`imports.jsonl`, `functional.json`, `dispatch.json` and control artifacts.
The other fairness leaf owns baseline-only union and primary-manifest review.
Root handoff: `/tmp/safe-bash-comparison-replay-detail.txt`.
