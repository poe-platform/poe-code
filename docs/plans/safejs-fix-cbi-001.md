# CBI-001: retained callback delivery

## Scope and baseline

- Assigned issue only: P1 RETAINED-CALLBACK-DELIVERY / CBI-001.
- Isolated clone: `/Users/kjopek/Workspace/poe-code-safejs-callback-delivery`.
- Base main: `c51139ecafcf5c8a0604788ccde914610d600d62`.
- Cloned with `--single-branch --branch main`, then successfully ran
  `git -c pull.rebase=false pull --ff-only` before investigation/setup.
- Read ancestor/root instructions; this is the assigned worker, without nested agents.
- Setup: Node 22.22.2, npm 10.9.7; `SKIP_SYNC_SKILLS=1 npm ci` succeeded.
  Shared setup report's explicit agent-spawn/frontmatter/tiny-mcp-client Turbo
  build filters succeeded (21 tasks). No dependency manifest changes.
- No branches, stash, reset, staging, commits, pushes, README edits, or writes
  to original/shared/publisher repositories. Toolcraft is not in scope.

## Evidence boundary

Original audit is read-only. Initial inspection was top-level names and metadata
(`inventory.json`, `inventory-verification.json`, index-state metadata), not
payload. Bootstrap `inventory.json.archiveReadPolicy.excludedPaths` establishes
exactly 38 excluded paths; the entire security directory is also denied before
any callback payload reads. No excluded bytes are read, hashed, or executed.

Allowlisted payloads are callback-inputs/REPORT.md, its silent-loss-evidence.json,
callback-loss-review/REVIEW.md, REPRODUCE.md, results.json, the four ordinary
review sources (01-identical.js, 02-distinct.js, 03-retained-map.js,
04-no-input-promise.js), and their first/second/completed snapshots. Only those
needed original witnesses are executed, with in-memory host operations and bounded
processes, against this clone's current TypeScript, never dist.

## Contract and root-cause hypothesis

CHECKPOINT_REPLAY.md documents repeated callbacks, lexical bindings, synchronous
local onReplay restoration, pending reissue matching, and explicit proof
dispositions. The particular completed-registration/rebound-adapter lifetime is
only implicit: support is scoped here to a later source-awaited delivery within
the same resumed run, not arbitrary post-run or detached delivery. No external
exactly-once guarantee is claimed.

The completed registration's callback adapter retains a historical replay cursor
at zero while scheduled replay invokes the source callback directly. A new
source-awaited delivery can therefore consume a historical callback result
(identical args) or incorrectly refuse (different args). Pending reissue must
still match callback identities/arguments and reuse historical results.

## Implementation and validation sequence

1. Native and uninterrupted original controls first; retain full original
   pre-fix outputs, including both independent repeats and substantial map.
2. Add in-memory unit regressions and record actual RED before code changes.
3. Correct replay/invocation distinction at the bridge, without argument-based
   deduplication, source workarounds, altered tracking IDs, or unrelated fixes.
4. Record actual GREEN for the same original witnesses and new regressions;
   run broader replay/callback/checkpoint controls, typecheck, lint, diff check.
5. Record base/preimage and postimage manifests plus exact commands/results.

Evidence directory: `out/safejs-remediation/cbi-001/` (local, uncommitted).
Separate validation and publication decisions belong to the coordinator; this
document does not close the overall goal.

## Implemented correction

`packages/safejs/src/interp/host-bridge.ts` now creates the historical invocation
cursor only immediately before actually reissuing a restored native operation.
Its name, `nextReissuedInvocation`, distinguishes historical reissue matching
from a new retained-adapter delivery. Completed registrations and external proof
callbacks have no historical-result cursor: their new invocations wait for live
execution, record callback history, and execute the retained lexical closure.

The existing callback-ID/argument guard still protects pending reissue. The
external-resumer path retains its documented new-invocation behavior without
needing to skip a historical cursor explicitly. No journal schema, capability
identity, public call ID, source event count, or replay argument comparison is
changed. Production diff: five added lines, four removed lines in one file.

## Actual RED and GREEN evidence

The original archived checkpoints have incompatible execution semantics on this
base. This was reported immediately. `original-red.json` preserves all 40
attempts: four native controls, four uninterrupted controls, eight captures
(all correct), and 24 immutable archived-checkpoint refusals. Those refusals
occur before callback execution and are **not** CBI-001 reproductions.

The same unchanged original source bodies and independent review driver then
ran using the fresh current-TypeScript checkpoints from those captures. No
source, original snapshot, version marker, or driver body was patched.
`current-*.json` retains these 12 new first/second/completed checkpoints; the
identical bytes are used in RED and GREEN.

| Evidence                                          | Actual result                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current-original-red.json`                       | 24 resumes: four stale-success counter results, four map/distinct refusals, 16 passing second/completed controls                                     |
| `unit-red.log`                                    | 21 tests: ten failures reproducing first-boundary/successive-checkpoint loss or refusal, 11 passing controls                                         |
| `unit-green.log`                                  | Same 21 focused tests pass after the bridge correction                                                                                               |
| `current-original-green.json`                     | All 40 native/uninterrupted/capture/resume attempts pass; original source body, host driver, source hashes, and current checkpoint hashes retained   |
| `replay-controls.log`                             | 447 tests in 16 files pass, including the 21 new tests                                                                                               |
| `broader-run-controls.log`                        | 274 tests in seven files pass, including the same 21 new tests                                                                                       |
| `static-checks.log`                               | SafeJS source typecheck, changed-file ESLint, Prettier, and diff whitespace checks pass                                                              |
| `test-typecheck.log` / `test-typecheck-green.log` | Extra strict test-file check initially found an overly broad snapshot annotation; changing the test annotation to existing `RunSnapshot` resolves it |

The two broader commands cover 700 distinct tests across 22 files (21 focused
tests overlap). They are not a whole-repository or adversarial-suite claim.

Exact original first-boundary selectors, both repetitions:

- Identical with input: `resumes.json:0` and `resumes.json:12`.
- Identical without any caller input promise: `resumes.json:9` and `resumes.json:21`.
- Different ordinary event: `resumes.json:3` and `resumes.json:15`.
- Substantial bounded-concurrent map: `resumes.json:6` and `resumes.json:18`.

Identical RED is `{total:2,count:1,first:2,second:2}` with one registration
callback and no `step("second:0")`. GREEN is
`{total:4,count:2,first:2,second:4}`, with both callback traces and the new nested
step. The map now returns total 39 and values `[6,17,3,13]`, with peak concurrency
2, no active worker left, and all expected aliases preserved. Distinct events
return total 5 instead of refusing against the consumed registration.

Full stdout/stderr, process status/signal, configurations, parsed outcomes,
journals, and lifecycle observations are retained in the JSON records. GREEN
checks assert complete native-equivalent values, callback count 2, no delivery
inside replay hooks, no reissued registration, unchanged historical call IDs,
and the expected new nested operation. No stale-success observation is counted
as correctness success merely because a child exits zero.

## Reproduction and controls

Run from the isolated clone. The original-witness JSON files retain
`protocol.childCommand`, native/SafeJS argument arrays, and each attempt's exact
`config`. Execute that command with the corresponding JSON config as its sole
argument, with `spawnSync` timeout 5 seconds/native or 8 seconds/SafeJS,
`killSignal: "SIGKILL"`, and 16 MB output cap. SafeJS arguments include
`--max-old-space-size=192 --import tsx --input-type=module`; native uses 128 MB
and no tsx. The original driver verifies source/checkpoint SHA-256 before use.
For current RED/GREEN comparisons, use the same retained current snapshot, not
the incompatible historical snapshot. The driver only reads the allowlisted
ordinary source and selected checkpoint and writes its result to stdout.

Focused RED/GREEN command (executed before/after production changes):

```sh
./node_modules/.bin/vitest run packages/safejs/src/run.retained-callback.test.ts --reporter=verbose
```

Broader commands actually executed:

```sh
./node_modules/.bin/vitest run packages/safejs/src/run.retained-callback.test.ts packages/safejs/src/run.replay.stress.test.ts packages/safejs/src/run.completed-replay.test.ts packages/safejs/src/run.failure-replay.test.ts packages/safejs/src/run.references.test.ts packages/safejs/src/interp/host-bridge.test.ts packages/safejs/src/interp/host-call.test.ts packages/safejs/src/interp/promise-replay.test.ts packages/safejs/src/snapshot --reporter=verbose
./node_modules/.bin/vitest run packages/safejs/src/run.test.ts packages/safejs/src/run.promise-order.test.ts packages/safejs/src/run.promise-iterable.test.ts packages/safejs/src/run.promise-constructor.test.ts packages/safejs/src/run.promise-generic.test.ts packages/safejs/src/run.retained-callback.test.ts packages/safejs/src/dump.test.ts --reporter=verbose
./node_modules/.bin/tsc --noEmit -p packages/safejs/tsconfig.json
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --esModuleInterop --target ES2022 --module NodeNext --moduleResolution NodeNext --types node,vitest/globals packages/safejs/src/run.retained-callback.test.ts
./node_modules/.bin/eslint packages/safejs/src/interp/host-bridge.ts packages/safejs/src/run.retained-callback.test.ts --max-warnings=0
./node_modules/.bin/prettier --check packages/safejs/src/interp/host-bridge.ts packages/safejs/src/run.retained-callback.test.ts
git diff --check
```

Pending injected-input reconciliation, pending callback loops at invocations
0/3/7, missing/provided joined proof, resumer-started callbacks, previously started
callbacks, returned source identities, lexical mutation, and callback ordering
pass as **regression controls**, not substitutes for the original failure.
The added argument-mismatch test still requires external reconciliation with
the pending operation's unchanged public call ID. New tests use only memory
(including snapshot backends); no guest network/filesystem/process/LLM access.
No visual CLI behavior changes, so no CLI screenshot is applicable.

## Integrity and handoff

| Owned path                                          | Base SHA-256                                                       | Post SHA-256                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/host-bridge.ts`         | `8bc1c6cb653fa70d281732d7bb893a02cfd0e6a87f6eff093d448b9d56678420` | `2b714ea51918134296ae62eb27cf0810e7299e4080d89061740df642a884c611` |
| `packages/safejs/src/run.retained-callback.test.ts` | absent                                                             | `44acd9282daa2ae91c6bca548998ac7a7257052b937f985ebb80f82cd8acb7ab` |
| `docs/plans/safejs-fix-cbi-001.md`                  | absent                                                             | recorded in `manifest.json` to avoid a self-hash cycle             |

`manifest.json` records the base commit, base Git blobs/preimages, post hashes,
unchanged dependency manifests, and hashes of every evidence artifact except
itself. `preimage.sha256` predates production changes. Original allowlist,
exclusion paths, and authorized source/checkpoint hashes are in
`original-red.json`; archive bytes are never hashed.

Scoped fix is ready for the separate validator. The implicit lifetime premise
remains qualified; this is not legacy snapshot migration, arbitrary post-run
delivery support, or an external exactly-once guarantee. PPR/AR/AW and Toolcraft
remain untouched. Global publication remains held by the coordinator's reported
five Ctrl-D tests; no release action or overall-goal completion is claimed.

## Ordered integration proof — August 29, 2026

This appendix records the later integration task only. Everything before this
heading remains the exact frozen author-plan prefix; historical gate and
publication statements above are not new observations about this integration.

### Workspace, inputs, and ordering

- New clone: `/Users/kjopek/Workspace/poe-code-safejs-callback-delivery-integrated`.
- Publisher origin: `git@github.com:poe-platform/poe-code.git`; cloned with
  `--single-branch --branch main`, then successful
  `git -c pull.rebase=false pull --ff-only` before setup or source changes.
- Base and unchanged HEAD: `afe59a77fa318acf72162a1970306147fdfc5428`.
- Read ancestor/root instructions and worked directly as the assigned worker.
  No nested agents, branch changes, stash, reset, index changes, commits, pushes,
  README additions, or writes to original/shared/publisher/other clones.
- Node 22.22.2, npm 10.9.7; lockfile install with
  `SKIP_SYNC_SKILLS=1 npm ci`; the three explicit dependency-build filters passed
  all 21 tasks. Dependency manifests remain unchanged.
- Evidence is ignored locally through `.git/info/exclude`, under
  `out/safejs-remediation/cbi-001-integration/` only.

Verified input pins:

| Group                            | Pinned manifest SHA-256                                            | Scope                                                           |
| -------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| NUM                              | `d3e8d605c2a93ee2db22c16c6cc1acc66db373927aafbb23a25b7e7396fc234e` | 11 independently validated publishables                         |
| AW author integration            | `76cdfa9e6187df1ac3c2f48c9beb4f7f4e789e711cb6a17b0928ce14401acdec` | Seven AW delta files, separate from 11 NUM prerequisites        |
| AW fresh independent approval    | `5a10256673e8ef553738223efd0caca1fd2325e1980da6f8d8090a9a2a22e2ae` | All seven postimages match the already applied AW bytes         |
| CBI post-build validator capture | `bb00ab9add6a9f5d8340942d4e70e43e3a57bb2b218059a1035bbc196c8a3768` | Five CBI publishables, including unchanged validator assertions |

The supplied NUM hash identifies `candidateManifest` in the referenced readiness
record, not the readiness file itself. Readiness SHA-256 is
`40fed7b447bae4db2eb60d2eb68d647151d89bfff164b35940895044340f6108`;
its linked candidate manifest exactly matches the approved pin. No substituted
source or unpinned candidate was accepted.

Applied NUM first, AW second, CBI last as separate file groups, never as a mixed
Git commit. AW was initially provisional; the later user-approved independent
capture was checked against all seven applied postimages. They are byte-identical,
so only prerequisite approval metadata changed. The user's NUM/G01-before-AW
publication coordination remains in force; this worker performs no publication.

### Three-way preservation and TDD

Every existing path was integrated with `git merge-file -p` using the captured
base, current clone bytes, and frozen postimage. Only the resulting minimal
diff hunks were applied with `apply_patch`. Reverse three-way checks reconstruct
each actual preimage byte-for-byte. There are zero conflicts and zero semantic
repairs. No old whole interpreter was substituted: the AW interpreter delta
retains the current ARRAY call-order implementation; NUM arity and COLL cursor
behavior remain protected by the prior-fix tests.

All 18 prerequisite files remain byte-exact. CBI's production file, two test
files, and independent validation plan remain byte-exact; only this author plan
gains an appendix. The CBI production diff remains five additions/four deletions
in `host-bridge.ts`; it enables historical callback matching only during actual
host reissue. Public identities, argument guards, and source lexical state are
not reset or rewritten.

Before that production change, the post-NUM/AW stack ran the unchanged CBI tests:

- Four native original-source anchors passed first.
- Prerequisite-only CBI RED: **20 failed, 30 passed / 50**. This includes the
  original retained-registration failures and independent old-registration
  controls; actual reissue-prefix controls continue to pass.
- The unchanged original in-memory driver and four original sources generated
  fresh jobs-v6 checkpoints on the prerequisite stack. Across 40 attempts,
  **32 controls matched, four counter resumes silently lost work, and four
  distinct/map resumes refused**. Both repetitions are retained.
- After applying the CBI bridge delta: **50/50 CBI tests pass** and the same
  **40/40 original lifecycle attempts pass** against unchanged prerequisite-stage
  checkpoint bytes. No assertion, host protocol, or source workaround changed.

The independent four-identical-old-registration test returns lexical count 4
and results `[1,2,3,4]`. Original identical-counter resumes return total 4/count 2
instead of total 2/count 1; different original events return total 5. The original
concurrent map returns total 39 with values `[6,17,3,13]`, peak concurrency 2,
and zero remaining active workers. New retained deliveries append callback
history and run their nested steps. Actual reissue at historical callback
positions 1, 2, and 3 suppresses only the recorded prefix and executes the new
suffix. Changed historical arguments still require reconciliation under the
original public call ID. Joined-proof and pending-input cases remain controls,
not substitutes for the original retained-delivery witnesses.

### Fresh integrated gates

| Gate                                               | Observed result                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| CBI author and independent validator               | 50 pass, zero failure, no exclusions                                    |
| Prior AW author/boundary/validator                 | 195 pass, zero failure, no exclusions                                   |
| Prior NUM selected gate                            | 96 pass, zero failure; unchanged 26 safety exclusions                   |
| Prior ARRAY metadata and call-order                | 41 pass, zero failure, no exclusions                                    |
| Prior COLL live cursor tests                       | 136 pass, zero failure, no exclusions                                   |
| Selected combined broader/checkpoint gate          | 2,142 pass, zero failure, 83 excluded, 53 files                         |
| `env -u TERM npm run build`                        | Exit 0; 67/67 workspace tasks and root bundle/code generation           |
| SafeJS source types and configured root types      | Exit 0                                                                  |
| Configured package types plus seven new test roots | Zero diagnostics; only `noEmit: true` overridden                        |
| Configured repository ESLint and package lint      | Exit 0                                                                  |
| Publishable format                                 | 22 files pass; inherited frozen author-plan formatting limitation below |
| `git diff --check`                                 | Exit 0                                                                  |

The combined gate retains the NUM validator's exact broader selector and adds
ordinary CBI/replay/AW files. Its 82 inherited exclusions remain unchanged;
the same selector also excludes `dump does not read inherited snapshot properties`
in an added file, giving 83. These are excluded cases, not passing tests. All CBI,
AW, ARRAY, and COLL focused assertions execute unfiltered. This is not the entire
repository suite or security/adversarial certification.

The AW independent review's 13 original workflows and 40 restores are inherited
approval evidence; this worker reruns AW's 195 tests, not those audit payloads.
The 40 newly executed original lifecycle attempts here are CBI's own protocols.

### Preserved formatting limitation

The exact frozen CBI author-plan prefix already fails Prettier. The initial
23-publishable format command reports only that file. A direct check of the
captured pre-append bytes confirms the same failure. The instruction to append
integration proof only forbids rewriting that historical prefix merely to turn
the format gate green. This appendix is formatted separately; every other
publishable passes. The full-file formatting result remains explicitly qualified,
not waived, hidden, or described as a wholly passing 23-file gate.

### Evidence, boundaries, and handoff

Bootstrap metadata establishes all 38 exact archive exclusions and denies the
entire security directory before original payload access. Only the four ordinary
callback-loss-review sources are allowlisted; no recursive audit/family search,
excluded read/hash/execute, real provider, LLM, or guest filesystem/network/process
operation occurs. Original code/captures and all prerequisite source clones remain
read-only. Unit snapshots and host registries remain entirely in memory.

Historical jobs-v1 checkpoints are not reinterpreted as jobs-v6. Current original
witnesses use new jobs-v6 captures; no marker edits, fake proofs, or migration
claims occur. The retained-callback guarantee remains scoped to source-awaited
delivery in the resumed run, not arbitrary post-run callbacks or external
exactly-once effects. AR/PPR restrictions and unrelated causes remain untouched.

Evidence directory artifacts include:

- `originals-prerequisite-red.json` and `originals-merged-green.json`: complete
  driver/configuration/stdout/stderr/lifecycle/journal results and assertions.
- `cbi-prerequisite-red.log`, `cbi-merged-green.log`, and `native-anchors.log`:
  actual focused TDD and native-anchor outputs.
- `prior-gates.json`, the four prior-gate reports, `broader-command.json`, and
  `broader-green.json`: exact command arrays, selection, and full results.
- `static-gates.json`, `configured-new-test-types.json`, `full-build.log`, and
  formatting evidence: actual type/lint/build/format outcomes, including limits.
- Separate `num-prerequisite-manifest.json`, `aw-prerequisite-manifest.json`, and
  `cbi-delta-manifest.json`: group-specific preimages/postimages and source pins.
- `manifest.json`: base and post-prerequisite preimages, final source/evidence
  hashes, approval references, protected upstream paths, and freeze inventory.

The other 297 tracked SafeJS paths and every tracked path outside the 23-file
allowlist remain unchanged. Build-generated terminal font assets are explicitly
nonpublishable. Source trees, Git index, and manifests outside this clone are not
modified. Captured evidence is frozen read-only; live source remains available
for the fresh independent Helmholtz review. No publication, release readiness,
or overall-goal completion is claimed.

## Format-only refresh — August 29, 2026

The user explicitly authorized formatting the current owned CBI fix-plan copy,
including its historical prefix. The earlier formatting qualification describes
the previous capture; this refresh resolves it without changing the historical
record's meaning. Existing content changes only through configured Prettier
formatting. This note is the only added prose. Production, tests, validator
reports, and all NUM/AW prerequisite bytes remain unchanged.

The old immutable integration capture remains untouched:
`out/safejs-remediation/cbi-001-integration/manifest.json`, SHA-256
`497a7d0395b2caa132ae9eed1eba9a6c456e9d2bfe618c24d394f056d5c722f8`.
Original historical-prefix bytes remain available there under
`inputs/cbi/postimages/docs/plans/safejs-fix-cbi-001.md`, SHA-256
`ac8a9cac14fe3b3de0ca2e27a92001dc1b398d269edeb86c6e8c12f3bab92dc4`.

| Refresh identity                                            | SHA-256                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Complete pre-refresh plan, preserved as a captured preimage | `fdc4d40d586d72cc69abe9fcab1c2366683fbf354387a8c9ad59f288bd9dc57a` |
| Pre-existing body after formatting, before this note        | `5da9e2356c313aba104378dbf3a3c3029f29f235a6decc6b1718eedef49dff95` |

The complete pre-refresh plan is preserved at
`out/safejs-remediation/cbi-001-integration-format-refresh/pre-refresh/docs/plans/safejs-fix-cbi-001.md`.
The fresh candidate manifest under
`out/safejs-remediation/cbi-001-integration-format-refresh/manifest.json` records
all five CBI publishables, final plan hash, unchanged prerequisite references,
and fresh formatting results. Functional validation remains inherited from the
unchanged integrated production/test candidate; it is not rerun or relabeled as
new execution by this documentation-only refresh. No publication or overall-goal
completion is claimed.
