# AR-001: external checkpoint during a pending host call

## Scope and baseline

- Work only in `/Users/kjopek/Workspace/poe-code-safejs-external-checkpoint`,
  cloned from the publish clone's origin on `main` and successfully pulled first.
- Baseline: `b7dfa47180e8e160bd40ca675b35073b9f422e5e`.
- Bootstrap the inventory's 38 excluded paths and the entire audit `security/`
  directory before reading original payloads. Read only the explicitly allowed
  async-replay report, reproduction instructions, results, and four AR-001 sources.
- Preserve hashes, baseline failures, commands, and immutable candidate artifacts
  in ignored `out/safejs-remediation/ar-001/`. No commits or pushes.

## Actual current API comparison

The pulled public entry point exports `run`, `dump`, and `restore`. `DumpOptions`
only has `onFailure`; there is no selectable capture/replay dump mode at this
baseline. `dump(promise)` requests the next yield. The internal `dumpCurrent`
uses the latest yield, and the signal handler uses it. Both reject while the
run-wide injected-host-call depth is positive, including independent callers.
The completed replay journal and scheduled pending snapshots do not fulfill an
external request while host work remains pending.

Preserve default capture rejection during active injected host calls. Add an
explicit public `dump(execution, { mode: "replay" })` to obtain the latest yielded
recoverable journal, or wait for the first yield. Preserve actual in-callback
reentry rejection with run-local async context, including callbacks after an
`await`. Signal-triggered checkpointing selects replay mode. Do not change guest
programs, bypass the bridge with prewrapped capabilities, or depend on automatic
snapshot writes for success.

Historical `jobs-v1` checkpoints are incompatible with current `jobs-v6` ordinary
restore. Generate genuine new checkpoints from byte-identical original sources;
never change old execution markers or manufacture reconciliation proofs.

## TDD and implementation

1. Add fast in-memory tests proving external pending replay, both recovery
   policies, original capture rejection, callback rejection, and signal recovery.
2. Save failing test output before changing production files.
3. Add the smallest package-local API/context change and document its semantics
   in `CHECKPOINT_REPLAY.md`, without README additions or inline code comments.
4. Run focused tests, full normal-environment tests with `TERM` unset, configured
   type/lint/format checks, and the necessary workspace builds.

## Original-workflow validation procedure

Run the exact original reduction and examples 05, 06, and 07 with in-memory
declared host stubs and deterministic pause/release gates. Independently compute
native expectations. After a pause notification and an event-loop turn, request
the public replay dump before releasing the host gate, without a snapshot
backend. Verify pending host records and genuine current execution semantics.
Restore using re-issue or genuine externally observed outcomes and compare the
complete result and trace to native. Dump the completed run and replay it with
zero repeated host operations. Use an EventEmitter for signal checks, not OS
signals, disk writes, real LLMs, network, or guest process operations.

Retain baseline failures rather than editing unrelated code. There is no CLI
visual change, so terminal screenshot validation is not applicable. A separate
validator assigned by the parent must independently validate the immutable
candidate; this worker does not delegate or claim independent approval.

## Worker execution record

- The initial original-reduction probe and three new regression failures
  reproduced external `reentry` at the pulled baseline. There was no upstream
  public replay-dump mode to use unchanged at this HEAD.
- Added seven tests: two pending recovery policies, genuine asynchronous
  callback rejection, pre-first-yield replay, two context-disposal paths, and
  signal-triggered pending recovery. Captured red output before each production
  change; focused verification passes all 43 tests across four files.
- The new run-local asynchronous context is disabled when execution exits,
  including parse failure. Default capture and next-yield behavior are unchanged.
- The four original source files remain byte-identical. Five scenarios cover
  the reduction, callback workflow, retry re-issue, retry external reconciliation,
  and co-style generator workflow. Public and signal requests each capture
  before the gate releases, with no automatic snapshot backend.
- Ten pending restores and five completed restores match separately measured
  native results. A subsequent fresh host process repeats all fifteen restores;
  completed replay repeats no host calls. These are worker checks, not the
  separately assigned validator's approval.
- External reconciliation receipts use actual recorded outcomes from the
  original completed execution, matched by call identity and argument digest.
  No historical checkpoint or execution marker is rewritten. JSON projections
  compare these finite result graphs, avoiding prototype-only differences
  between native objects and SafeJS objects; values and traces are unchanged.
- Package validation passes 4,013 tests, with 39 configured skips. The initial
  full baseline run overlapped dependency building and preserved one stdio
  smoke-test failure. Post-build full verification passes without changing
  transport code or test configuration.
- Workspace builds, configured production types, ESLint, workflow lint, and
  owned-file formatting pass. ESLint excludes only the ignored evidence folder:
  byte-identical guest `.js` fixtures have top-level returns, not host JS syntax.
  Repository-wide Prettier still reports 1,430 existing warnings; no new warning
  remains. Preserve both initial and final logs rather than reformat unrelated
  files.
- No commits, pushes, README additions, CLI visual changes, guest process/network
  actions, real LLM calls, security work, or nested delegation occurred. The
  independent validator and serial publisher remain separate parent-owned steps.

## Ordered integration author record — August 29, 2026

This section appends integration evidence; all preceding author history and the
separate validator's assertions/report remain preserved. Work is confined to
`/Users/kjopek/Workspace/poe-code-safejs-external-checkpoint-integrated`, a new
main clone pulled first at `3180c4c3a1f3d125d1b2916357438e9167694fa6`.
All older clones and captures are read-only inputs. Evidence belongs to ignored
`out/safejs-remediation/ar-001-integration/`; no commits, pushes, or branches.

### Pinned prerequisites and boundaries

Bootstrap the inventory's 38 exclusions plus the complete audit security directory
before any original payload read. Select original functional sources explicitly;
never recursively search the audit or read/hash/execute excluded payloads.

Integrate only missing approved deltas, in order NUM → AW → OBJ002 → CBI → AR:

- NUM: eleven files. The supplied `d3e8d605…` pin matches the candidate manifest
  referenced by readiness, not the readiness wrapper itself. Both identities and
  every pinned preimage/postimage hash are recorded; no unchecked replacement.
- AW: seven runtime/test/document paths plus the extra explicitly approved Helm
  integration report. Its NUM prerequisite stays in the separate NUM layer.
- OBJ002: twelve final publication paths, based on the exact post-NUM preimages.
- CBI: five pinned paths, **provisional pending the separate Helm verdict**.
  Recheck the manifest/capture hashes before freezing; reintegrate if they change.
- AR: only the ten approved publication paths. Preserve all validator tests and
  its report byte-for-byte; append this author's integration proof only here.

No prerequisite was already present. Each layer applied against its exact
preimage; layer captures remain separate. There are 35 distinct prerequisite
paths and 44 distinct paths across prerequisites plus AR. The NUM/OBJ002 production
overlap is `packages/safejs/src/snapshot/restore.ts`. CBI/AR overlap only at
`packages/safejs/src/interp/host-bridge.ts`: CBI's reissued-callback indexing and
AR's asynchronous invocation context merge in distinct hunks. No textual or
semantic conflict has been observed. All other AR production/document preimages
match this main exactly. Do not claim run.ts drift where hashes show none.

### TDD and integrated validation procedure

On the prerequisite-only runtime, stage the unchanged three AR test files:
**14 fail, 19 pass / 33**. Apply only the AR runtime/contract delta with a clean
three-way bridge merge: **33/33 pass**, including all fourteen validator assertions.
No assertion, callback restriction, missing-provider failure, default/current dump
restriction, old execution marker, or source program is weakened.

Rerun the complete NUM 122, AW 195, OBJ002 36+8, CBI 50, ARRAY 41, and COLL 136
groups, plus OBJ3/MC/upstream controls and configured broader tests. Typecheck
production and all new test roots using the package's actual compiler options;
run configured lint, package lint, formatting, and a full build with TERM unset.
Keep initial failed commands/driver errors rather than deleting evidence.

Verify four byte-identical original sources in five scenarios. Public
`dump(execution, { mode: "replay" })` and signal-helper checkpoints must be
obtained while host gates remain held, without an automatic snapshot backend.
Compare full finite JSON values, traces, call logs, and original inputs to native;
restore in-process and in a fresh host process. Reconciliation uses actual recorded
outcomes, never invented receipts. Keep genuine jobs-v6 markers unchanged.

After building, exercise a real supported CLI SIGINT interruption during a native
pending wait, inspect the actual pending checkpoint, and resume the unchanged
workflow. Capture and inspect screenshots of the affected interruption/recovery
workflow, not just help. Do not claim standalone/root CLI SIGUSR1 support. Use no
real provider, LLM, guest filesystem/network/process action, or adapter workaround.

Freeze an AR-only patch against the recorded post-prerequisite state. Retain main,
per-layer, and post-prerequisite preimages with hashes separately from AR outputs.
CBI approval and fresh Nash independent integration review remain parent-owned
requirements, not certifications this author can grant.

### Final approved prerequisites and executed integration proof

The parent subsequently supplied Helm's **READY** CBI verdict. Its final manifest
SHA-256 is `8e93397561cd71658628597f036ed89342088e85b20f510a1a4ae5a5e05956c6`.
All five preimages/postimages were verified against that manifest and the earlier
refresh. Runtime, both test files, and the author plan are unchanged. Only
`docs/plans/safejs-validate-cbi-001.md` gains Helm's approved append; its original
16,703-byte prefix is unchanged. This supersedes the provisional qualification
above. NUM, AW, OBJ002, and CBI now have parent-provided approval. Nash's fresh
independent AR integration review is still outstanding.

The final exact-target gate passes **690 tests in 23 files**, without exclusions:
NUM 122, AW 195, OBJ002 36, OBJ002/NUM 8, CBI 50, ARRAY 41, COLL 136, and AR 102.
ARRAY includes metadata-validation (14), own metadata (12), and call-order (15).
The earlier prerequisite run omitted a mistyped call-order path. An intermediate
rerun also omitted incorrectly located collection/running-state targets; its
527-pass JSON is retained, not represented as the full gate. The final driver
asserts all requested files exist and all 23 appear in the results.

The configured ES2022 new-test typecheck initially reported three TS2550 errors
for `Promise.withResolvers` in the imported AR author test. Replace only those
three construction sites with a local Promise/deferred helper, without compiler
option relaxation or assertion changes. The same twelve new test roots then
produce zero diagnostics. AST extraction verifies unchanged expectation
expressions in all three AR test files (37 signal-helper, 18 author, 48 validator).
The independent AR validator test and report remain byte-identical to their pin.

The complete SafeJS suite passes **6,569 tests**, with 39 configured skips across
178 files. The initial full repository run passes **23,954 tests**, with 41
configured skips across 970 files; retain the final post-helper rerun separately.
Root types, package lint, root ESLint, workflow lint, and all 44 changed-path format
checks pass. The full build succeeds with 67 workspace tasks plus the root bundle.
Dependency installation used `SKIP_SYNC_SKILLS=1 npm ci`; test/build commands use
the normal environment with TERM unset, not a narrowed environment workaround.

Original source proof uses four SHA-identical archive sources in five scenarios:
reduction, callback, retry/re-issue, retry/external reconciliation, and co-live.
The source-public graph captures ten pending public/helper checkpoints before
host gates release and performs fifteen in-process recoveries. Fifteen further
recoveries run in fresh host processes using only built public exports. Five
additional built-public captures and ten built-public in-process recoveries pass.
Full results, traces, native call order, and observed reconciliation outcomes agree.
There is no automatic snapshot backend in these public API probes, no fabricated
receipt, no rewritten source or execution marker, and no provider/LLM or guest I/O.

An initial ad hoc driver mixed the bundled public index with separately emitted
private dump modules. Their private controller symbols differ, so its private
dumpCurrent assertion did not recognize the bundled promise. Preserve that failed
driver evidence. Correct the probe to a consistent source module graph and verify
built public exports separately; do not alter production symbols or add an adapter.
Default capture, explicit capture, same-run asynchronous callback restrictions,
and matching-graph dumpCurrent restrictions all remain enforced. Historical
jobs-v1 snapshots remain unsupported; every new checkpoint is genuine jobs-v6.

The built root CLI received a real OS SIGINT while the unchanged fixture awaited
`time.sleep(5000)`. No snapshot existed before the signal. Twenty milliseconds
later, while the original process was still alive, the captured jobs-v6 checkpoint
contained a running sleep host call. The interrupted CLI exits 130. A fresh CLI
resume from those captured pending bytes and their real journal exits zero,
reports completion and zero spawns, and consumes the resume snapshot. Screenshots
of interruption and recovery were rendered and visually inspected; the recovery
also runs through `npm run screenshot-poe-code`. This is the supported SIGINT
workflow, not a claim that the root CLI implements the helper's SIGUSR1 interface.
CLI output summarizes the result's keys; complete scalar/object equality is proved
in the separate public API receipts rather than inferred from that summary.

Final evidence belongs to ignored `out/safejs-remediation/ar-001-integration/`.
Freeze the ten AR paths against the post-prerequisite preimages, not directly
against main. Keep the NUM eleven, AW eight (including approved extra report),
OBJ002 twelve, and final CBI five paths as separate delta layers. Retain historical
captures and failed drivers. Record all source pins, main/post-prerequisite
preimages, merged postimages, patch hashes, assertion preservation, and a replay
of the patch sequence in a private temporary index. Do not change the real index,
main HEAD, upstream files outside these layers, or any other clone.

The final post-helper full repository rerun also passes **23,954 tests**, with
41 configured skips, 967 passed files and three skipped files. Its uncached run
finishes in 3m56s. Final root ESLint, all 44 publication-path format checks, and
diff whitespace checks pass after the CBI report append and ES2022 test repair.
