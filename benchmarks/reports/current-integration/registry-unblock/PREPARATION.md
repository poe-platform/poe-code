# Registry-unblock preparation — execution gated

**PREPARATION ONLY. No explicit author handoff has been received.** No current
test source, product entrypoint, mutation, package test/build or comparison was
executed. This is a precise scoped run plan and pinned selection, not a delivered
execution harness or a claim that the fixes are ready. Root must resume this
auditor with the authoritative author handoff and read-only delta review first.
No commit or staging is authorized for this partial preparation.

## Immutable baseline and exact denominator

Accepted report commit **`96db59ac7d355d1a94422634b4c4f53d00932ad9`** remains
immutable. Its audited source was **DIRTY `57d9d9860bd51fabd910814efeea4efbca0e4c26`**,
selected digest `5905112264b83a5e12ca549eec5a88d90f956b2838d54095e97bcec545c91560`;
the report commit is not committed-source validation.

`historical-99.json` pins **every exact historical file/name pair**, accepted TAP
identity/line and source-file hash. Selection comes from accepted
`clean-test.nonpass.json`, cross-checked against accounting and committed blobs:

| File | Exact historical registry failures |
| --- | ---: |
| `tests/integration/adapter-tools/matrix.test.ts` | 79 |
| `tests/integration/adapter-tools-diagnostics/eight-cases.test.ts` | 8 |
| `tests/commands/structured-stress/final-increment/fresh-interop.test.ts` | 6 |
| `tests/commands/structured-stress/split-increment/interop.test.ts` | 6 |
| **Total** | **99 = 79 + 20, not 79 + 19** |

The additional twenty are exactly eight diagnostic rows and two six-backend jq
interop cohorts. They do **not** include the separate **42 open jq exact-vector
differences** (30 status/stdout, 12 stderr-only). No original failure is erased;
future outcomes are a new cohort on a separately identified author-handoff freeze.
The historical 9,920-test full-suite denominator and comparator are not rerun.

## Required handoff inputs — blocking gates

1. Root explicitly accepts Curie's and Poincare's author handoffs: exact commits,
   owned changed paths, source/test/helper hashes, intended aggregate **52-name**
   contract, author verification commands/results and remaining failures. An
   observed new commit or a green author report alone is not an accepted handoff.
2. Supply the authoritative source freeze revision and any deliberately included
   dirty/untracked changes with hashes. All selected source/lock/helper/fixture
   files must form one coherent identified snapshot. Do not silently mix the old
   accepted snapshot, current moving files or later author edits.
3. Provide the other reviewer's delta verdict: separate exact-name assertions
   cover the intentional 49 -> 52 transition; workflow preflight checks named
   required commands/capabilities, **not total registry size or whole-set equality**.
   All 99 identities, callback bodies, dispatch, byte/status/namespace, stdin,
   cancellation and typed-error assertions remain intact. No renames, removed
   rows, fixture-vector changes, skips or unrelated jq fixes may be smuggled in.
4. Identify the new explicit required-command list and missing-command diagnostic.
   Confirm `cat` is required by the common seven-backend fixture preflight. The
   planned mutant must fail there with a clear error naming missing `cat`.
   If it is not a common requirement, stop for root-approved mutation selection;
   do not silently reduce the backend/cohort scope or weaken expected evidence.
5. Confirm locks/installed dependencies available for private-copy reuse, Node
   version, and local fixture policy. **No network is used in preparation.**
   Existing WebDAV cases create a loopback HTTP server. Root must explicitly
   confirm that intended loopback fixture execution is permitted under the
   no-network rule; otherwise that required scope is BLOCKED, not skipped or
   substituted with an in-memory-only adapter. No external/provider networking,
   package downloads, private-repo access or credentials are permitted.
6. Approve this finite plan and the future isolated-only mutation. Only then
   materialize/review the executor under this new owned directory and run it.

## Freeze and dependency plan

- Create a **new** `/tmp/safe-bash-registry-unblock-<unique>/source` using regular
  copies of the accepted author-handoff inputs. No Git worktree/branch, hardlinks,
  source symlinks or live-source aliases. The old retained snapshot is a read-only
  historical reference and must never be the mutation target.
- Pin selected file bytes/modes, tracked/dirty status, commit, locks, source/test/
  fixture fingerprints and explicit exclusions before copying; verify copied
  bytes and independent inodes; compare live-before/live-after separately.
  Freeze prior to execution. Reject drift rather than silently refreshing files.
- Include the full static/dynamic literal dependency closure of these four test
  entrypoints and the root plugin entrypoint, plus actual fixture JSON and config.
  Exclude `.git`, dependency trees from the source inventory, `dist`, caches,
  all copied reports/logs/stdout/stderr and temporary fixture accumulations.
  Review any computed imports/paths. Do not claim universal alias freedom: the
  historical unexecuted `first-read-independent.snapshot.mjs` and
  `first-read-guard.snapshot.mjs` have known live-root aliases and are not entrypoints.
- Reuse already-installed **locked root** dependencies only, preferably by a new
  regular-file copy from the previously verified private dependency tree after
  matching the handoff lock. Validate package/hidden-lock versions and metadata,
  full installed-file hashes, modes and internal link destinations before/after.
  No source links back to live; dependency-internal links may remain only wholly
  within the private copy. No installs; no just-bash/comparator dependency reuse
  is needed for this scope. Missing/mismatched evidence is BLOCKED.
- This verifies installed bytes against prior evidence/locks, **not fresh registry
  tarball authenticity**. If the handoff lock differs, require approved ready
  installed evidence rather than resolving/upgrading anything.
- Use new per-phase HOME/TMPDIR/TMP/TEMP/XDG/npm-cache paths, fixed C locale/UTC,
  `TSX_DISABLE_CACHE=1`, and an allowlisted PATH. Capture each actual environment
  **contemporaneously before spawn**, never overwrite a shared environment file.
  No inherited `NODE_OPTIONS`, `NODE_PATH`, private-runtime or oracle overrides.
  Scope has frozen reference inputs, not new native-oracle captures; an unexpected
  native-tool dependency requires explicit provenance/gate review, not a download.

## Exact commands and bounded order — proposed, not executed

`proposed-commands.json` contains literal argument arrays, the exact anchored
name regex for each cohort, cwd/environment requirements and hard timeouts.
`<SNAPSHOT>`, `<MUTANT>` and `<AUX>` are future private absolute paths, not current
live directories. `<AUX>` is a hashed regular copy of the pinned expected-name JSON.

| Order | Proposed phase | Audit hard bound |
| --- | --- | ---: |
| 1 | Handoff/hash/closure checks and regular-copy freeze | 60s |
| 2 | Independent exact-52 registry probe | 30s |
| 3 | Exact 79 historical matrix names, one file | 240s |
| 4 | Exact eight diagnostic names, one file | 120s |
| 5 | Exact six fresh numeric/split names, one file | 120s |
| 6 | Exact six split-dispatch names, one file | 120s |
| 7 | Fresh regular-copy mutant, cardinality control and same four cohorts | 180s total |
| 8 | Accounting, hashes, live-drift separation and child/fixture cleanup | 30s |

**Total outer budget: 900 seconds.** The future controller must enforce the
remaining overall budget, use a new process group for each command, record exit,
signal/deadline and raw stdout/stderr, observe descendants including detached
helpers, and stop only its own children with bounded TERM/KILL cleanup. No watch,
automatic broad retry or full package run. Existing per-test deadlines stay intact.
Timeout means incomplete/failed evidence, never a passing capability skip.

The four baseline test commands use the same form:

```text
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 --test-reporter=tap --test-name-pattern=<exact anchored cohort regex> <exact file>
```

The JSON pins the **full regex and exact file** for every command, not a prefix
or broad grep. Unexpected extra tests in the files are outside the selected
denominator; retain any emitted filtered-skip records separately. If a selected
historical identity disappears, is renamed, is skipped/TODO/cancelled, appears
twice or does not reach its test body, the 99-case gate is not satisfied.

## Exact names versus capability preflight

`expected-default-commands.json` is a **literal independent catalog of 52 names**
including chmod/mktemp/stat, separately reviewed against accepted author intent
and historical inventory. It must not be generated from current definitions,
the same command-family factories being checked, or observed runtime output.
The proposed standalone registry probe independently compares both
`createAgentCommands()` and initialized `shell.commands.list()` to that catalog,
checks uniqueness and confirms curl/SafeJS are absent. It is a separate probe,
**not one of the 99 historical workflow tests**.

The workflows should accept the named capabilities they require without demanding
that the entire registry equal their old six-family set. Do not inject the exact
52-name assertion into workflow preflight; that would reintroduce the blocker.
If the handoff defaults are not exactly the explicitly authorized 52, stop for
coordination rather than quietly adding tar/table-text or deriving a new expectation.

## Backend execution proof, not registration-only success

All backend counts are exact file/name selections in `historical-99.json`:

| Backend / composition | Matrix | Diagnostics | Fresh jq | Split jq | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| memory, including the unprefixed raw-split capability case | 12 | 1 | 1 | 1 | 15 |
| real, disposable regular host directory | 11 | 1 | 1 | 1 | 14 |
| S3 mock with actual transport request records | 11 | 1 | 1 | 1 | 14 |
| WebDAV, authorized bounded loopback HTTP fixture | 11 | 1 | 1 | 1 | 14 |
| mount, real `/work` plus S3 `/objects` | 12 | 1 | 1 | 1 | 15 |
| overlay, memory upper and S3 lower | 12 | 1 | 1 | 1 | 15 |
| readonly wrapper | 10 | 2 | 0 | 0 | 12 |
| **Total** | **79** | **8** | **6** | **6** | **99** |

Retain the existing callback/await structure so a passing selected test cannot
return before its workflow. Review the handoff fixture path to `await run(...)`;
no early return on missing capability and no caught errors converted to success.
Do not edit test expectations or add live instrumentation. Source/control-flow
review plus the existing positive assertions establish execution per passing row:

- Each writable backend retains eleven rows: named-file probes; six-family coding
  flow; binary stdin/compression/hash/tee/redirection; cwd and empty/supplied stdin;
  create/copy/append/remove; move; touch; in-place sed/diff/patch/reverse; path and
  redirected errors; blocked-pipeline cancellation; and output limits/reuse.
- `allFamiliesDispatched` must still check actual find/rg/sed/awk/jq/sha256sum/gzip/
  diff/patch dispatch. Exact output/status and persisted report/patch/binary bytes
  remain required. S3 request assertions and WebDAV PROPFIND/GET/PUT observations
  are evidence of real fixture transport work, not registration or provider parity.
- Mount's extra row retains pipeline publication plus copies in both real/S3
  directions, byte checks and request evidence. Overlay's extra row must retain
  edits/whiteouts and unchanged lower backing bytes. The unprefixed matrix raw-
  split case runs on **memory**; it must not be lost by backend-prefix filtering.
- Readonly retains one all-family inspection/unchanged-tree row plus **nine**
  denied-mutation rows, including gzip. These ten matrix cases are distinct from
  the two diagnostic truncate/append rows. This accounting prevents a 98-row error.
- Eight diagnostics retain decoded `EVIDENCE` records, typed FsError code/path,
  genuine redirection/open observations and exact namespace/byte invariants.
  Require callback evidence, not merely `status: PASS` from fixture construction.
- Six fresh-jq rows retain all four frozen vectors, named-file and pipeline paths,
  final output-file bytes and jq/cat dispatch. Six split-jq rows retain explicit
  stdin, named files, redirected pipelines, persisted JSON and seven-command
  dispatch checks. No independent-increment exact-vector suite is added.

For each selected row, report test status, source/hash identity, backend,
preflight reached/passed versus callback assertion progress where evidence allows,
and which original positive assertions establish execution. A later functional
failure is not a registry success or a waived backend requirement; distinguish
"preflight unblocked, downstream failed" from "whole workflow passed". Do not
invent per-operation traces where the original test only exposes final assertions.

## Missing-command mutation — isolated, same cardinality

After baseline evidence, make a **fresh regular-file mutant copy** from the new
freeze. Change only the copied aggregate registration locus (expected
`src/plugins/index.ts`, confirmed at handoff): remove `cat` and add inert uniquely
named `__registry_unblock_missing_cat_control`. Preserve **52 unique definitions**
and every other default name/definition. Retain the precise patch, before/after
hashes and changed-path allowlist. No live file, accepted snapshot, fixture,
expectation, assertion or global runtime hook is changed.

First run a separately reported mutation-control probe asserting the exact
literal expected catalog with only that one substitution: cardinality 52,
`cat` absent, sentinel present, all other names unchanged. Then execute the same
four selected cohorts from the mutant, **without running the exact-52 baseline
registry test as the sensitivity detector**. Planned budget: 20s preparation +
four 40s cohort bounds, within the 180s phase cap.

Acceptance requires missing `cat` to be detected by the actual required-command
preflight across all intended backends, with a clear missing-command error naming
`cat`, before workflow execution. Since cardinality stays 52, a total-count check
alone cannot kill this mutant. A generic array/size assertion, syntax/import error,
timeout, unrelated downstream failure or the independent exact-name probe failing
is **not sufficient mutation sensitivity**. If only such failures occur, report
the mutation gate failed and route to authors. The other reviewer must confirm
the diagnostic originates from the named capability check, not a new whole-set
equality disguised as a required-command guard.

Record every mutant status/error and the baseline-to-mutant mapping for all 99
identities. They are mutation controls, not 99 extra successful workflow cases.
Do not call a baseline-red row independently mutation-proven without distinguishing
its original failure from the deliberate missing-command failure.

## Accounting, preservation and preparation stop

The historical `audit.py`/`account.py` were inspected **as text only**. They have
fixed report paths and import-time/writing behavior; invoking or importing them
would risk changing accepted evidence. A future executor/accountant must be new,
own-scope and reviewed, with no default route to the parent reports directory.

Reuse the TAP accounting logic conceptually: exclude YAML-embedded child TAP and
suite containers; preserve actual nested test identities; reconcile every footer
and exact file/name pair. Report unique **79 + 20 = 99**, per-backend pass/fail/
skip/TODO/cancelled, command exits/signals/timeouts, absent/extra rows and failure
stages. Baseline, registry probe and mutation controls have separate denominators.
No retry, instrumentation or helper subtest inflates workflow coverage.

Finalize only within `registry-unblock/**`, with frozen/live fingerprints kept
separate, original 99-preflight and 42-jq findings preserved, contemporaneous
environment capture, mutation patch proof, dependency hashes, raw outputs and
own-child/temp cleanup evidence. Retain documented new snapshots for reproduction.
No source fixes, private repo, network downloads, tar/jq breadth or new branches.

**Current status: awaiting explicit handoff and root authorization.** Preparation
artifacts verify selection/plan consistency only; they contain no new execution
results or acceptance claims. Root checkpoint:
`/tmp/safe-bash-registry-unblock-prep-detail.txt`.
