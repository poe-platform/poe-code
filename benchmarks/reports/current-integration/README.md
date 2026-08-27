# Bounded current-state integrated audit

## Verdict and identity

**Not a clean product gate.** The complete frozen-source test run has **9,920
unique test instances: 9,686 pass, 164 fail, 70 skip, zero TODO/cancelled**.
Root build/typecheck pass. The optional benchmark package typecheck fails.
This is a dirty current-worktree snapshot, **not validation of committed HEAD**.
No implementation, tests, expectations, upstream/archive sources, dependencies,
branches, index entries or commits were changed by this auditor.

- Frozen at `2026-08-26T23:45:55Z`, based on HEAD
  `57d9d9860bd51fabd910814efeea4efbca0e4c26` plus the exact dirty files in
  `checkpoint.txt` / `inputs.json`.
- Final retained regular-copy snapshot:
  `/tmp/safe-bash-current-integration-69dbdy0m/source-clean`.
- Final selected inputs SHA-256:
  `5905112264b83a5e12ca549eec5a88d90f956b2838d54095e97bcec545c91560`.
- Product `src/**` SHA-256:
  `20b8ecb2d2b6e47fc86784b23ba0094f0486a1197fcfcb71dcb61731cfea31ab`.
- 1,266 selected regular files, including 13 relevant untracked files;
  174 explicitly excluded paths. `clean-inputs.json` lists every selected path, hash,
  size, mode and tracked/untracked status, plus exclusions. All selected source
  files reject symlinks, symlink ancestors and hardlinks, and copies have distinct
  inodes from the live files. Before/after-copy content checks matched.
- Exclusions: dependency trees, `.git`, generated `dist`/coverage/cache output,
  all `benchmarks/reports/**` copies, accumulated `.native-*`/temporary fixtures,
  logs/TAP/stdout/stderr/build-info, and other git-ignored untracked files. Checked-in JSON
  fixtures/evidence were retained as potentially required inputs. No archive
  inspection occurred beyond inventory/hashing.

The initial checkpoint selected 1,341 files at `/tmp/safe-bash-current-integration-69dbdy0m/source`,
fingerprint `961d9e6b81e8b0669b9ce65038f1f1c6f0ec58cb15ed157db4bd9004463df764`.
An artifact-selection review found **75 historical stdout/stderr output files**
mistakenly retained outside the already-excluded benchmark reports directory.
The final snapshot is a fresh regular-copy derivative of those frozen inputs,
excluding these files, **not a refreshed copy of newer live source**. All product
source and TypeScript/test inputs remain byte-identical. Every full validation
script and the existing comparator was rerun on this corrected selection.
`clean-equivalence.json` proves identical ordered test names/statuses and comparator
summary. Initial manifests/results are preserved rather than retroactively edited.

Both snapshots' post-validation selected-input fingerprints match their respective
inputs: **zero frozen input changes**. Separately, the earlier `after.json` observes live HEAD
`0db472ad0af0d5d9b2d927415731fe348e611c5a` and 82 selected-path inventory/content
differences, including later mount work, invocation-mode tests, archive inventory
additions and other workers' evidence. These are **not covered by this run**;
the live tree can continue changing after that observation. `clean-after.json`
records the final separately timestamped live observation and clean-snapshot
dependency/input checks: at `2026-08-26T23:59:47Z`, live HEAD was
`5ddce1b0550ad7de8f2a8082f0402fae7aa001b7`, with 176 selected-path differences
under the final selection rule. New live work is
not merged into the frozen results. Initial inspection HEAD was `55e4102`, before
the freeze; it is not the tested identity either.

## Commands and bounds

All commands ran in isolated snapshots, with unchanged package scripts. The
final clean-selection invocations are authoritative; earlier runs follow below.
Results retain exact argv, cwd, elapsed time, exit code, signal and timeout in
`*.result.json`; full output is in matching `*.stdout.log` / `*.stderr.log`.

| Invocation | Actual package script | Exit | Seconds | Bound |
| --- | --- | ---: | ---: | ---: |
| `npm run typecheck` | `tsc --noEmit` | 0 | 3.421 | 180s |
| `npm run build` | `tsc -p tsconfig.build.json` | 0 | 1.726 | 180s |
| `npm test` | `node --import tsx --test "tests/**/*.test.ts"` | 1 | 57.274 | 900s |
| `npm run test:contracts` | `node --import tsx --test "tests/contracts/**/*.test.ts"` | 0 | 0.548 | 180s |
| `npm --prefix benchmarks run typecheck` | `tsc --noEmit -p tsconfig.json` | 2 | 1.482 | 180s |
| `npm run benchmark -- --output /Users/kjopek/Workspace/safe-bash/benchmarks/reports/current-integration/clean-comparison.json` | `node --import tsx benchmarks/run.ts` plus output argument | 1 | 1.026 | 300s |

Final artifacts use the `clean-` prefix. Earlier complete-script runs are retained:
typecheck 0/3.672s, build 0/1.742s, initial test 1/67.822s, contracts 0/0.565s,
benchmark types 2/1.455s, comparison 1/1.001s, corrected-PATH test 1/72.972s.

No invocation hit its audit hard timeout or terminated by signal. No remaining
observed child group required cleanup. The runner created separate process groups,
tracked descendants, and only authorizes stopping its own groups. Individual
first-read probes hit their own internal 1,200ms deadlines: those are **five
failed tests**, not audit timeouts or runner-cancelled tests.

A read-only built-package inventory command also completed in 0.309s (30s bound);
its exact argv and output are retained in `inventory.*`. This is an import and
registry inventory, not a new compatibility suite. No additional test breadth,
performance pilot, selective green rerun, archive verification or private
SafeJS execution was performed.

### Accounting and environment correction

The initial sanitized PATH did not include the already-installed Codex `rg`.
That full run is retained: **9,089 pass / 674 fail / 157 skip / 0 TODO / 0
cancelled**, also out of 9,920. The auditor copied the existing ripgrep 15.2.0
binary to isolated `oracle-bin/rg`, verified its hash, and performed exactly one
more **complete** `npm test` on the same initial input files. No installation or expected
result changed. `oracle-rg-copy.json` records the source, destination and hash.

**Initial environment provenance: INFERRED/RECONSTRUCTED, not a contemporaneous
initial capture.** `environment.json` was overwritten by later invocations and
now contains the corrected `rg` PATH. No original per-phase initial environment
capture is retained. Statements about the initial PATH/environment are inferred
from the helper, checkpoint and run evidence; any backfilled initial environment
description is reconstructed evidence, never an original captured environment.
The final `clean-*.environment.json` files are **contemporaneous per-phase
captures** of the corrected clean runs and are unaffected by this qualification.

The correction changes exactly **510 fail -> pass and 87 skip -> pass**; every
other result remains unchanged, and ordered normalized test titles match.
`environment-delta.json` proves this accounting. These are two executions of the
same 9,920 tests, **not 19,840 unique cases**. The subsequent clean-selection full
rerun also has the same 9,920 instances and outcomes, not additional unique coverage.
Contract reruns: **82/82 pass** each, with
zero failure/skip/TODO/cancelled; it overlaps the full suite and is not added.
All 320 frozen `tests/**/*.test.ts` files are included by the actual script.

`account.py` reconciles every parsed TAP result against the final Node footer.
It does not double-count embedded child-TAP text inside YAML failure diagnostics
(16 misleading result-looking lines in the initial log). Genuine nested tests,
including 58 native-only curl replay rows, remain counted. Counts are test checks,
not all successful guest behaviors. `*.accounting.json` lists unique instances;
`*.nonpass.json` and full logs preserve failure diagnostics. The earlier progress
estimate of 141 registry failures was incorrect; exact classification is **99**.

### Dependency and environment evidence

No install, network fetch or live dependency change occurred. Installed dependency
trees were copied into the isolated snapshot's `node_modules` and
`benchmarks/node_modules`, logically excluded from source inventory. Regular files
are copies, not hardlinks; only dependency-internal links are preserved, with
targets checked to stay inside the copied dependency tree. **No live-source alias
execution was identified in the checked executed entrypoints/resolutions and
reviewed static import closure** (530 files covering 320 test entries plus
root/comparator entries). Resolved `tsx`, TypeScript and comparator entrypoints
in `inventory.stdout.log` point into the private snapshot. This is not a universal
claim about computed imports, computed paths or every retained historical script.

Two **unexecuted historical scripts retain live-root aliases**:
`tests/shell/first-read-independent.snapshot.mjs:4` imports live source at lines
4–5, and `tests/shell/first-read-guard.snapshot.mjs:5` selects the live root.
They were not executed by this audit. Their presence prevents claiming that the
entire retained source inventory is free of live-root aliases; they are preserved,
not repaired or credited as covered. See `INDEPENDENT_REVIEW.md` for the exact
review scope and evidence attribution.

- Root lock SHA-256:
  `9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b`;
  seven installed locked packages, 25 absent optional platform packages.
- Benchmark lock SHA-256:
  `6aad93176a9f7fc2578dd720802ce93a1e71b3be9dd9052ef0a54fab8bdc7d70`;
  81 installed locked packages, zero missing optional packages. Existing
  **just-bash 3.4.2** matches manifest, lock and installed package metadata.
- Both trees' installed versions and hidden-lock version/resolved/integrity
  metadata match the locks. Installed file hashes match their copies and are
  unchanged in both live and isolated trees after validation. Full hashes and
  limitations: `dependencies.json`, `dependency-copy.json`, `dependency-after.json`.
- **Limitation:** installed-file hashes and recorded integrity metadata do not
  independently authenticate registry tarball bytes. No tarball reconstruction,
  registry verification, signature check or pristine reinstall was performed.
  Missing/mismatched baseline evidence would have blocked comparison; no latest
  version was substituted.
- Node 22.22.2 / npm 10.9.7, macOS arm64. HOME, TMPDIR/TMP/TEMP, XDG directories
  and npm cache are isolated; tsx cache is disabled. No inherited private-runtime,
  credentials, Node options or optional-oracle override variables were enabled.
  The isolated temporary compile/tsx caches were removed afterward.
- Native system executables remain external to the source snapshot. Exact
  executable paths/hashes/version attempts, including pinned GNU diff/patch
  binary hashes, are in `host-tool-evidence.json`. These are not copied native
  source trees or proof of every transitive host executable's provenance.

## Exact failure groups and owner handoffs

These six disjoint groups sum to **164**. No failure is waived or converted into
a pass. `failure-groups.json` gives file-level counts and TAP locations;
`clean-test.nonpass.json` retains final complete diagnostics; earlier logs remain separate.

| Group | Failures | Concrete observation and handoff |
| --- | ---: | --- |
| Registry/fixture incompatibility | 99 | All 79 adapter-tool matrix tests, eight diagnostic tests, and 12 jq cross-backend tests stop at the six-family registry preflight. Actual bundle adds `chmod`, `mktemp`, `stat` (52 vs 49). Curie owns aggregate wiring; Poincare owns matrix fixture; Archimedes owns jq/diagnostic consumers. Coordinate intended bundle and fixture contract, preserving downstream assertions. |
| Independent jq exact-byte vectors | 42 | **30 status/stdout differences**, **12 stderr-only differences** against frozen vectors. Includes continuation after errors, mixed `join`, malformed UTF-8 replacement, raw-file boundaries and pipeline recovery. Archimedes: `src/commands/structured/input.ts`, `jq.ts`, `interpreter.ts`; tests under `independent-increment`. Not all are registry failures. |
| Diff/patch checks | 8 | One quoted ancestor symlink accepted with status 0 where status 2/no mutation is required; six empty-file-removal snapshots differ in root directory `nlink` (3 vs 4); one backward-second-hunk returns 1 rather than expected 2. Faraday owns command/independent tests; coordinate nlink semantics with Poincare. No claim that all eight are newly discovered source bugs. |
| Unmodified live-native shell comparisons | 9 | Seven retain matching status/stdout/files but differing stderr; two have parsing-unit/effect differences relative to Bash 3.2. Sagan owns source/oracle reconciliation. Existing docs describe newer GNU parse policy; these are **not newly authorized dialect exceptions** and remain failures. |
| First-read pipeline lifecycle | 5 | Local pending producer, S3, WebDAV, curl-body and curl-headers remain pending before first byte after `head -n 0` exits; each hits 1,200ms internal deadline. Sagan owns shell lifecycle; coordinate Archimedes for curl and Poincare for adapters. Ordinary earlier-output closure cases passing do not establish first-read cancellation. |
| S3 metadata stress contract | 1 | `tests/stress/adapters/core.test.ts:39` expects mode-0600 write rejection when permissions capability is false, but the call resolves. Poincare owns reconciliation of default transport/mode enforcement. No new provider guarantee is inferred. |

Key frozen source/test references and reproducible existing cases:

- Registry: `src/plugins/index.ts:39` includes metadata;
  `tests/integration/adapter-tools/fixtures.ts:177` derives only six families and
  asserts exact equality at line 179, **before** calling the workflow callback.
  This makes the current matrix **0/79**, not proof that 79 backend operations
  themselves failed. The 12 blocked jq cases are six `fresh-interop` plus six
  `split-increment/interop`; their expected workload is not reached.
- Jq: `tests/commands/structured-stress/independent-increment/native-regressions.test.ts:16`
  and `additive-regressions.test.ts` retain the exact vectors. For example,
  `native exact bytes: pipe-error-recovery` produces `before`, while expected
  stdout is `before|after`; `runtime-error-last-false` returns 5/empty stdout
  rather than 1/`false\n`. `jq-delta-classification.json` enumerates all 42 with
  exact expected/actual status and hexadecimal output. Readable names alone do
  not determine whether a difference is diagnostic-only.
- Patch: `tests/commands/diff-patch-stress/editflows/quoted-safety.test.ts:51`
  runs a valid first section followed by a quoted `"alias/target"` section through
  an ancestor symlink. The status assertion at line 59 fails; later byte/link
  assertions are not reached. Owner should inspect actual effects, not infer
  a complete mutation trace from the failing status alone.
- First-read: `tests/shell/first-read-probe.ts:97` executes
  `${producer} | head -n 0; true`; the producer is intentionally waiting before
  its first byte. The existing `tests/shell/remote-close.test.ts:6` runs each
  scenario in a hard-deadline child. `src/shell/runtime.ts:285` is the pipeline
  input/lifecycle entrypoint for Sagan's investigation. Full captured child
  diagnostics distinguish fixture teardown from successful cancellation.
- Benchmark types: `benchmarks/shell-stress/diagnostic-profiles/run.ts:12`
  passes `string | undefined` to `existsSync` after optional-chaining assertion;
  TS2345. Sagan owns that benchmark. Root typecheck excludes this directory,
  so its pass is not inconsistent with the optional package failure.

For owners, the full reproduction is the retained snapshot plus the exact
isolated environment in `clean-test.environment.json`, running `npm test`.
Scoped diagnostic reproductions can use the named existing test files, but this
audit did not replace the full result with scoped success or modify expectations.

## Existing coverage and remaining requested features

Built root inventory is **52 default command definitions across seven families**;
curl and SafeJS remain optional exports and absent from that bundle. The README's
six-family wording and fixture-derived 49-command inventory do not describe this
dirty aggregate wiring. `inventory.stdout.log` records all names and exports.
The runtime's separate shell builtins are not added as unique plugin commands.

Measured cohorts inside the same full run, not extra denominators:

| Existing cohort | Result | Actual scope / limit |
| --- | --- | --- |
| Required adapter-tool matrix | **0/79** | memory, real, S3 mock, loopback WebDAV, mount, overlay, readonly; all stop at registration assertion, so intended pipeline/tool work is blocked |
| Original S3/WebDAV cancellation S01–S12/D01–D12 | **24/24** | supplied abort, pending host operations, body/late rejection and bounded local HTTP cases; not deployed-provider coverage |
| Late WebDAV cleanup V01–V10 | **10/10** | ignored host work, late body/LOCK cleanup authorization/deadlines; not guaranteed remote rollback |
| Existing hard-deadline pipeline closure | **20/25** | five first-read failures remain; standalone `head -n 0` passes |
| `stdin shell ...` provenance cases | **35/35** | connected/empty/exhausted input, redirection and invocation provenance; not every backend/command combination |
| Remote safe-workflow API checks | **6/6** | S3/WebDAV mocks; named cleanup, explicit recursive removal, bounded memory staging; **not shell-tool matrix replacements** |
| Untracked-at-freeze metadata integration | **6/6** | current root wiring, memory pipeline, readonly/S3 metadata and output cancellation; not committed-only evidence |

`coverage-cohorts.json` retains exact test-name selectors and TAP identities.
Do not combine these overlapping slices or native-only replay checks into another
invented product total.

Highest-impact next work, without expanding this checkpoint:

1. Restore the aggregate/fixture contract to unblock actual cross-backend command
   interoperability, then rerun the unchanged intended workflow assertions.
2. Close the demonstrated before-first-byte pipeline lifecycle gap; caller-abort
   and post-first-output success are distinct evidence.
3. Resolve jq error recovery/byte fidelity and patch security/effect failures
   with the respective source owners, not blanket test relaxation.
4. Full Bash remains unmet: `set -e`/errexit is explicitly rejected rather than
   implemented (`tests/shell/README.md:3`, `src/shell/runtime.ts:906`); extended
   glob/locale collation remain unsupported; parser rejects `select`, `[[` and
   other unsupported keywords (`src/shell/parser.ts:608`). This audit did not
   invent a new full-shell test matrix or claim universal missing-feature proof.
5. Remote/provider and wrapper completeness remain open: real deployed S3/WebDAV
   services are not tested here, S3 safe empty-prefix removal remains unsupported,
   POSIX permission/link limitations remain, and wrapper identity/namespace
   changes continued after the freeze. Additional filesystem choices and complete
   tooling scope remain unfulfilled. `tar` is absent from this frozen registered
   inventory; later archive work is only inventoried, not reviewed or validated.
6. Curl is delivered as an explicitly enabled HTTP(S) subset, not native parity;
   unsupported proxy/config/certificate/compression/resume/parallel/HTTP2/3
   features remain documented in its README. Actual injected SafeJS engine
   behavior is **not exercised** because private-checkout access was prohibited.

### Skips and conditional omissions

All **70** final skips remain in the full denominator: **62 actual-local SafeJS**
checks (56 shared-runtime skip reason plus six bridge integration skips), **three
environment-enabled GNU byte-reference** checks, **three unavailable GNU
checksum-oracle** checks, and **two unavailable GNU base32/base64-oracle** checks.
Static vectors still executing do not replace these missing native checks.
`SAFEJS_LOCAL_ROOT`, GNU byte/SED/PATCH override variables and diagnostic-profile
overrides were not supplied. Some tests use already-pinned absolute native
executables or frozen evidence without such variables; that is separately
recorded, not universal absence of GNU oracle coverage.

`test-inventory.json` enumerates included `.test.ts` files, other TS/MJS helpers
and probe programs, and explicit `process.env.NAME` references. This textual scan
is not proof that every dynamic environment lookup was discovered. Nonmatching
standalone `.mjs`/probe programs, performance pilots, later-added live tests and
private runtime checks are omitted, not successful skips outside the denominator.

## Existing pinned comparator: narrow successful virtual result

The unmodified harness ran **118 cases per engine**: 88 oracle fixtures, 18
deterministic cases, seven existing plugin integrations, two pinned GNU-sed policy
cases and three concurrency/cancellation/backpressure probes. No filters.

- virtual-bash: **118 pass / 0 fail/error/timeout/pending/unsupported**.
- just-bash **3.4.2**: **108 pass / 9 fail / 1 unsupported**, no errors/timeouts/pending.
- Harness exit **1**, as required for any engine non-pass. Stable harness/source
  fingerprints, no background worker errors. `.git` is intentionally absent in
  the snapshot; the harness's null Git revision is supplemented by the separate
  dirty-input identity above, not rewritten as a committed result.

Important coverage boundary: `benchmarks/engines.ts:87` installs the older **six
families directly**, not current `agentCommands()` and not metadata/curl/SafeJS.
Its 118/118 therefore does **not validate the current 52-command aggregate
registry**, the blocked adapter matrix, or optional plugins. It uses memory
filesystems, byte outputs and regular-file fixture maps; it does not compare
remote backends, all metadata, every utility option, general memory/performance,
or full Bash. The two selected GNU-sed policy expectations do not authorize
normalizing the nine failing live-native shell comparisons.

Final comparison outcomes and methodology are in `clean-comparison.json` (earlier
identical totals in `comparison.json`). This narrow
result does not establish parity, the exact requirement **"IT MUST BE BETTER than
just-bash, much better"**, completion of the broad product scope, or **72 hours**
of work. Only this bounded observed work and its evidence are claimed.

## Artifact and cleanup index

- `checkpoint.txt` mirrors the promptly delivered
  `/tmp/safe-bash-current-integration-checkpoint.txt`, including bounded rerun amendment.
- `audit.py`, `account.py`: authored audit/provenance and TAP-accounting helpers;
  they are outside the source snapshot and only operate on owned reports/private
  snapshots. No implementation edits.
- `clean-inputs.json`, `clean-state.json`, `clean-after.json`, plus the preserved
  initial counterparts and dependency evidence: identity, selection correction and drift.
- `*.result.json`, `*.stdout.log`, `*.stderr.log`: full commands and outputs;
  empty stderr files are intentional evidence. `clean-*.environment.json` records
  contemporaneous clean-phase environments; overwritten `environment.json` is
  not an initial capture. Initial-environment reconstruction is labeled above.
- Accounting, failure, jq-delta, coverage and comparator JSON: exact denominators
  and source-owner handoffs without vendored source/dependencies.
- `generated-inventory.json` and `clean-after.json`: 448 generated build files in
  each respective snapshot, all under `dist`.
  No leftover local source-fixture accumulation was found. `fixture-cleanup.json`
  and `isolated-tmp-cleanup.json` record cleanup; frozen source/dependency copies
  remain in `/tmp` for owner reproduction, never in this report directory.

`HANDOFF.md` is the corrected durable handoff. The earlier
`/tmp/safe-bash-current-integration-detail.txt` remains historical and is superseded
only where its unqualified alias/environment wording conflicts with that handoff.
`INDEPENDENT_REVIEW.md` and `independent-review-evidence.json` preserve the concise
independent review and both qualifications without copying full temporary logs.
The evidence-only commit records reports, **not a committed version of the audited
dirty frozen source**. No validation was rerun for this report-only finalization.
The auditor stops here; no archive verifier role, implementation fix, new breadth
or superiority claim is activated.
