# Runtime workload preparation, not acceptance

Owner: delegated PREPARATION leaf; this new directory only. No product changes,
cleanup-boundary-review edits, original-five reruns, performance runs, or risky
matching are authorized by this preparation. Root separately schedules and
authorizes each later phase after reviewing the main verifier's benign green.
Neither `/tmp/regex-runtime-benign-ready.txt` nor any other readiness marker is
an execution authorization. The original 12 exposures remain archived; all six
additional exposures remain UNUSED at this checkpoint. Four are declared below;
two stay reserved. No retries, larger subjects, alternate patterns, or automatic
follow-up runs are permitted.

## Frozen inputs and reuse

- Runtime: `1b133a8662a32ee84524794842074c9c98d5f6c3`.
- Registration: `01aa1bffe0568cc6787d5ff8e0331e024a787385`.
- Fixture: `10273352f8d65d929cbf5a23e69119414dacee60`.
- `evidence/prepared.json` records exact SHA256s for selected git-frozen runtime,
  registration and fixture files, the inspected historical harnesses, and every
  executable preparation source and compiler-emitted child/observer/benchmark.
- Main source-closure/build manifests, moved package location, archive hash and
  emitted asset hashes are deliberately PENDING root's handoff. Future guard
  runs verify them before spawning any product child. No source API imports.
- Main verifier owns unchanged original-five compiled/packed and runtime
  controls. This preparation neither replaces them nor calls a custom five fixed.
- The benchmark reuses the original continuation-review 32-file alternating-pair
  workload. Its pinned baseline is the original recorded source closure at
  `329eb2722052e8ace0ec18a751f12c30ed87a25b`, authenticated by the exact archived
  baseline freeze/build manifests at `839f2d4`. Those manifests preserve dirty
  capture provenance; a HEAD label alone is not its byte identity. The later
  cleanup-throughput harness instead points to `07acb1a4d30b7592cf247a0220250317be4e2038`;
  that is not silently substituted for the original prior32 baseline here.

## Declared risky matrix: four single-request children, not yet run

Every row uses exactly historical `^(a+)+$`, 28 ASCII `a` bytes then `!`, and
one input newline (30 input bytes; 29 matching-row bytes). The profile was
inspected in production-review/child.mjs and guard.mjs. Historical review used
20ms active/1000ms startup opt-ins; those are NOT retained. Here actual public
`Shell` + `agentCommands()` uses unchanged defaults: 1000ms active request,
3000ms worker startup, two worker leases. No default network plugin is enabled.

| Job | Actual public command | Caller signal | Required observation |
| --- | --- | --- | --- |
| grep-default | `grep -E '^(a+)+$'` | Omitted entirely | status 2, empty stdout, exact 1000ms REQUEST_TIMEOUT diagnostic |
| rg-default | `rg '^(a+)+$'` | Omitted entirely | status 2, empty stdout, exact 1000ms REQUEST_TIMEOUT diagnostic |
| grep-abort | `grep -E '^(a+)+$'` | Abort 10ms after accepted request | rejection is the identical caller Error object |
| rg-abort | `rg '^(a+)+$'` | Abort 10ms after accepted request | rejection is the identical caller Error object |

Acceptance means native Worker.postMessage returned successfully for the exact
descriptor and subject, matching the prior accepted-request observation. It is
not a worker-side CPU-start acknowledgment. No pre-first-read assertion or
synthetic message is introduced. One content request only; none is warmed up.
The 5ms event-loop timer is armed only AFTER acceptance. Its actual delay is
recorded; <500ms is a harness responsiveness diagnostic, not a product SLA.
If the tiny subject completes normally before the 1s watchdog, timeout
containment is NOT demonstrated: preserve that result, do not enlarge/retry,
and do not mislabel ordinary completion as a product bug.

### Fixed limits proposed for root approval

- One exact static compiler-emitted child at a time; no eval and no untrusted
  native matching on the supervising/main event loop. Product workers perform
  matching. No external/user files or network; input is a tiny in-memory string.
- **6000ms absolute parent watchdog from fork**, never reset by ready or result:
  budget accommodates 3s worker startup + 1s active + 2s import/cleanup margin.
  Ready/run handshake precedes product loading/matching; record ready latency.
  Parent kills only its stored ChildProcess handle and awaits `close`, including
  stdout/stderr closure. No process groups, scans, PID reuse lookup, or broad kill.
- Child old-space 128MiB, stack 1024KiB; product's default worker limits remain
  unchanged (128MiB old generation, 4MiB stack). These are heap limits, not total
  process-RSS guarantees. Combined stdout/stderr cap 16KiB; cumulative IPC 64KiB.
- Exact byte/status/error outcome, acceptance descriptor, worker startup times,
  total command elapsed, timer delay, all worker/listener records at public
  settlement and after awaited dispose, then a 50ms late-error observation window.
  Disposal and public settlement must both have zero owned workers/listeners.
  Worker errors/messageerrors are recorded without swallowing emission;
  `--unhandled-rejections=strict` and uncaught monitoring preserve late failures.
  A finite late window cannot prove absence of all future host errors.
- One-shot claim per declared job, even on failure/timeout. Benchmark gets one
  six-command run. The owned lock prevents overlapping children from this runner;
  root must ensure no other lifecycle/probe/performance workload overlaps.

## Equivalent complete-command benchmark, not yet run

Exactly three alternating pairs, order baseline/candidate, candidate/baseline,
baseline/candidate. Each fresh MemoryFileSystem has `/tree/file00.txt` through
`file31.txt` containing `hit NN\nmiss NN\n` and `.ignore` containing
`file1?.txt\n!file12.txt\n`. Run exactly `rg -g '!file2?.txt' hit .` from `/tree`.
Expected output is the same 13 ordered path-prefixed lines (00–09, 12, 30, 31),
status zero, empty stderr. Both versions must match exact stdout/stderr bytes
and finish awaited disposal with zero workers/listeners. Record each version's
public-settlement state without retroactively demanding the candidate contract
of the historical baseline. No baseline assertion or fixture is weakened.

The elapsed interval includes Shell/plugin creation, real worker startup,
traversal, matching, output, and disposal. Imports and VFS population remain
excluded exactly as in the historical workload. Ready latency/child total and
each real worker's ready latency are separately recorded; startup is NOT
subtracted from command times. No protocol-only timings, easier opt-in policy,
extra warmup, median-only evidence, performance threshold, memory win, or
superiority claim. Cohost load is uncontrolled. Parent benchmark watchdog is
fixed at 30000ms from fork (six complete commands, at most three pairs).

## Commands

Run once from repository root; only the first two are authorized now:

```sh
node tests/stress/regex-execution/runtime-acceptance-workloads/prepare.mjs
node tests/stress/regex-execution/runtime-acceptance-workloads/guard.mjs controls
```

Compilation uses existing local TypeScript only, allowJs emission of the static
JavaScript harness into owned `.temporary/compiled`. No dependencies are added;
this is not a product build or a JavaScript typecheck. Standalone controls are
success/ready protocol, already-aborted exact identity, a benign idle child's
75ms owned timeout after ready, and preserved deliberate late rejection. None
imports the product or executes matching. Expected timeout SIGKILL and expected
strict-rejection exit 1 are positive supervisor controls, not product failures.
The committed evidence and claims are immutable one-shot records. To restore
ignored compiled files in another checkout, use the recorded TypeScript version
and `node_modules/.bin/tsc -p tests/stress/regex-execution/runtime-acceptance-workloads/tsconfig.json`;
the guard checks emitted hashes. Do not overwrite claims or rerun preparation
against different source bytes under the same evidence label.

After separate explicit root approval ONLY, one command at a time (never loop
these; review each result before authorizing the next):

```sh
node tests/stress/regex-execution/runtime-acceptance-workloads/guard.mjs benchmark ROOT_APPROVAL.json
node tests/stress/regex-execution/runtime-acceptance-workloads/guard.mjs grep-default ROOT_APPROVAL.json
node tests/stress/regex-execution/runtime-acceptance-workloads/guard.mjs rg-default ROOT_APPROVAL.json
node tests/stress/regex-execution/runtime-acceptance-workloads/guard.mjs grep-abort ROOT_APPROVAL.json
node tests/stress/regex-execution/runtime-acceptance-workloads/guard.mjs rg-abort ROOT_APPROVAL.json
```

`ROOT_APPROVAL.json` is an explicit trusted scheduling/handoff record, not a
security boundary against a malicious host. Root supplies its path in this
workspace. Required schema (all SHA256 strings are of actual file bytes):

```json
{
  "authority": "ROOT_EXPLICIT_EXECUTION_AFTER_REVIEWED_BENIGN_GREEN",
  "jobs": ["ONE_JOB_ONLY"],
  "expiresAt": "ROOT_CHOSEN_ISO_UTC_EXPIRY",
  "noConcurrentLifecycleProbesOrPerformance": true,
  "preparedSha256": "SHA256_OF_evidence/prepared.json",
  "commits": {
    "runtime": "1b133a8662a32ee84524794842074c9c98d5f6c3",
    "registration": "01aa1bffe0568cc6787d5ff8e0331e024a787385",
    "fixture": "10273352f8d65d929cbf5a23e69119414dacee60"
  },
  "controls": { "path": "OWNED_evidence/controls.json", "sha256": "SHA256" },
  "originalFiveCompiledAndPackedGreen": true,
  "actualPublicLifecycleGreen": true,
  "benignEvidence": [
    { "path": "MAIN_COMPILED_FIVE.json", "sha256": "SHA256" },
    { "path": "MAIN_PACKED_FIVE.json", "sha256": "SHA256" },
    { "path": "MAIN_ACTUAL_LIFECYCLE.json", "sha256": "SHA256" }
  ],
  "candidate": {
    "snapshotRoot": "MAIN_FROZEN_SOURCE_ROOT",
    "freeze": { "path": "MAIN_FREEZE.json", "sha256": "SHA256" },
    "build": { "path": "MAIN_BUILD.json", "sha256": "SHA256" },
    "packageRoot": "MAIN_MOVED_CONSUMER/node_modules/virtual-bash",
    "archivePath": "MAIN_PACK.tgz",
    "archiveSha256": "SHA256"
  },
  "baseline": {
    "snapshotRoot": "PINNED_PRIOR32_BASELINE_SNAPSHOT",
    "freeze": { "path": "ARCHIVED_BASELINE_FREEZE.json", "sha256": "SHA256" },
    "build": { "path": "ARCHIVED_BASELINE_BUILD.json", "sha256": "SHA256" }
  }
}
```

Baseline binding is needed only for benchmark. Root certifies green semantics
of its heterogeneous evidence; this runner binds the exact files and validates
owned controls, runtime/registration identities, source and emitted file hashes,
package manifest and archive hash. Fixture identity is pinned in preparation
and root's explicit combination, not invented as a published package asset.
The consumer uses public bare `virtual-bash` import resolution through an owned
node_modules symlink to the root-provided moved package; it asserts resolution
to that package's emitted index. It never changes that package or main snapshot.
Report runtime bugs before proposing fixes; preparation author owns no product.
