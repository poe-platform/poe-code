# Independent frozen full-product gate

## Verdict and scope

**The declared whole-product gate is not clean.** On explicitly handed-off
**e36dab2b6abc216ddc89e5786a0eba76f08a1722**, the unchanged canonical suite reports
**15,958 instances: 15,769 pass, 110 fail, 79 skip, zero TODO/cancellation**.
The independent TAP accountant reconciles every status with Node's footer.
No failures, skips, fixture bytes, production source, contracts or manifests were
changed to obtain this result. Classification does not turn failed rows green.

The frozen run began **2026-08-27T05:41:23.911Z** and ended
**2026-08-27T05:43:19.436Z**. Live HEAD was already 511a337; it was **not** the
product under test. All 7,932 regular tracked files (including 173 source files,
470 canonical test files and 13 contracts files) came from e36dab2, not dirty
source, later commits, private worktrees or reused dist. See preparation/discovery
details in `README.md` and `evidence/prep/discovery.json`.
All470 canonical paths appear in frozen resolution records; the separately saved
`evidence/discovery-resolution.json` records zero missing paths. Resolution is not
a claim that every case body passed.

This is a **committed-archive/native-default profile**, not a fully provisioned
native-oracle gate. Twenty-eight selected tests fail because ignored local GNU
tool/source assets are absent from a Git archive. That prerequisite gap remains
explicit; it is neither tool-semantic failure evidence nor a pass. No overall
product/backend closure, compatibility superiority or benchmark win is claimed.

## Declared commands and public package

| Phase | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` before build | exit2; six diagnostics | `evidence/first/typecheck.stdout.log` |
| `npm run build` | exit0 | `evidence/first/build.result.json` |
| `npm test` | exit1; 15,769/110/79 | `evidence/first/test.stdout.log`, `test.accounting.json` |
| `npm run test:contracts` | exit0; **87/87**, no skips | `evidence/first/contracts.accounting.json` |
| `npm --prefix benchmarks run typecheck` | exit0 | `evidence/first/benchmark-types.result.json` |
| Offline `npm pack` / tarball install | both exit0 | `evidence/first/pack.stdout.log`, `install.result.json` |
| Plain Node packed public consumer | exit0 | `evidence/first/public.stdout.log` |
| Strict public declaration consumer | exit0 | `evidence/first/public-types.result.json` |

Exact argv, cwd, bounds, byte counts and process records are in each phase result
and the full `evidence/first/report.json`. The whole-suite phase took 82.743s
under a 900s bound; every other phase had a 180s bound. No outer timeout, output
limit, forced process cleanup, surviving observed child or tracked-source
mutation occurred. Timing is operational evidence, not a performance comparison.

Fresh global typing fails at
`tests/commands/table-text-stress/shared-stdin-review/selected-gnu.ts:34` and `:35`
with two TS2307 package self-import errors, followed by four TS7006 errors at
`:37`, `:38`, `:41`, `:61`. This standalone historical packed-consumer program is
not selected by `npm test`, but **is** included by root `tests/**/*.ts` typing.
It imports `virtual-bash`/table-text declarations before fresh dist exists.
An independent same-archive recheck builds first, then runs the unchanged global
compiler: both exit0. This establishes a build-order/fixture-typing dependency;
it does **not** replace the original cold typecheck failure or justify excluding
the file silently. Route the fixture/build-order decision through root.

The installed tarball, not source aliases, exposes **20 resolved public imports**
(literal manifest exports plus contracts wildcard expansions). Every resolution
is beneath installed dist and has a recorded hash. It contains **60 unique
callable default commands**, includes tac/expand/fold/strings, and excludes
optional curl/SafeJS. Root and `virtual-bash/commands/stream-inspection` factories
are identical; `AgentCommandsOptions.streamInspection` compiles. Four real
public pipelines pass with exact bytes: tac reversal, default tab expansion,
fold width3 and strings minimum3. This is bounded package acceptance, not full
flag parity. Both canonical Git-history-dependent tests also pass unchanged.

## All 110 failures, without rebaselining

`evidence/classification.json` enumerates **every failing instance**, original
test path/source assertion line where available, TAP line, complete diagnostics
and rationale. The following categories sum to exactly110; categories are
triage, not authorization to alter expectations.

| Count | Classification | Owner follow-up |
| ---: | --- | --- |
| 28 | Missing ignored GNU tar/coreutils prerequisites | Gate/tooling profile; provision pinned assets explicitly |
| 1 | Historical metadata author-file SHA assertion | Metadata fixture owner; retain original hash |
| 6 | Empty-directory pruning fixture keeps old parent nlink | Diff/patch fixture owner, not a broad FS rewrite |
| 1 | Unselected stripped header ancestor expected to fail | Diff/patch fixture owner; verify effective selected path |
| 1 | Atomic backward-hunk status1 versus expected2 | Diff/patch grammar/status review; effects still need checking |
| 13 | jq per-execution1500ms abort under full concurrent load | Resource/test scheduling review; isolated controls below |
| 1 | Native rg delayed-delivery expectation flakes | Native oracle scheduling/delivery fixture review |
| 24 | Old method-table/malicious-remapper trust assumptions | Contract/FS fixture owner; no host-JS sandbox invented |
| 1 | Test-only WebDAV authority proposal helper refuses | Proposal/protocol fixture owner; not a real cp/mv repro |
| 2 | S3/WebDAV positive workflows hit safe-rmdir refusal | Root/backend workflow contract; keep incomplete workflows |
| 16 | Explicit historical Bash3.2 discovery expectations | Shell fixture profile decision; keep old native captures |
| 2 | Native builtin label versus truthful registered command | Invocation comparison profile; never fabricate builtin status |
| 9 | Strict native Bash3.2 comparison differences | Preserve strict bytes and separate GNU5.3 profile |
| 5 | Reproduced first-read deadline failures | Shell owner: demand/cancellation versus fixture start gate |

### Native prerequisites: absent in archive, available on host

Six tar failures are in `tests/commands/archive/native.test.ts` (five) and
`tests/commands/archive-stress/pax-independent/controls.test.ts` (one). They require
`tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar`.
Twenty metadata rows require ignored
`tests/commands/metadata-stress/.oracle/coreutils-9.7/src/{chmod,stat,mktemp}`,
the source archive or pinned source files. Two table-text native batches require
that archive/manual and paste/comm/join binaries. Some assertions compare actual
virtual success against native **126 / cannot execute**, not utility semantics.
These are hard failures, separate from the suite's explicit skips.

The metadata README explicitly describes its ignored `.oracle` setup; archive
fixtures provide a separate `prepare-oracle.mjs`. Neither provisioning script is
a declared npm lifecycle prerequisite. No download/build/native-cache overlay
was silently added. A later read-only host check verifies **9/9 inspected tar,
coreutils archive/binary/source assets** against pins from e36dab2; see
`evidence/native-prerequisites.json`. These exist locally but were not in the
archive or executed for these failed rows. This is not a host-wide unavailability
claim. A prerequisite-complete profile can be prepared separately; the original
28 failures and five GNU-tar availability skips must remain recorded. The
additional table-text manual/binary prerequisites have not all been reverified
by that nine-asset check.

The distinct metadata SHA failure is
`tests/commands/metadata-stress/provenance.test.ts:43`: old stat test hash
`a3597699eadbcfa3b48a7a2cb9830428d6fc98c70f197c6f6c97011219e0b3aa`, actual
`06b10fc13e5e884802ab69cd7838e8e61f115ce9d3024ceee63145e3fba6076f`.
The fixture changed in tracked history (including bdaaf50); this reviewer does
not update the historical hash to hide that intentional delta.

### Concrete fixture/contract distinctions

- `tests/commands/diff-patch-stress/emptyfile-delta/emptyfile.test.ts:18` removes
  `/authorized` from its expected namespace after permitted pruning, but retains
  root nlink4 instead of3. Exact target bytes/status and directory removal have
  already passed that row's earlier assertions. All six failures reproduce in
  the unchanged serial cohort (**83pass6fail**).
- `tests/commands/diff-patch-stress/editflows/quoted-safety.test.ts:59` expects
  refusal for `alias/target` without `-p`. The documented GNU default selects the
  basename `target`; stripped, unselected ancestors are not authorization paths.
  This is not evidence that a selected symlink is safe to follow.
- `tests/commands/diff-patch-stress/fuzz/edits.test.ts:97` sees
  `patch: hunk 2 does not match target`, status1 rather than malformed2, for
  repeated `@@ -1 +1 @@` hunks in `--atomic`. Preserve the strict mismatch and
  have the owner verify intended grammar/status and no-publication. The failure
  occurs before subsequent preservation assertions; do not claim they passed.
- `tests/fs/mount/identity-authority-review/implementation/adapter-binding.test.ts`
  (18) and `remote-comparison.test.ts` (6) demand unknown after replacing methods
  or routing data differently from provider metadata. The e36dab2 contract at
  `src/contracts/filesystem.md:134` explicitly says faithful forwarding does not
  require method-table identity, remappers must provide truthful binding, and
  host JavaScript is not sandboxed. The tests remain failed, not proof that all
  FS plugins are confined or that public real-provider workflows are closed.
- `tests/fs/mount/identity-authority-review/authority.test.ts:463` fails inside
  test-only `proposal.ts`/`proofCopy`, with unknown→ENOTSUP. Keep this helper
  failure separate from actual command authority-consumer acceptance.
- `tests/integration/adapter-tools/matrix.test.ts` requires successful final
  `rmdir scratch/nested` for S3 and WebDAV. Both return ENOTSUP because atomic
  empty-directory deletion cannot be established. No data loss is shown by this
  failure; the required positive workflows are still **incomplete**, not waived.

### Resource and lifecycle rechecks

`recheck.mjs` recreates the exact same source archive and verifies every tracked
file and copied dependency against first-run hashes. It changes no source,
fixture, timeout, quota or assertion. Raw outputs are in `evidence/recheck/`.

| Unchanged selected cohort | Recheck result |
| --- | --- |
| jq scan-boundaries, plain isolated | **15/15**, no skips |
| jq scan-boundaries, same resolve guard | **15/15**, no skips |
| rg streaming parent, three plain repetitions | **fail / pass / pass** |
| remote-close original25 | **20pass5fail**, no skips |
| diff emptyfile original89 | **83pass6fail**, no skips |

The 13 jq failures are AbortSignal1500ms errors, not differing scan outputs.
Both isolated runs pass; this does not prove a general resource-performance
guarantee or permit enlarging the budget. During the full run, an external
`uptime` observation at 05:42:29Z was **26.07/9.97/7.48** (1/5/15-minute load).
Serial recheck observations were **5.25/8.65/7.66** then **5.72/8.34/7.59**.
Scheduling, cohost load and instrumentation effects are not fully isolated.

The rg failure is specifically the **native** assertion at
`tests/commands/search-stress/streaming-cases.ts:49`: one invocation emits only
the binary warning instead of the hardcoded prior `foo\n` plus warning. It fails
before the virtual-vs-native comparison. Repetition2/3 pass with identical
inputs/binary. Writes every25ms do not guarantee the native process starts
reading before those writes coalesce. The first full failure remains.

The five persistent scenarios are `first-read-local`, `first-read-s3`,
`first-read-webdav`, `first-read-curl-body`, `first-read-curl-headers`, from
`tests/shell/remote-close.test.ts:56`, with inner **1200ms DEADLINE** errors.
`first-read-probe.ts` waits for producer `started` in middleware before letting
`head -n 0` run. Root should route a minimal demand/cancellation-contract review
to the shell owner; this audit does not decide whether that wait is a valid
runtime requirement or a circular fixture dependency. The five failures are
reproduced without the resolve guard and are not explained away by full-suite
load or broad timeout relaxation.

## Native dialects and strict bytes

The outer profile is **Darwin arm64, C, UTC, Node22.22.2/npm10.9.7**. Fixture UTF-8
overrides remain intact. `/bin/bash` is Apple Bash3.2; separately pinned GNU5.3
is never silently substituted. `native-profiles.mjs` executes only nine reviewed
literal, bounded scripts in owned temporary directories, with both exact
binaries and argv0 `shell-stress`. All nine original3.2 native observations
reproduce byte-for-byte; every raw stdout/stderr/status/file effect is retained.

Against the frozen virtual results, **Bash3.2 matches stdout/status/files on7/9**
(the two invalid-substitution prevalidation cases differ). **Darwin GNU5.3 matches
those fields on9/9**. Exact stdout/stderr/status/files match is **0/9** for each:
stderr identities/prefixes remain different. This selected field comparison is
not strict oracle acceptance or portable Bash parity.

Concrete repro: `printf before; printf marker >marker; printf "%s" "$(true |)"; printf after`.
Bash3.2 emits `beforeafter`, creates marker and exits0. Pinned GNU5.3 emits no
stdout, creates no marker and exits127; the frozen virtual result matches those
effects/status, but uses `shell` rather than `shell-stress` in its syntax error.
For NUL substitution, GNU5.3 and virtual both warn; Bash3.2 is silent. No expected
values were changed. GNU5.3 here is a **Darwin binary**, not a tested Linux profile.

The separate **16** discovery failures all start `historical-3.2/`; their suite
includes empty PATH and invalid-option output differences. Canonical
`primary-5.3/` named rows are **89pass**, separately from **historical-3.2/
36pass16fail**. Two verbose holdout failures expect `printf is a shell builtin`
where the product truthfully says `printf is a registered command`; the project
explicitly forbids lying about this distinction to obtain parity.

## Skips and characterizations

The **79 skips** are **62 unavailable-private-engine** and **17 native-oracle/
profile controls**. Native17 = five GNU-tar availability checks, three optional
byte-family native batches, three GNU checksum-dialect checks, two GNU encoding
checks, three opt-in live stream batches and one opt-in table-text batch. Frozen
vectors still run where declared. No skip is a pass, no actual SafeJS engine was
loaded, and previously accepted actual-engine **ef1699b** remains separate.

Final name review identifies **17 passing explicit characterizations**: four
Rust-regex/deadline observations, ten adapter POLICY cases and three NONCOMPLIANT
host-routing cases. Two known-upstream SafeJS characterizations are skipped.
These are not feature acceptance. Node's raw pass count is retained, not presented
as 15,769 independently implemented behaviors. Provenance/negative-control tests
also are not a command-feature inventory.

The first accountant left nine generic-GNU skip reasons unclassified and omitted
the three NONCOMPLIANT labels. A post-run assertion caught the skip-label gap;
`evidence/classification-initial.json` preserves it. The final classifier changes
only labels, never raw statuses/denominators; the initial accounting and source
hash remain untouched. Added harness control passes with the other11 selftests.

## Provenance, cleanup and handoff

| Identity | SHA-256 |
| --- | --- |
| Exact Git source archive | `f5df1777725ef2804229fb34fd95eb51850577ef7e507389157d0efd5c5fdf4d` |
| Reachable-only isolated Git object pack | `699a611cbb769e17be135be66c746edefba6b2ccdbdefd274f3d6e4b9ebeedf0` |
| Fresh npm package tarball | `595c0fc03b8dc40d90cc4b51c88cd7dfdc4197a7d846a65a5b08866f6ce42ad1` |
| Node executable | `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` |

The first report records every tracked input, 314 root and3,497 benchmark
development files, exact bin wrappers, both lock/config hashes, npm/native
identities, public imports and default command names. All tracked inputs and
dependency bytes/modes remain unchanged. Runtime dependencies are empty;
just-bash3.4.2 is isolated development/comparator tooling, not a runtime dependency
or a performance comparison in this gate.

`archive.mjs` copies evidence through apply_patch and verifies every byte round
trip. **704 captured files, 30,483,164 original bytes** are represented by
`evidence/capture-manifest.json`. Logs without a final newline use explicit
`.bytes.base64` records rather than altering bytes. Original prep7/8, unchanged8/8,
expanded11/11, raw cold-run failures, serial controls and native recaptures remain.
Final harness selftests are **12/12**, zero skips; the added classification
control and prior11/11 rerun are retained separately under `evidence/prep/`.

All three execution trees were removed by their harnesses; phases record no
survivors or supervisor signals. Final observed-PID/birth checks and exact owned
capture-temp removal are recorded in `evidence/cleanup.json`. The full-run TCP
sampler observed **zero listeners** (short-lived services can fall between
samples); this is not proof of no networking or universal loopback enforcement.
The separate prep loopback control verifies the observer, and unchanged fixtures
declare their loopback binding. No private engine tree was accessed or modified.

Only `tests/integration/full-gate-20260827/**` changes in this handoff. No owner is
asked to mass-rewrite expectations: root should separately route cold typing,
native prerequisite provisioning, stale/profile fixtures, atomic-hunk status,
resource reliability and first-read contract review. A clean full-product gate
and the broader product/comparison goal remain **open**.
