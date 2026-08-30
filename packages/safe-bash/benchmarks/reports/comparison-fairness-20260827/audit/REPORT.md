# Independent comparison fairness audit

Audit date: August 27, 2026 UTC (August 26 local America/Chicago during collection).
Scope: read-only independent evidence review; no product/native recipe execution,
224 replay, dependency installation, golden change, staging or commit by this leaf.
Additional different-leaf verification of recommendations and final scores remains required.

## Decision

The expanded comparison is defensible as a **bounded, exact mixed-native-profile
comparison**, not broad superiority or complete Bash/utility/backend compatibility.
The d1b10a3 scratch correction has independent native grounds and retains exact
fixture assertions. Accept it only as a separately identified profile, never a
retroactive improvement to historical results or a product fix.

Keep the baseline-only complement in its own table. There is no defensible additive
union score in the supplied evidence: frozen product sources, profiles, predicates,
optional configurations and semantic units differ. `overlap.json` maps all 68
breadth recipes/diagnostics to concrete recipes and profiles; 42 have related
expanded candidates, none has identical script text, and neither fact is a
semantic deduplication proof. No union denominator is computed.

## Recomputed evidence

| Expanded cohort, each 224 recipes | virtual-bash pass/fail | just-bash 3.4.2 pass/fail |
|---|---:|---:|
| Historical bd2cacb, harness0294afb, native-corrected | 206 / 18 | 155 / 69 |
| New integration freeze, original harness/profile | 222 / 2 | 155 / 69 |
| Same integration freeze, d1b10a3 scratch-aligned | 223 / 1 | 155 / 69 |

All three tables recompute from stdout, stderr, status **and final fixture entries**.
Each has zero recorded timeout, invalid-oracle or harness/engine-error cases.
Historical author8e09db9 and summaryd484f98 are not current-source evidence.
No original history is changed. `verification.json` records20 successful aggregate
checks plus per-row assertions; `verify.mjs` is a static artifact checker, not a
product test runner. `replay-review.json` contains the new raw score reconciliation.

The new source is a dirty integration freeze captured at HEAD
`c2902a6016dd4a42818e27d055895c0dc29f73f2`, **not that commit alone**:
sourceTreeSha256 `76deb591783ac168ca5daef04c4351d7e80b159c003cd27d3a445190ca6fd74c`,
176 selected files including seven untracked stream-inspection files and dirty
tracked source. Both profiles use that same copy. There are **zero differences in
product stdout/stderr/status/fixture entries across profiles** for either engine;
the one-point score delta comes solely from the native dry-run scratch expectation.

The replay's original and scratch-aligned outer supervisor gates report PASS,
with no recorded remaining/leaked process,4046 frozen files unchanged and310
unique observed modules/3096 load events per phase, no outside or wrong-byte import.
Both24-row neutrality-control sets independently recompute as equal. These are
outer supervisor/import observations, not a claim that every inner child exits
normally by itself: unchanged `session.close()` deliberately SIGTERMs persistent
benchmark workers. The replay's earlier ENOBUFS git-capture preparation fault is
preserved in `prepare-attempt-1.json`; it precedes any case and is not a feature loss.

| Separate baseline-only complement | Ours strict operational positives | Baseline strict operational positives |
|---|---:|---:|
| 50 default target recipes | 0 | 45 |
| 54 targets including four optional names | 0 | 47 |
| 61 primary recipes including overlap/controls | 7 | 53 |

These rows are nested, **not additive**. 61 primary =54 targets +3 historical
source/dot/eval controls +4 shared controls; seven diagnostics per engine bring
the total to68 recipes ×2 engines =136 distinct observations, not136 workflows.
All136 author/reviewer raw status/terminal fields and stable whole-root before/after
censuses agree under independent recomputation. There are135 normal child exits;
baseline `js-exec-positive` returns guest0/`42\n` but retains resources beyond
cleanup grace and receives SIGTERM. It is **not** the48th clean target positive,
not missing startup, and not an execution-timeout diagnosis.

The complement source `30f5cfb47f69af0aeb4460fa901904d0b70f4ca8594013f70aa308dafb379732`
is a **source-tree SHA256, not a Git commit**. Its source-captured HEAD is14b872c;
attempt002 manifest HEAD98de827 is another identity. Author849dbf1/reviewe0325b5
publish/review this freeze, not the new replay freeze. Reviewer recovery preserves
12 captures, launches124 continuations, and records137 total launches for136
complete distinct observations plus one lost-delivery launch with unknown product
phase. Neither failed delivery nor diagnostics increases semantic coverage.

## Dispatch, configuration and effects

- Expanded ours imports frozen `src/index.ts`, creates public Shell/registry and
  uses `agentCommands()` once. Curl is explicitly added only to network recipes.
  Baseline imports installed `dist/bundle/index.js`, exactly the manifest ESM entry,
  uses real Bash/InMemoryFs and explicit network configuration. No fake command or
  native product fallback is present in the inspected harness.
- Historical inventory56 registrations includes three kernel-shadowed names
  true/false/pwd. Actual registry events reach53 unshadowed implementations plus
  curl; baseline reaches48 of83 registered implementations plus curl. The
  classifier lists, kernel dispatcher extraction and registered names are distinct.
  Baseline kernel extraction/private registry wrapping is version-specific;
  24 controls support only the selected instrumentation-neutrality cases, not all
  possible kernel paths. `type -t` does not justify calling registry tools builtins.
- Each case gets a fresh memory filesystem and shell, cwd `/fixture`, fixed file
  content/times and specified modes. Historical functional cases share long-lived
  engine processes, not shared VFS state. There is no real/S3/WebDAV provider test.
  Native files live on Darwin's actual filesystem under normalized paths.
- Guest PATH/HOME/LANG/LC_ALL/TZ are explicit; original virtual TMPDIR is omitted.
  Native uses a role-bin-only PATH, its actual HOME/cwd and `umask022`; outputs and
  file bytes normalize role paths/origin. This is role alignment, not literally
  identical environment strings, executable lookup implementation or host state.
  d1b10a3 explicitly gives both virtual engines preexisting `/tmp` and TMPDIR=/tmp.
- Original `session.mjs` inherits host process.env and references live development
  dependencies. Product git archive hashes are strong; baseline manifest/bundle/
  lock hashes alone do not freeze every dependency or prove actual module loads.
  Replay improves this through copies, scrubbed host environment and load tracing.
  Those are disclosed orchestration changes, not unchanged historical host setup.
- Expanded budgets:4MiB output setting,10000 commands/loops,5s guest signal;
  baseline also5s execution limit/4s network timeout, ours4096-byte pipe watermark;
  child startup15s, request10s,256MiB old-space cap. Native combined stdout/stderr
  cap4MiB and8s wall deadline differ. Settings are not identical internal budget
  semantics, and family defaults remain their own limits. No limit failures occur
  in these tables; do not generalize resource-exhaustion equivalence.
- Exact fixture snapshot includes recursive names/types, file bytes, symlink
  targets, and modes only where `specimen.modes`; max4096 entries/depth32/32MiB
  total,4MiB/file. It omits `/fixture` root metadata, outside-fixture/scratch effects,
  most timestamps, ownership, device/inode authority and remote operations.
  Root/path/origin projection is applied to output **and file bytes**, so equality
  is exact after declared projection, not unprojected host bytes.
- Public baseline stdout uses exported byte helpers; stderr is public UTF-8 text,
  while ours exposes byte arrays. Transport controls distinguish terminal byte-tag
  failures from internally preserved pipe/file bytes. Do not erase terminal
  failures or infer internal corruption from them. Conversely breadth's generated
  binary file control has a real file-byte mismatch: it is not terminal-only.
- Expanded loopback tests cover eight curl workflows with explicit policies,
  same-origin redirect and fixed authorization. They do not prove external
  provider interoperability, cross-origin credential protection or confinement
  against adversarial redirects. Breadth curl instead uses baseline injected
  SecureFetch and ours public Node transport with exact GET/URL policy; providers,
  fixture bytes and expectations differ from expanded binary curl recipes.
- Breadth has whole-root raw censuses, but its positive predicate checks declared
  output/status/file requirements and input preservation, **not identical full
  cross-engine effects**. Modes0666/0644 in shared file outputs remain visible.
  Budgets100 commands/loops,30s ordinary/120s optional, different HOME/USER/default
  modes and explicitly enabled JS/Python profiles prevent profile union. No private
  SafeJS runtime was loaded; absence of four compatible CLI names does not prove
  that separately named SafeJS cannot execute code with legitimate hooks.

## d1b10a3: assertion and native-ground audit

The diff changes environment/scratch setup, capture/default oracle paths, controls,
documentation and tests. It does **not** alter recipes or `compare()`'s four exact
fields, ignore an entry, relax stderr, or synthesize a product directory effect.
Independent comparison confirms228 unique valid native observations in each
capture, identical recipes, recipe hashes, native tools and all terminal fields.
Only `command/patch/dry-run` loses an empty `tmp` directory from native final entries.

Native control evidence shows nonexistent fixture TMPDIR remains absent under
noop but GNU patch2.8 creates it during dry-run. With a preexisting external
scratch directory, noop and patch have the same asserted fixture entries and
external scratch is empty. The correction aligns a harness prerequisite rather
than changing patch semantics to fit the product. Outside-fixture scratch is
still outside the general assertion boundary; the targeted control is not a
universal scratch-cleanup guarantee.

One assertion really was removed: historical capture source hashes no longer
must equal newly edited live capture source. A new capture-to-live-source check
replaces it, together with exact one-row delta checks. This is a reasonable
versioning adjustment, not a dropped behavior assertion; this audit independently
checks **both** historical and new source hashes against their respective Git
blobs and checks historical goldens remain byte-identical to the published commits.
For future maintenance, retain version-specific provenance checks rather than
requiring old evidence to equal new source. No golden edit is proposed here.

## Native and package provenance

Native-corrected and scratch-aligned carry identical individually hashed tool
identities: Bash5.3.0(1)-release for aarch64-apple-darwin25.4.0; GNU coreutils9.7,
sed4.9, gzip1.14, tar1.35, diffutils3.12, patch2.8; Apple awk20200816,
BSD grep2.6.0-FreeBSD, Apple jq1.7.1-apple, xxd2025-08-24, curl8.7.1 and
ripgrep15.2.0. `/usr/bin/find` and `/usr/bin/xargs` reject `--version`; their
paths and SHA256s are recorded, **not fabricated GNU version numbers**. Exact
resolved paths, hashes and version stdout/stderr/exit are in native JSON
`toolIdentities`, validated with frozen capture-source hashes in `verification.json`.
These are historical captured executable identities, not a claim every native
binary is still available/re-executed today, nor GNU/Linux semantics on Darwin.

At2026-08-27T04:47:47Z, read-only official npm pinned-version metadata matches the
lock resolved URL and SRI:
`sha512-T0Vpy7YRgCjxJdqG3tkxn0ZnIDLJvVwb8hH4L+6NVdp+Te27jQxjxnszW9ODjEKbWxWujj83rP5S0GQxCSufgg==`.
GitHub official tag `just-bash@3.4.2` resolves to
`a021f95f53f7e01df48dab71b46ffd4637fb4b53`; its package manifest and registry agree
with installed manifest on nine inspected identity/dependency/engine fields.
Installed manifest/bundle/lock hashes match historical expanded records. All3510
installed benchmark dependency-tree entries match breadth's frozen entries with
no extra path. `provenance.json` records primary request URLs/status/body hashes,
exact manifests/integrity fields and the comparison details.

**Tarball authenticity remains unverified.** No matching cached tarball was found
in the checked permitted `/tmp` npm caches; no home cache/private files, package
download, install or external write was used. Metadata/lock and installed-tree
agreement do not authenticate installed bytes against the registry tarball.
Registry signatures/attestations are recorded metadata, not verified signatures.
No latest/current-release claim is made; only pinned3.4.2 is audited.

See `release-claim-review.md` for the separate historical/current release-wording review.

## Performance: historical pilot only

Original30 trials =3 eligible workloads ×2 engines ×5 repeats, **not30 repeats
per workload**. Four candidates were gated by exact output/status/fixture effects;
binary256KiB failed baseline byte equivalence and has zero timing trials. All30
measured trials independently match their native observations. Five-sample
medians recompute as follows:

| Historical workload | Ours median ms | Baseline median ms |
|---|---:|---:|
| sed10000 | 51.086 | 113.102 |
| sort5000 | 38.022 | 5.680 |
| awk10000 | 20.899 | 36.840 |

Each measured child is fresh, imports/setup happen before timing, executes one
warmup on the same fresh shell/VFS, then GC and execution timing. Order alternates
within deterministic repetitions, not randomized independent host allocation.
Execution excludes import/setup/warmup/snapshot/disposal; process maxRSS includes
startup/setup/warmup and TS-source-versus-installed-bundle overhead.2ms sampled
RSS/heap/external can miss synchronous peaks; five-sample p95 is simply the max.
Hardware recorded: Apple M5 Pro16 cores,24GiB, Darwin25.4.0 arm64, Node22.22.2.
Load averages start5.60/5.64/5.69, end5.02/5.51/5.64; per-trial loads are retained.
This is a cohost-loaded pilot with limited repetitions, not an isolated throughput
or full-workload speed/memory study. Baseline is faster on this sort recipe;
ours is faster on these sed/awk recipes. Neither implies broad superiority.
The new integration replay runs no performance cohort and establishes no new
speed result; functional elapsed fields must not be repurposed as one.

## Concrete next work, routed by root

| Evidence scope | Case IDs | Interpretation / action |
|---|---|---|
| New aligned integration freeze | `kernel/type/type` | Only ours non-pass: command/command/function versus native builtin/file/function. Shell/API classification decision; do not fake builtin labels to green a score. Preserve strict mismatch; separate any taxonomy-aware comparison proposal for native-ground review. |
| New original profile only | `command/patch/dry-run` | Exact entries mismatch from historical native scratch setup. Product terminal/effects identical across profiles. No fake `/fixture/tmp` product fix. |
| Historical bd2cacb, now passing in new raw replay | `command/realpath/relative`, `command/wc/words-lines`, `command/wc/unicode`, `command/env/clean`, `command/env/unset`, `command/cksum/algorithm`, `command/stat/timestamp` | Keep old evidence. Env/unset was a real clean-env propagation leak, not just ordering; env/clean ordering is profile-specific. C-locale wc is not UTF-8 semantics. Passing bounded recipes is not full utility closure. |
| Historical bd2cacb, now passing in new raw replay | `command/patch/apply`, `command/patch/reverse`, `composition/patch-hash/patch-hash`, `kernel/executable-file/executable-file`, `kernel/env-shebang/env-shebang`, `kernel/source/source`, `kernel/dot/dot`, `kernel/eval/eval`, `kernel/parameter/parameter` | Route deeper stress only through current owners; these old failures are not current failures. Patch-hash/source/dot demonstrate why stderr/effects matter even when last command masks failure status. |
| New baseline expanded non-pass candidates | `command/cut/bytes`, `command/xargs/batch`, `command/xxd/reverse`, `command/patch/apply`, `network/curl/post-stdin` | Exact failing fields are in `replay-review.json`. Diagnose unsupported options, actual effects and public byte boundary independently; do not classify all69 as missing implementations. |
| Separate breadth source30f5cfb | `expand-positive`, `fold-positive`, `strings-positive`, `tac-positive`, `compopt-positive` plus `compopt-direct-diagnostic`, `mapfile-positive` plus direct diagnostic | Missing compatible dispatch is confirmed in that freeze only; untracked implementation files in later source do not establish published/default registration. Root can route current dispatch/workflow holdouts without claiming old results are current. |
| Separate baseline breadth limitations | `exec-positive`, `compopt-positive`, `tree-positive`, `js-exec-positive`, `node-positive`, `help-positive`, `wait-positive` | Preserve tail-effect/option semantics failures, strict tree display mismatch, guest-success/cleanup failure, diagnostic stub, informational/no-op exclusions. No silent pass conversion or denominator inflation. |

No production/golden fix is authored. Any future oracle/predicate correction must
start with explicit native or primary API grounds, retain original inputs/results,
publish a separate profile and receive a different reviewer's approval. Broader
provider workflows, public built-package consumption and security/resource cases
remain separate evidence needs. No superiority, universal parity,72-hour duration
or full-product completion claim follows from this audit.

## Reproduction and handoff

Run `node benchmarks/reports/comparison-fairness-20260827/audit/verify.mjs` for the
bounded static historical/breadth verification only; it performs no product/native
execution. New replay checks and primary retrieval were performed with owned
`/tmp/safe-bash-fairness-replay-check.mjs` and `/tmp/safe-bash-fairness-provenance.mjs`;
their bounded results and input hashes are persisted here. Full raw reports,
source and dependencies are referenced, not copied into this audit.
Readonly recommendations are in `/tmp/safe-bash-comparison-audit-to-replay.txt`.
Early checkpoint and final root handoff are separate `/tmp` files. Root retains
staging/commit authority; additional reviewer should verify scores, profile delta,
lifecycle distinctions, provenance limits and the no-union decision without
rerunning224.
